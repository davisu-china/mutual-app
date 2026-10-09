package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/davisu-china/mutual-app/server/internal/model"
)

// 他人主页上的「我和 TA 的关系」。
//
// 这是用户实测报上来的问题：**已经配对了，主页上还能再点一次「喜欢」**——
// 后端是幂等的（不会重复配对），但用户点下去只看到重复的「配对成功」，像是没生效。
// 前端要按状态渲染，就得由接口告诉它关系。
func TestIntegrationProfileRelation(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)
	a := seedUser(t, db, "128"+suffix, model.GenderMale, 178)
	b := seedUser(t, db, "127"+suffix, model.GenderFemale, 165)
	cleanUsers(t, db, a.ID, b.ID)

	cfg := testCfg()
	action := NewActionService(db, cfg, nil, NewExposureService(db))
	profile := NewProfileService(db, NewExposureService(db))

	rel := func() *RelationView {
		v, err := profile.PublicProfile(ctx, a.ID, b.ID)
		if err != nil {
			t.Fatalf("取资料失败: %v", err)
		}
		if v.Relation == nil {
			t.Fatal("看别人的主页必须带关系信息，否则前端只能一律显示「喜欢 / 跳过」")
		}
		return v.Relation
	}

	// 还没打过交道
	if r := rel(); r.Liked || r.Matched || r.Passed {
		t.Fatalf("还没操作就报出关系: %+v", r)
	}

	// A 喜欢 B：liked，但还没配对
	if _, err := action.Do(ctx, ActionInput{FromUser: a.ID, ToUser: b.ID, Action: model.ActionLike, Source: model.SourceCard}); err != nil {
		t.Fatalf("like 失败: %v", err)
	}
	if r := rel(); !r.Liked || r.Matched {
		t.Fatalf("喜欢之后应当是 liked 且未配对，实际 %+v", r)
	}

	// B 回喜欢 → 配对
	res, err := action.Do(ctx, ActionInput{FromUser: b.ID, ToUser: a.ID, Action: model.ActionLike, Source: model.SourceCard})
	if err != nil {
		t.Fatalf("回喜欢失败: %v", err)
	}
	if !res.Matched {
		t.Fatal("双向喜欢应当配对")
	}
	if r := rel(); !r.Matched || !r.Liked {
		t.Fatalf("配对后应当是 matched+liked，实际 %+v", r)
	}

	// 再点一次喜欢：幂等——不报错、不重复配对，关系不变
	again, err := action.Do(ctx, ActionInput{FromUser: a.ID, ToUser: b.ID, Action: model.ActionLike, Source: model.SourcePlaza})
	if err != nil {
		t.Fatalf("重复喜欢不该报错: %v", err)
	}
	if !again.AlreadyActed {
		t.Error("重复喜欢应当返回 alreadyActed（否则前端会以为这次才配上）")
	}
	if r := rel(); !r.Matched {
		t.Fatalf("重复喜欢之后仍然是配对的，实际 %+v", r)
	}

	// 看自己的主页不带关系信息（那是给别人看的字段）
	self, err := profile.MyProfile(ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if self.Relation != nil {
		t.Error("看自己的主页不该带 relation")
	}
}
