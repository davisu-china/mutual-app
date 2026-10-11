package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/davisu-china/mutual-app/server/internal/model"
)

// 封禁 = **限制互动**，不是"踢出去"（2026-10-11 用户明确的口径）。
//
// 所以这条用例是**成对**的：**能看的**（推荐、历史消息、自己的资料）与
// **不能操作的**（划卡＝喜欢/跳过、发消息）各钉一遍。
//
// ⚠️ 两边都犯过：先是"顺手把整号拦了"（表现是封禁用户连推荐页都打不开），
// 后来又只拦了 like、把跳过留着（用户反馈"还是可以左滑右滑"）。
func TestIntegrationBanRestrictsInteractionsOnly(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)

	me := seedUser(t, db, "129"+suffix, model.GenderFemale, 165)     // 会被封的人
	liked := seedUser(t, db, "128"+suffix, model.GenderMale, 178)    // 封之前互相喜欢过
	fresh := seedUser(t, db, "127"+suffix, model.GenderMale, 178)    // 封之后用来试"跳过"
	cleanUsers(t, db, me.ID, liked.ID, fresh.ID)

	actionSvc := NewActionService(db, testCfg(), nil, NewExposureService(db))
	chatSvc := NewChatService(db)
	profileSvc := NewProfileService(db, NewExposureService(db))
	disc := NewDiscoveryService(db, profileSvc, NewExposureService(db))

	// 先正常互动一次：互相喜欢 → 建会话（后面要在这个会话里试发消息）
	like := func(from, to int64) {
		t.Helper()
		if _, err := actionSvc.Do(ctx, ActionInput{FromUser: from, ToUser: to, Action: model.ActionLike, Source: model.SourceCard}); err != nil {
			t.Fatalf("封禁前的喜欢应当成功: %v", err)
		}
	}
	like(me.ID, liked.ID)
	like(liked.ID, me.ID)

	var convID int64
	if err := db.Raw(`SELECT id FROM conversations WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)`,
		me.ID, liked.ID, liked.ID, me.ID).Row().Scan(&convID); err != nil {
		t.Fatalf("取会话失败: %v", err)
	}

	const reason = "头像与本人不符，请更换后联系客服"
	if err := NewAdminService(db).BanUser(ctx, liked.ID, me.ID, reason); err != nil {
		t.Fatalf("封禁失败: %v", err)
	}

	// ---------- 还能做的 ----------

	// ① 看推荐：卡池照常（只是他自己不会出现在别人的池子里）——"能看、不能操作"
	if _, err := disc.Cards(ctx, me.ID, cardBatchSize); err != nil {
		t.Errorf("被限制的账号仍然应当能看推荐，实际 %v", err)
	}

	// ② 跳过：**也拦**（被限制就不该再划卡；"看"不受影响）
	_, err := actionSvc.Do(ctx, ActionInput{FromUser: me.ID, ToUser: fresh.ID, Action: model.ActionPass, Source: model.SourceCard})
	if !errors.Is(err, ErrAccountRestricted) {
		t.Errorf("被限制的账号不该还能跳过，实际 %T: %v", err, err)
	}

	// ③ 看会话历史：能看（历史消息也是"看"）
	if _, err := chatSvc.Messages(ctx, me.ID, convID, 0, 20); err != nil {
		t.Errorf("被限制的账号仍然应当能看历史消息，实际 %v", err)
	}

	// ④ 自己的资料要带上限制信息（客户端靠它把说明摆到界面上）
	p, err := profileSvc.MyProfile(ctx, me.ID)
	if err != nil {
		t.Fatalf("取自己资料失败: %v", err)
	}
	if p.AccountStatus != model.UserBanned || p.BanReason == nil || *p.BanReason != reason {
		t.Errorf("自己的资料应当带 accountStatus=banned 和原因，实际 status=%q reason=%v", p.AccountStatus, p.BanReason)
	}

	// ---------- 不能做的 ----------

	// ⑤ 喜欢别人：被拦，而且话要说清楚是哪一件事
	_, err = actionSvc.Do(ctx, ActionInput{FromUser: me.ID, ToUser: fresh.ID, Action: model.ActionLike, Source: model.SourceCard})
	if !errors.Is(err, ErrAccountRestricted) {
		t.Fatalf("被限制的账号不该能喜欢别人，实际 %T: %v", err, err)
	}
	if !strings.Contains(err.Error(), "喜欢别人") {
		t.Errorf("错误消息要指明是哪件事做不了，实际 %q", err.Error())
	}

	// ⑥ 发消息：被拦
	_, err = chatSvc.Send(ctx, SendInput{UserID: me.ID, ConversationID: convID, Content: "在吗"})
	if !errors.Is(err, ErrAccountRestricted) {
		t.Fatalf("被限制的账号不该能发消息，实际 %T: %v", err, err)
	}

	// ⑦ 限制只针对他自己：对方在同一会话里照常发得出去
	if _, err := chatSvc.Send(ctx, SendInput{UserID: liked.ID, ConversationID: convID, Content: "在"});
		err != nil {
		t.Errorf("限制不该影响对方发消息，实际 %v", err)
	}

	// ---------- 解封后恢复 ----------

	if err := NewAdminService(db).UnbanUser(ctx, liked.ID, me.ID); err != nil {
		t.Fatalf("解封失败: %v", err)
	}
	if _, err := actionSvc.Do(ctx, ActionInput{FromUser: me.ID, ToUser: fresh.ID, Action: model.ActionLike, Source: model.SourceCard}); err != nil {
		t.Errorf("解封后应当能正常喜欢别人，实际 %v", err)
	}
	if _, err := chatSvc.Send(ctx, SendInput{UserID: me.ID, ConversationID: convID, Content: "解封了"}); err != nil {
		t.Errorf("解封后应当能正常发消息，实际 %v", err)
	}
}
