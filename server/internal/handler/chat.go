package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/davisu-china/mutual-app/server/internal/middleware"
	"github.com/davisu-china/mutual-app/server/internal/service"
)

type ChatHandler struct {
	svc *service.ChatService
}

func NewChatHandler(svc *service.ChatService) *ChatHandler {
	return &ChatHandler{svc: svc}
}

func (h *ChatHandler) Conversations(c *gin.Context) {
	list, err := h.svc.Conversations(c.Request.Context(), middleware.UserID(c), 50)
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, gin.H{"items": list})
}

func (h *ChatHandler) Messages(c *gin.Context) {
	convID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		fail(c, 400, "INVALID_PARAM", "会话 id 不合法")
		return
	}
	beforeSeq, _ := strconv.ParseInt(c.DefaultQuery("beforeSeq", "0"), 10, 64)

	uid := middleware.UserID(c)
	msgs, err := h.svc.Messages(c.Request.Context(), uid, convID, beforeSeq, 30)
	if err != nil {
		mapErr(c, err)
		return
	}
	// 对方是谁一并带回：聊天室标题要显示昵称与头像，
	// 否则前端只能显示「会话 3」这种没有信息量的占位符。
	peer, err := h.svc.Peer(c.Request.Context(), uid, convID)
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, gin.H{"items": msgs, "peer": peer})
}

type sendReq struct {
	MsgType     string `json:"msgType"`
	Content     string `json:"content"`
	ClientMsgID string `json:"clientMsgId"`
}

// Send 发送消息。
//
// 发送后同步通过 WebSocket 推给对方（在线时即时到达，离线则落库等拉取）。
// 推送失败不影响接口返回——消息已经落库了。
func (h *ChatHandler) Send(c *gin.Context) {
	convID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		fail(c, 400, "INVALID_PARAM", "会话 id 不合法")
		return
	}

	var req sendReq
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, "INVALID_PARAM", "参数不完整")
		return
	}

	uid := middleware.UserID(c)
	msg, err := h.svc.Send(c.Request.Context(), service.SendInput{
		UserID:         uid,
		ConversationID: convID,
		MsgType:        req.MsgType,
		Content:        req.Content,
		ClientMsgID:    req.ClientMsgID,
	})
	if err != nil {
		mapErr(c, err)
		return
	}

	if peerID, err := h.svc.PeerOf(c.Request.Context(), uid, convID); err == nil {
		pushChatMessage(peerID, convID, msg)
	}

	ok(c, msg)
}

func (h *ChatHandler) MarkRead(c *gin.Context) {
	convID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		fail(c, 400, "INVALID_PARAM", "会话 id 不合法")
		return
	}
	if err := h.svc.MarkRead(c.Request.Context(), middleware.UserID(c), convID); err != nil {
		mapErr(c, err)
		return
	}
	ok(c, nil)
}
