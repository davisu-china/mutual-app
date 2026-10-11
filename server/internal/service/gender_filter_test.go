package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/davisu-china/mutual-app/server/internal/model"
)

// 「只看到异性」这件事必须在**所有会列出别人的地方**都成立。
//
// 划卡一直有（`fetchCandidates` 的 `u.gender = ?`），但广场和「谁喜欢我 / 谁看过我」
// 原来漏了——用户是在广场里直接看出同性才问的（2026-10-12）。
//
// ⚠️ 这三条查询都是手写的原始 SQL，**参数个数对不上只有运行到才会炸**，
// 所以这条用例真的把三个入口都调一遍（不是只 grep SQL）。
func TestIntegrationOnlyOppositeGenderIsListed(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)

	me := seedUser(t, db, "124"+suffix, model.GenderFemale, 165)   // 我：女
	male := seedUser(t, db, "123"+suffix, model.GenderMale, 178)   // 男：该看到
	female := seedUser(t, db, "122"+suffix, model.GenderFemale, 166) // 女：不该看到
	cleanUsers(t, db, me.ID, male.ID, female.ID)

	actionSvc := NewActionService(db, testCfg(), nil, NewExposureService(db))
	socialSvc := NewSocialService(db)
	disc := NewDiscoveryService(db, NewProfileService(db, NewExposureService(db)), NewExposureService(db))

	act := func(from int64, kind string) {
		t.Helper()
		if _, err := actionSvc.Do(ctx, ActionInput{FromUser: from, ToUser: me.ID, Action: kind, Source: model.SourceCard}); err != nil {
			t.Fatalf("%s 动作失败: %v", kind, err)
		}
	}
	// 男女都对我做过 like 和 visit
	act(male.ID, model.ActionLike)
	act(female.ID, model.ActionLike)
	act(male.ID, model.ActionVisit)
	act(female.ID, model.ActionVisit)

	ids := func(list []Interactor) map[int64]bool {
		out := map[int64]bool{}
		for _, it := range list {
			out[it.UserID] = true
		}
		return out
	}

	// ① 谁喜欢我：只有异性
	likers, err := socialSvc.LikesMe(ctx, me.ID, 50)
	if err != nil {
		t.Fatalf("谁喜欢我失败（很可能是 SQL 参数与占位符对不上）: %v", err)
	}
	got := ids(likers)
	if !got[male.ID] {
		t.Errorf("异性（男）点过赞，应当出现在「谁喜欢我」里，实际 %v", got)
	}
	if got[female.ID] {
		t.Errorf("同性不该出现在「谁喜欢我」里，实际 %v", got)
	}

	// ② 谁看过我：只有异性
	visitors, err := socialSvc.VisitsMe(ctx, me.ID, 50)
	if err != nil {
		t.Fatalf("谁看过我失败: %v", err)
	}
	got = ids(visitors)
	if !got[male.ID] {
		t.Errorf("异性看过我，应当出现在「谁看过我」里，实际 %v", got)
	}
	if got[female.ID] {
		t.Errorf("同性不该出现在「谁看过我」里，实际 %v", got)
	}

	// ③ 广场：只有异性（这条原来漏得最明显——用户就是在广场里看出来的）
	cards, _, err := disc.Plaza(ctx, me.ID, PlazaFilter{}, 20)
	if err != nil {
		t.Fatalf("广场失败: %v", err)
	}
	got = map[int64]bool{}
	for _, c := range cards {
		got[c.UserID] = true
	}
	if !got[male.ID] {
		t.Errorf("异性的资料应当出现在广场里，实际 %v", got)
	}
	if got[female.ID] {
		t.Errorf("同性不该出现在广场里，实际 %v", got)
	}
}
