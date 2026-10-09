// Package ws 提供 WebSocket 连接管理。
//
// 一个用户可以有多条连接（手机 + 网页），所以是按 userId 存一组连接。
// 多实例部署时，本 Hub 只管本进程持有的连接；跨实例的投递由 Redis Pub/Sub
// 转发（见 Broadcast）。
package ws

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = 25 * time.Second
	maxMsgSize = 8 << 10 // 客户端上行限制 8KB，防止被塞大包
	sendBuffer = 64
)

// Envelope 是服务端推送的统一信封。
type Envelope struct {
	Type string `json:"type"` // message / match / read / error
	Data any    `json:"data"`
}

type conn struct {
	userID int64
	ws     *websocket.Conn
	send   chan []byte
	hub    *Hub
	closed sync.Once
}

type Hub struct {
	mu    sync.RWMutex
	conns map[int64]map[*conn]struct{}

	// onJoin / onLeave 用于把在线状态写进 Redis（可选）
	onJoin  func(userID int64)
	onLeave func(userID int64)
}

func NewHub() *Hub {
	return &Hub{conns: make(map[int64]map[*conn]struct{})}
}

func (h *Hub) SetPresenceHooks(onJoin, onLeave func(userID int64)) {
	h.onJoin = onJoin
	h.onLeave = onLeave
}

// Register 绑定一条连接并启动读写泵。
func (h *Hub) Register(userID int64, ws *websocket.Conn) {
	c := &conn{
		userID: userID,
		ws:     ws,
		send:   make(chan []byte, sendBuffer),
		hub:    h,
	}

	h.mu.Lock()
	if h.conns[userID] == nil {
		h.conns[userID] = make(map[*conn]struct{})
	}
	first := len(h.conns[userID]) == 0
	h.conns[userID][c] = struct{}{}
	h.mu.Unlock()

	if first && h.onJoin != nil {
		h.onJoin(userID)
	}

	go c.writePump()
	go c.readPump()
}

// SendTo 向某个用户的所有连接推送。
func (h *Hub) SendTo(userID int64, env Envelope) {
	payload, err := json.Marshal(env)
	if err != nil {
		return
	}

	h.mu.RLock()
	targets := make([]*conn, 0, len(h.conns[userID]))
	for c := range h.conns[userID] {
		targets = append(targets, c)
	}
	h.mu.RUnlock()

	for _, c := range targets {
		select {
		case c.send <- payload:
		default:
			// 发送缓冲满说明这个连接已经跟不上了，断开它，
			// 客户端重连后会用 seq 拉取缺失的消息，不会丢
			c.close()
		}
	}
}

// IsOnline 判断用户当前是否有活跃连接。
func (h *Hub) IsOnline(userID int64) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.conns[userID]) > 0
}

func (h *Hub) unregister(c *conn) {
	h.mu.Lock()
	if set, ok := h.conns[c.userID]; ok {
		delete(set, c)
		if len(set) == 0 {
			delete(h.conns, c.userID)
			if h.onLeave != nil {
				h.mu.Unlock()
				h.onLeave(c.userID)
				return
			}
		}
	}
	h.mu.Unlock()
}

func (c *conn) close() {
	c.closed.Do(func() {
		close(c.send)
		_ = c.ws.Close()
		c.hub.unregister(c)
	})
}

func (c *conn) readPump() {
	defer c.close()
	c.ws.SetReadLimit(maxMsgSize)
	_ = c.ws.SetReadDeadline(time.Now().Add(pongWait))
	c.ws.SetPongHandler(func(string) error {
		return c.ws.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		_, msg, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		// 目前客户端上行只用于心跳；业务消息一律走 HTTP 接口，
		// 这样幂等、鉴权、错误处理都只需要维护一套
		var ping struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(msg, &ping) == nil && ping.Type == "ping" {
			select {
			case c.send <- []byte(`{"type":"pong"}`):
			default:
			}
		}
	}
}

func (c *conn) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.ws.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.ws.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
