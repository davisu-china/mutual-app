package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/davisu-china/mutual-app/server/internal/model"
)

// 聊天室的对方信息。
//
// 这段是给「标题显示对方昵称与头像」用的：消息接口只回消息的话，前端压根不知道
// 对面是谁，标题只能显示「会话 3」这种占位符。这里盯住三件事：
// 取到的是**对方**（不是自己）、头像取的是**相册第一张已过审照片**、
// 以及**不是这段会话的成员拿不到**（否则就能靠猜 id 看别人的会话）。
func TestIntegrationChatPeer(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)
	a := seedUser(t, db, "131"+suffix, model.GenderMale, 178)
	b := seedUser(t, db, "130"+suffix, model.GenderFemale, 165)
	c := seedUser(t, db, "129"+suffix, model.GenderFemale, 162)
	cleanUsers(t, db, a.ID, b.ID, c.ID)

	// seedUser 已经给 b 造了一张 sort_order=1 的占位照片，把它改造成「第一张」，
	// 再补一张排在后面的——这样才能验出「取的是第一张」而不是随便一张
	// （直接再插一条 sort_order=1 会撞 uq_photo_order）
	if err := db.Model(&model.UserPhoto{}).
		Where("user_id = ? AND sort_order = 1", b.ID).
		Update("url", "/api/v1/media/photos/b-first.jpg").Error; err != nil {
		t.Fatal(err)
	}
	db.Create(&model.UserPhoto{UserID: b.ID, URL: "/api/v1/media/photos/b-second.jpg", SortOrder: 2,
		AuditStatus: model.AuditApproved, Visibility: "public"})

	lo, hi := orderPair(a.ID, b.ID)
	m := &model.MatchRecord{UserA: lo, UserB: hi, Status: model.MatchActive}
	if err := db.Create(m).Error; err != nil {
		t.Fatal(err)
	}
	conv := &model.Conversation{MatchID: m.ID, UserA: lo, UserB: hi, Status: model.ConvActive}
	if err := db.Create(conv).Error; err != nil {
		t.Fatal(err)
	}

	svc := NewChatService(db)

	// a 看到的对方应当是 b
	peer, err := svc.Peer(ctx, a.ID, conv.ID)
	if err != nil {
		t.Fatalf("取对方失败: %v", err)
	}
	if peer.UserID != b.ID {
		t.Errorf("a 的对方应当是 %d，实际 %d", b.ID, peer.UserID)
	}
	if peer.Nickname == "" {
		t.Error("昵称不能为空——聊天室标题就靠它")
	}
	if peer.AvatarURL != "/api/v1/media/photos/b-first.jpg" {
		t.Errorf("头像应当是相册第一张（b-first），实际 %q", peer.AvatarURL)
	}

	// b 看到的对方应当是 a
	peer2, err := svc.Peer(ctx, b.ID, conv.ID)
	if err != nil {
		t.Fatalf("取对方失败: %v", err)
	}
	if peer2.UserID != a.ID {
		t.Errorf("b 的对方应当是 %d，实际 %d", a.ID, peer2.UserID)
	}

	// 不相干的第三人拿不到
	if _, err := svc.Peer(ctx, c.ID, conv.ID); err == nil {
		t.Error("不是会话成员也拿到了对方信息")
	}
}
