package handler

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"github.com/davisu-china/mutual-app/server/internal/auth"
	"github.com/davisu-china/mutual-app/server/internal/config"
	"github.com/davisu-china/mutual-app/server/internal/ws"
)

// hub 由 main 在启动时注入。
//
// 做成包级变量而不是逐个 handler 传参，是因为「推消息」这个动作
// 会从很多地方发起（发消息、配对成功、已读回执…），逐层传参会污染函数签名。
var (
	hub    *ws.Hub
	issuer *auth.Issuer
	cfgRef *config.Config
)

func SetRealtime(h *ws.Hub, i *auth.Issuer, c *config.Config) {
	hub = h
	issuer = i
	cfgRef = c
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// 只允许配置里列出的来源，避免任意站点建立连接
	CheckOrigin: func(r *http.Request) bool {
		if cfgRef == nil || cfgRef.Env == "dev" {
			return true
		}
		origin := r.Header.Get("Origin")
		for _, allowed := range cfgRef.AllowOrigins {
			if origin == allowed {
				return true
			}
		}
		return false
	},
}

// WS 处理 WebSocket 升级。
//
// 凭证走查询参数而不是 Header——浏览器的 WebSocket API 无法自定义请求头。
// **因此不能直接沿用长期 Access Token**：URL 会进日志、进 Referer。
// 生产环境应改为先调 HTTP 接口换一个 30 秒有效的一次性 ticket，
// 再用 ticket 升级。这里为了跑通先接受 Access Token，并在 dev 下放行。
func (h *WSChatHandler) WS(c *gin.Context) {
	token := c.Query("token")
	if token == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized,
			Resp{Code: "UNAUTHORIZED", Message: "缺少 token"})
		return
	}

	claims, err := issuer.Parse(token, auth.TypeAccess)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized,
			Resp{Code: "UNAUTHORIZED", Message: "凭证无效"})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("[warn] WebSocket 升级失败: %v", err)
		return
	}

	hub.Register(claims.UserID, conn)
}

type WSChatHandler struct{}

func NewWSChatHandler() *WSChatHandler { return &WSChatHandler{} }

// ---------- 推送辅助 ----------

// pushChatMessage 把新消息推给会话里的另一方。
func pushChatMessage(peerID, convID int64, msg any) {
	if hub == nil {
		return
	}
	hub.SendTo(peerID, ws.Envelope{
		Type: "message",
		Data: gin.H{"conversationId": convID, "message": msg},
	})
}

// PushMatch 通知双方配对成功。
//
// 由 main 注入到 ActionService 的 MatchHook 里，在事务提交后触发。
func PushMatch(userA, userB int64, matchID int64) {
	if hub == nil {
		return
	}
	for _, uid := range []int64{userA, userB} {
		peer := userB
		if uid == userB {
			peer = userA
		}
		hub.SendTo(uid, ws.Envelope{
			Type: "match",
			Data: gin.H{"matchId": matchID, "peerId": peer},
		})
	}
}

// 说明：在线状态不在这里维护。Hub 暴露了 SetPresenceHooks，
// 由 main 注入「连上时写 Redis、断开时删键」的闭包——
// 这样 handler 包不必为了一个布尔状态引入 redis 依赖。
