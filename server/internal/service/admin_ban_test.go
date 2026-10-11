package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/davisu-china/mutual-app/server/internal/model"
)

// 封禁：**理由必填**，而且要真的落库、能被用户读到。
//
// 这条链路上每一环都不会自己报错：理由没存 → App 只能显示一句通用话术；
// 状态没改 → 人还能继续刷；media 没拦 → 被封的相册还挂在线上。
func TestIntegrationBanUser(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)

	victim := seedUser(t, db, "132"+suffix, model.GenderFemale, 165)
	admin := seedUser(t, db, "131"+suffix, model.GenderMale, 178)
	cleanUsers(t, db, victim.ID, admin.ID)
	db.Model(&model.User{}).Where("id = ?", admin.ID).Update("is_admin", true)

	svc := NewAdminService(db)
	dis := NewDiscoveryService(db, NewProfileService(db, NewExposureService(db)), NewExposureService(db))
	upload := NewUploadService(db, nil, nil)

	// ① 不填理由不给封（它会原话展示给用户，空着等于让人莫名其妙上不去）
	if err := svc.BanUser(ctx, admin.ID, victim.ID, "   "); err == nil {
		t.Fatal("空理由应当被拒")
	} else if _, ok := err.(InvalidInputError); !ok {
		t.Fatalf("应当是用户可见的 InvalidInputError，实际 %T: %v", err, err)
	}

	// ② 不能封管理员（封了连后台都进不去，只能改库救）
	if err := svc.BanUser(ctx, admin.ID, admin.ID, "手滑试试"); err == nil {
		t.Fatal("封管理员应当被拒")
	}

	// ③ 正常封禁
	const reason = "头像与本人不符，请更换后联系客服"
	if err := svc.BanUser(ctx, admin.ID, victim.ID, reason); err != nil {
		t.Fatalf("封禁失败: %v", err)
	}
	var u model.User
	if err := db.First(&u, victim.ID).Error; err != nil {
		t.Fatal(err)
	}
	if u.Status != model.UserBanned {
		t.Errorf("状态应当是 banned，实际 %q", u.Status)
	}
	if u.BanReason == nil || *u.BanReason != reason {
		t.Errorf("理由没落库（App 靠它告诉用户为什么）：%v", u.BanReason)
	}
	if u.BannedAt == nil || u.BannedBy == nil || *u.BannedBy != admin.ID {
		t.Errorf("封禁时间/操作人没记全：at=%v by=%v", u.BannedAt, u.BannedBy)
	}

	var auditCount int64
	db.Model(&model.AuditLog{}).Where("target_type = 'user' AND target_id = ? AND action = 'ban'", victim.ID).
		Count(&auditCount)
	if auditCount != 1 {
		t.Errorf("audit_logs 应当有一条 ban 记录，实际 %d 条", auditCount)
	}

	// ④ 封完之后：卡池里没有他、他的主页看不了、他的图（含头像）读不出来
	cards, err := dis.Cards(ctx, admin.ID, cardBatchSize)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range cards {
		if c.UserID == victim.ID {
			t.Error("被封的人不该出现在卡池里")
		}
	}
	if _, err := NewProfileService(db, NewExposureService(db)).
		PublicProfile(ctx, admin.ID, victim.ID); err == nil {
		t.Error("被封的人的主页不该还能看")
	}
	// 头像是最容易被漏掉的一处：MediaReadable 对 avatars 前缀原来是直接放行的
	if ok, err := upload.MediaReadable(ctx, admin.ID, fmt.Sprintf("avatars/%d/head.jpg", victim.ID)); err != nil || ok {
		t.Errorf("被封的人的头像不该可读（ok=%v err=%v）", ok, err)
	}

	// ⑤ 解封：状态回 active，痕迹清掉，audit 里留一条 unban
	if err := svc.UnbanUser(ctx, admin.ID, victim.ID); err != nil {
		t.Fatalf("解封失败: %v", err)
	}
	// ⚠️ 必须读进**新的** struct：GORM 往一个已经填过值的 struct 里扫时，
	// 不会把数据库里的 NULL 覆盖回来（`u` 里还留着封禁时的 banned_at），
	// 于是断言会误报——库是对的，是读法不对。
	var after model.User
	if err := db.First(&after, victim.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.Status != model.UserActive || after.BanReason != nil || after.BannedAt != nil || after.BannedBy != nil {
		t.Errorf("解封后应当是 active 且没有封禁痕迹：status=%q reason=%v at=%v by=%v",
			after.Status, after.BanReason, after.BannedAt, after.BannedBy)
	}
	db.Model(&model.AuditLog{}).Where("target_type = 'user' AND target_id = ? AND action = 'unban'", victim.ID).
		Count(&auditCount)
	if auditCount != 1 {
		t.Errorf("audit_logs 应当有一条 unban 记录，实际 %d 条", auditCount)
	}

	// ⑥ 已经解封的再解一次：说清楚，而不是静默成功
	if err := svc.UnbanUser(ctx, admin.ID, victim.ID); err == nil {
		t.Error("重复解封应当被拒")
	}
}
