package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/davisu-china/mutual-app/server/internal/auth"
	"github.com/davisu-china/mutual-app/server/internal/model"
)

// 这一组测的是「用户可见的状态不能变成 500」在 **service 层**的那一半。
//
// handler 的 `mapErr` 只认识哨兵错误和 `InvalidInputError`
// （映射本身有 `handler/response_test.go` 钉着），所以只要某个错误是裸
// `errors.New`，用户拿到的就是 500「服务暂时不可用」。真实踩过两处：
//   - 拉黑之后再看对方资料；
//   - 被封禁的账号登录。
//
// 都是很确定的状态，却报成了服务故障。这里从"实际会发生这个错误的那条路径"
// 去断言错误的**类型**，而不只是断言它报错了——只断言"报错"是抓不到这个 bug 的。

func TestIntegrationBlockHidesProfileBothWays(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)
	a := seedUser(t, db, "151"+suffix, model.GenderMale, 178)
	b := seedUser(t, db, "150"+suffix, model.GenderFemale, 165)
	cleanUsers(t, db, a.ID, b.ID)

	profile := NewProfileService(db, NewExposureService(db))
	action := NewActionService(db, testCfg(), nil, NewExposureService(db))

	if _, err := profile.PublicProfile(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("拉黑前应当看得到对方资料，实际 %v", err)
	}

	if err := action.Block(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("拉黑失败: %v", err)
	}

	// 拉黑是**双向阻断**的：谁拉黑谁都不重要，两边都看不到
	for _, tc := range []struct {
		name           string
		viewer, target int64
	}{
		{"我拉黑了对方", a.ID, b.ID},
		{"对方拉黑了我", b.ID, a.ID},
	} {
		_, err := profile.PublicProfile(ctx, tc.viewer, tc.target)
		if err == nil {
			t.Fatalf("%s：应当看不到资料", tc.name)
		}
		if !errors.Is(err, ErrProfileHidden) {
			t.Fatalf("%s：应当是 ErrProfileHidden，否则前端只看到「服务暂时不可用」；实际 %T: %v", tc.name, err, err)
		}
	}

	if err := action.Unblock(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("解除拉黑失败: %v", err)
	}
	if _, err := profile.PublicProfile(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("解除拉黑后应当又能看到，实际 %v", err)
	}
}

func TestIntegrationUnmatchErrorsAreUserFacing(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)
	a := seedUser(t, db, "161"+suffix, model.GenderMale, 178)
	b := seedUser(t, db, "160"+suffix, model.GenderFemale, 165)
	c := seedUser(t, db, "162"+suffix, model.GenderMale, 180)
	cleanUsers(t, db, a.ID, b.ID, c.ID)

	action := NewActionService(db, testCfg(), nil, NewExposureService(db))

	// 1) 配对 id 不存在（例如对方已经先解除了，App 拿到的还是旧 id）
	err := action.Unmatch(ctx, a.ID, 999999999)
	if !errors.Is(err, ErrMatchNotFound) {
		t.Fatalf("不存在的配对应当是 ErrMatchNotFound，实际 %T: %v", err, err)
	}

	// 2) 拿别人的配对 id 来解——不能只报错，还要能说清是「没权限」
	lo, hi := orderPair(a.ID, b.ID)
	m := &model.MatchRecord{UserA: lo, UserB: hi, Status: model.MatchActive}
	if err := db.Create(m).Error; err != nil {
		t.Fatalf("造配对失败: %v", err)
	}
	if err := action.Unmatch(ctx, c.ID, m.ID); !errors.Is(err, ErrNotMatchOwner) {
		t.Fatalf("解别人的配对应当是 ErrNotMatchOwner，实际 %T: %v", err, err)
	}

	// 3) 正常解除仍然要成功
	if err := action.Unmatch(ctx, a.ID, m.ID); err != nil {
		t.Fatalf("本人解除配对应成功，实际 %v", err)
	}
}

func TestIntegrationDeletePhotoErrorsAreUserFacing(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)
	a := seedUser(t, db, "171"+suffix, model.GenderMale, 178)
	b := seedUser(t, db, "170"+suffix, model.GenderFemale, 165)
	cleanUsers(t, db, a.ID, b.ID)

	svc := NewUploadService(db, testCfg(), nil)

	var mine model.UserPhoto
	db.Where("user_id = ?", a.ID).First(&mine)

	// 只剩一张：服务端拒删（界面上也把入口收掉了，这是兜底）
	if err := svc.DeletePhoto(ctx, a.ID, mine.ID); !errors.Is(err, ErrPhotoLastOne) {
		t.Fatalf("删最后一张应当是 ErrPhotoLastOne，实际 %T: %v", err, err)
	}

	// 补一张，让"张数不够"这一关过得去，才能走到"这照片不是你的"
	db.Create(&model.UserPhoto{UserID: a.ID, URL: "y", SortOrder: 2, AuditStatus: model.AuditApproved, Visibility: "public"})
	var theirs model.UserPhoto
	db.Where("user_id = ?", b.ID).First(&theirs)
	if err := svc.DeletePhoto(ctx, a.ID, theirs.ID); !errors.Is(err, ErrPhotoNotFound) {
		t.Fatalf("删别人的照片应当是 ErrPhotoNotFound，实际 %T: %v", err, err)
	}

	// 正常的删除仍然要成功
	if err := svc.DeletePhoto(ctx, a.ID, mine.ID); err != nil {
		t.Fatalf("删自己的照片应当成功，实际 %v", err)
	}
}

func TestIntegrationBannedAccountLoginIsUserFacing(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)
	hash, err := bcrypt.GenerateFromPassword([]byte("test1234"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("生成口令哈希失败: %v", err)
	}

	// 被封禁/已注销在签发令牌之前就返回，本来不需要 issuer；但最后那条
	// "正常账号仍然能登录" 会一路走到签发，所以给一个真的。
	svc := NewAuthService(db, auth.NewIssuer("test-secret-for-unit-test", time.Hour, 24*time.Hour))

	for _, tc := range []struct {
		name   string
		status string
		want   error
	}{
		{"被封禁的账号", model.UserBanned, ErrAccountBanned},
		{"已注销的账号", model.UserDeleted, ErrAccountDeleted},
	} {
		u := seedUser(t, db, "18"+suffix+tc.status[:1], model.GenderMale, 178)
		cleanUsers(t, db, u.ID)
		db.Model(&model.User{}).Where("id = ?", u.ID).
			Updates(map[string]any{"password_hash": string(hash), "status": tc.status})

		_, err := svc.Login(ctx, u.Phone, "test1234")
		if !errors.Is(err, tc.want) {
			t.Fatalf("%s 登录应当是 %v（否则用户只看到「服务暂时不可用」），实际 %T: %v", tc.name, tc.want, err, err)
		}
	}

	// 正常账号仍然能登录——别把状态判断写歪了
	ok := seedUser(t, db, "19"+suffix, model.GenderFemale, 165)
	cleanUsers(t, db, ok.ID)
	db.Model(&model.User{}).Where("id = ?", ok.ID).Update("password_hash", string(hash))
	if _, err := svc.Login(ctx, ok.Phone, "test1234"); err != nil {
		t.Fatalf("正常账号应当能登录，实际 %v", err)
	}
}
