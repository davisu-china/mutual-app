package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/davisu-china/mutual-app/server/internal/model"
)

// 卡池必须只出异性。
//
// 这条用例来自一个真实 bug：Cards 里判断目标性别的两个分支写成了同一个值
// （都取 GenderFemale），if 等于空操作 —— **女性用户会看到女性**。
// 男性视角是对的，所以只有女性账号才会暴露，靠人肉测很容易漏。
func TestIntegrationDeckIsOppositeGender(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)
	viewer := seedUser(t, db, "135"+suffix, model.GenderFemale, 165)
	male := seedUser(t, db, "134"+suffix, model.GenderMale, 178)
	female := seedUser(t, db, "133"+suffix, model.GenderFemale, 160)
	cleanUsers(t, db, viewer.ID, male.ID, female.ID)

	svc := NewDiscoveryService(db, NewProfileService(db, NewExposureService(db)), NewExposureService(db))
	cards, err := svc.Cards(ctx, viewer.ID, 10)
	if err != nil {
		t.Fatalf("取卡失败: %v", err)
	}

	ids := map[int64]bool{}
	for _, c := range cards {
		ids[c.UserID] = true
	}
	if !ids[male.ID] {
		t.Errorf("女性用户的卡池里应当有男性用户 %d，实际拿到 %v", male.ID, ids)
	}
	if ids[female.ID] {
		t.Errorf("女性用户的卡池里不该出现同性用户 %d", female.ID)
	}
	if ids[viewer.ID] {
		t.Error("卡池里不该出现自己")
	}
}
