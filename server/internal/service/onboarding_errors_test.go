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

// 填资料链路上的校验错误必须是「给用户看」的类型。
//
// 这些错误以前是 errors.New，落到 mapErr 的 default 分支变成
// 「服务暂时不可用，请稍后重试」——五步填资料的主流程上，用户填错了什么
// 完全看不出来。这条用例锁住这个行为：一旦有人把它们改回 errors.New，就会红。
func TestIntegrationOnboardingErrorsAreUserFacing(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)
	u := seedUser(t, db, "136"+suffix, model.GenderMale, 178)
	cleanUsers(t, db, u.ID)

	svc := NewProfileService(db, NewExposureService(db))

	// 1) 没填兴趣：应当报「请填写恰好 3 个兴趣爱好」，而且是用户可见的类型
	err := svc.CompleteOnboarding(ctx, u.ID)
	if err == nil {
		t.Fatal("什么都还没填就完成了 onboarding")
	}
	var inv InvalidInputError
	if !errors.As(err, &inv) {
		t.Fatalf("校验错误应当是 InvalidInputError（否则前端只看到「服务暂时不可用」），实际 %T: %v", err, err)
	}
	if inv.Msg == "" {
		t.Fatal("面向用户的错误消息不能为空")
	}

	// 2) 兴趣介绍太短：消息要指明是哪一条、差多少字数
	err = svc.SetHobbies(ctx, u.ID, []HobbyView{
		{Name: "阅读", Description: "太短", SortOrder: 1},
		{Name: "摄影", Description: "周末常去拍城市街景与人像", SortOrder: 2},
		{Name: "徒步", Description: "爬过几座千米以上的山", SortOrder: 3},
	})
	if !errors.As(err, &inv) {
		t.Fatalf("兴趣过短也该是 InvalidInputError，实际 %T: %v", err, err)
	}
	if !strings.HasPrefix(inv.Msg, "「阅读」") {
		t.Fatalf("错误消息应当指明是哪一个兴趣，实际 %q", inv.Msg)
	}
}
