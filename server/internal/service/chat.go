package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/davisu-china/mutual-app/server/internal/model"
)

var (
	ErrNotInConversation = errors.New("无权访问该会话")
	ErrConversationClosed = errors.New("会话已关闭")
	ErrEmptyMessage      = errors.New("消息内容不能为空")
)

const maxMessageLen = 1000

type ChatService struct {
	db *gorm.DB
}

func NewChatService(db *gorm.DB) *ChatService {
	return &ChatService{db: db}
}

type ConversationView struct {
	ID            int64      `json:"id"`
	MatchID       int64      `json:"matchId"`
	PeerID        int64      `json:"peerId"`
	PeerNickname  string     `json:"peerNickname"`
	PeerAvatar    string     `json:"peerAvatar"`
	PeerCity      string     `json:"peerCity"`
	LastMessage   string     `json:"lastMessage"`
	LastMessageAt *time.Time `json:"lastMessageAt"`
	Unread        int32      `json:"unread"`
	Status        string     `json:"status"`
	MatchedAt     time.Time  `json:"matchedAt"`
}

type MessageView struct {
	ID          int64     `json:"id"`
	FromUser    int64     `json:"fromUser"`
	MsgType     string    `json:"msgType"`
	Content     string    `json:"content"`
	Seq         int64     `json:"seq"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
	ClientMsgID *string   `json:"clientMsgId,omitempty"`
}

// Conversations 返回会话列表，按最后消息时间倒序。
//
// 最后一条消息用 LATERAL 子查询一次取回，避免每行再查一次（N+1）。
// 未读数直接按 user_a/user_b 两个 CASE 算好，不在 Go 里逐行判断。
func (s *ChatService) Conversations(ctx context.Context, uid int64, limit int) ([]ConversationView, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	rows, err := s.db.WithContext(ctx).Raw(`
		SELECT c.id, c.match_id, c.status, c.last_message_at,
		       CASE WHEN c.user_a = $1 THEN c.unread_a ELSE c.unread_b END AS unread,
		       CASE WHEN c.user_a = $1 THEN c.user_b   ELSE c.user_a   END AS peer_id,
		       u.nickname,
		       COALESCE(av.url, '') AS avatar_url,
		       COALESCE(p.city_city, '') AS city,
		       COALESCE(last.msg_type, '') AS last_type,
		       COALESCE(last.content, '')  AS last_content,
		       m.matched_at
		FROM conversations c
		JOIN match_records m ON m.id = c.match_id
		JOIN users u ON u.id = CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END
		LEFT JOIN user_profiles p ON p.user_id = u.id
		LEFT JOIN user_avatars av ON av.user_id = u.id AND av.audit_status = 'approved'
		LEFT JOIN LATERAL (
		    SELECT msg_type, content FROM messages
		    WHERE conversation_id = c.id
		    ORDER BY seq DESC LIMIT 1
		) last ON true
		WHERE (c.user_a = $1 OR c.user_b = $1)
		ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
		LIMIT $2
	`, uid, limit).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]ConversationView, 0)
	for rows.Next() {
		var v ConversationView
		var lastType, lastContent string
		if err := rows.Scan(
			&v.ID, &v.MatchID, &v.Status, &v.LastMessageAt, &v.Unread,
			&v.PeerID, &v.PeerNickname, &v.PeerAvatar, &v.PeerCity,
			&lastType, &lastContent, &v.MatchedAt,
		); err != nil {
			return nil, err
		}
		if lastType == "image" {
			v.LastMessage = "[图片]"
		} else {
			v.LastMessage = lastContent
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// Messages 拉取历史消息（游标分页，按 seq 倒序取，返回时正序）。
func (s *ChatService) Messages(ctx context.Context, uid, convID int64, beforeSeq int64, limit int) ([]MessageView, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	if err := s.assertMember(ctx, uid, convID); err != nil {
		return nil, err
	}

	q := s.db.WithContext(ctx).Model(&model.Message{}).
		Where("conversation_id = ?", convID)
	if beforeSeq > 0 {
		q = q.Where("seq < ?", beforeSeq)
	}

	var msgs []model.Message
	if err := q.Order("seq DESC").Limit(limit).Find(&msgs).Error; err != nil {
		return nil, err
	}

	// 反转成正序（前端从上到下渲染）
	// 用 make 而不是 var，保证空结果序列化成 [] 而不是 null
	out := make([]MessageView, 0, len(msgs))
	for i := len(msgs) - 1; i >= 0; i-- {
		m := msgs[i]
		out = append(out, MessageView{
			ID: m.ID, FromUser: m.FromUser, MsgType: m.MsgType,
			Content: deref(m.Content), Seq: m.Seq, Status: m.Status,
			CreatedAt: m.CreatedAt, ClientMsgID: m.ClientMsgID,
		})
	}
	return out, nil
}

type SendInput struct {
	UserID         int64
	ConversationID int64
	MsgType        string
	Content        string
	ClientMsgID    string
}

// Send 发送消息。
//
// 幂等靠 (conversation_id, client_msg_id) 唯一索引兜底——网络重传不会产生重复消息。
// seq 由服务端分配，保证会话内严格有序（PRD 12.4）。
func (s *ChatService) Send(ctx context.Context, in SendInput) (*MessageView, error) {
	if err := s.assertMember(ctx, in.UserID, in.ConversationID); err != nil {
		return nil, err
	}
	if in.MsgType == "" {
		in.MsgType = "text"
	}
	if in.MsgType == "text" {
		in.Content = strings.TrimSpace(in.Content)
		if in.Content == "" {
			return nil, ErrEmptyMessage
		}
		if len([]rune(in.Content)) > maxMessageLen {
			return nil, fmt.Errorf("消息不能超过 %d 字", maxMessageLen)
		}
	}

	var out MessageView
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var conv model.Conversation
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			First(&conv, in.ConversationID).Error; err != nil {
			return err
		}
		if conv.Status != model.ConvActive {
			return ErrConversationClosed
		}

		// 分配 seq：取当前最大值 +1。行锁保证并发下不会重号。
		var maxSeq int64
		if err := tx.Model(&model.Message{}).
			Where("conversation_id = ?", in.ConversationID).
			Select("COALESCE(MAX(seq), 0)").Scan(&maxSeq).Error; err != nil {
			return err
		}

		content := in.Content
		var clientID *string
		if in.ClientMsgID != "" {
			clientID = &in.ClientMsgID
		}

		msg := model.Message{
			ConversationID: in.ConversationID,
			FromUser:       in.UserID,
			MsgType:        in.MsgType,
			Content:        &content,
			ClientMsgID:    clientID,
			Seq:            maxSeq + 1,
			Status:         "sent",
		}

		r := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&msg)
		if r.Error != nil {
			return r.Error
		}

		// ⚠️ 判重不能用 RowsAffected —— 实测 GORM(pgx) 在 ON CONFLICT DO NOTHING
		// 命中冲突时仍然返回 1，会让我们误以为插入成功，进而返回一个 id=0 的空对象。
		//
		// 可靠的判据是主键：GORM 的 postgres 驱动用 INSERT ... RETURNING id，
		// 冲突未插入时不会有返回行，模型上的 ID 保持为零值。
		if msg.ID == 0 {
			// 冲突：把已存在的那条取回来返回。
			//
			// 注意这里**不能直接 return** —— 提前返回会跳过下面构造 out 的代码，
			// 结果接口返回一个 id=0 的空对象（这个坑我踩过一次）。
			if err := tx.Where("conversation_id = ? AND client_msg_id = ?",
				in.ConversationID, in.ClientMsgID).First(&msg).Error; err != nil {
				return err
			}
			out = toMessageView(msg)
			return nil
		}

		// 更新会话末尾与对方的未读数
		now := time.Now()
		updates := map[string]any{
			"last_message_id": msg.ID,
			"last_message_at": now,
		}
		if conv.UserA == in.UserID {
			updates["unread_b"] = gorm.Expr("unread_b + 1")
		} else {
			updates["unread_a"] = gorm.Expr("unread_a + 1")
		}
		if err := tx.Model(&model.Conversation{}).Where("id = ?", conv.ID).
			Updates(updates).Error; err != nil {
			return err
		}

		out = toMessageView(msg)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// MarkRead 清空我的未读计数。
func (s *ChatService) MarkRead(ctx context.Context, uid, convID int64) error {
	if err := s.assertMember(ctx, uid, convID); err != nil {
		return err
	}
	return s.db.WithContext(ctx).Exec(`
		UPDATE conversations
		   SET unread_a = CASE WHEN user_a = ? THEN 0 ELSE unread_a END,
		       unread_b = CASE WHEN user_b = ? THEN 0 ELSE unread_b END
		 WHERE id = ?
	`, uid, uid, convID).Error
}

// PeerOf 返回会话中的对方 id（用于 WebSocket 定向推送）。
func (s *ChatService) PeerOf(ctx context.Context, uid, convID int64) (int64, error) {
	var conv model.Conversation
	if err := s.db.WithContext(ctx).First(&conv, convID).Error; err != nil {
		return 0, err
	}
	if conv.UserA == uid {
		return conv.UserB, nil
	}
	if conv.UserB == uid {
		return conv.UserA, nil
	}
	return 0, ErrNotInConversation
}

func (s *ChatService) assertMember(ctx context.Context, uid, convID int64) error {
	var n int64
	err := s.db.WithContext(ctx).Model(&model.Conversation{}).
		Where("id = ? AND (user_a = ? OR user_b = ?)", convID, uid, uid).
		Count(&n).Error
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotInConversation
	}
	return nil
}

func toMessageView(m model.Message) MessageView {
	return MessageView{
		ID: m.ID, FromUser: m.FromUser, MsgType: m.MsgType,
		Content: deref(m.Content), Seq: m.Seq, Status: m.Status,
		CreatedAt: m.CreatedAt, ClientMsgID: m.ClientMsgID,
	}
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
