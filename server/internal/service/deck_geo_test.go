package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/davisu-china/mutual-app/server/internal/model"
)

// moveTo 把某个人的现居地改到指定省市（`seedUser` 默认把所有人放在杭州）
func moveTo(t *testing.T, db *gorm.DB, uid int64, prov, city string) {
	t.Helper()
	if err := db.Model(&model.UserProfile{}).Where("user_id = ?", uid).
		Updates(map[string]any{"city_prov": prov, "city_city": city}).Error; err != nil {
		t.Fatalf("改现居地失败: %v", err)
	}
}

// 卡池的地理**逐级放宽**：同城 → 同省 → 全国。
//
// 这三档的顺序和"什么时候才放宽"都是有产品含义的，而且写错不会报错：
// 太容易放宽 ⇒ 用户刷到一堆几百公里外的人；不放宽 ⇒ 早期直接给一张空卡。
// 所以把三档分别钉住。
//
// ⚠️ 第三档（全国）是 2026-10-11 按用户要求加的：**早期没有用户**，
// 同城同省都可能是空的，那时候宁可给个远一点的推荐，也不能给空卡池。
func TestIntegrationDeckGeoFallback(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)

	// 我（女）在杭州；同城一个、同省（宁波）一个、外省（成都）一个
	me := seedUser(t, db, "136"+suffix, model.GenderFemale, 165)
	sameCity := seedUser(t, db, "135"+suffix, model.GenderMale, 178)
	sameProv := seedUser(t, db, "134"+suffix, model.GenderMale, 178)
	otherProv := seedUser(t, db, "133"+suffix, model.GenderMale, 178)
	cleanUsers(t, db, me.ID, sameCity.ID, sameProv.ID, otherProv.ID)

	moveTo(t, db, sameProv.ID, "浙江省", "宁波市")
	moveTo(t, db, otherProv.ID, "四川省", "成都市")

	svc := NewDiscoveryService(db, NewProfileService(db, NewExposureService(db)), NewExposureService(db))
	deck := func(viewer int64) map[int64]bool {
		t.Helper()
		cards, err := svc.Cards(ctx, viewer, cardBatchSize)
		if err != nil {
			t.Fatalf("取卡失败: %v", err)
		}
		ids := map[int64]bool{}
		for _, c := range cards {
			ids[c.UserID] = true
		}
		return ids
	}

	// ① 同城有人：只出同城的人，同省/外省的不该"搭车"塞进来
	got := deck(me.ID)
	if !got[sameCity.ID] {
		t.Errorf("同城有人时应当出同城的人 %d，实际拿到 %v", sameCity.ID, got)
	}
	if got[sameProv.ID] {
		t.Errorf("同城已经有人，不该放宽到同省（%d 被塞进来了）", sameProv.ID)
	}
	if got[otherProv.ID] {
		t.Errorf("同城已经有人，不该放宽到全国（%d 被塞进来了）", otherProv.ID)
	}

	// ② 同城没人、同省有人：放宽到同省，但仍然不跨省
	moveTo(t, db, me.ID, "浙江省", "温州市")
	got = deck(me.ID)
	if !got[sameProv.ID] {
		t.Errorf("同城没人时应当放宽到同省 %d，实际拿到 %v", sameProv.ID, got)
	}
	if got[otherProv.ID] {
		t.Errorf("同省已经有人，不该放宽到全国（%d 被塞进来了）", otherProv.ID)
	}

	// ③ 同城同省都没人：必须掉到全国（否则早期用户拿到的是空卡池）
	moveTo(t, db, me.ID, "西藏自治区", "拉萨市")
	got = deck(me.ID)
	if !got[otherProv.ID] {
		t.Errorf("同城同省都没人时应当放宽到全国（外省的 %d 应当出现），实际拿到 %v", otherProv.ID, got)
	}
}
