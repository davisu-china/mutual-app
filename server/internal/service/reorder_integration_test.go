package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/davisu-china/mutual-app/server/internal/model"
)

// 相册换序：这张表上有 CHECK (sort_order BETWEEN 1 AND 9)，而原实现先把整组
// 顺序号取负来绕开唯一约束——负值直接违反 CHECK，事务整条回滚，
// 也就是说**拖拽排序一直是坏的**（前端拖一次就失败）。
//
// 这条用例盯住它：换序必须成功，落库顺序就是提交的顺序，
// 而且「第一张＝头像」这条口径要跟着变。
func TestIntegrationPhotoReorder(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)
	u := seedUser(t, db, "137"+suffix, model.GenderFemale, 165)
	cleanUsers(t, db, u.ID)

	svc := NewUploadService(db, testCfg(), nil)

	// seedUser 已经造了一张（sort_order=1），再补两张凑成 1/2/3
	var first model.UserPhoto
	if err := db.Where("user_id = ?", u.ID).First(&first).Error; err != nil {
		t.Fatalf("读取 seed 照片失败: %v", err)
	}
	ids := []int64{first.ID}
	for i := 2; i <= 3; i++ {
		p := &model.UserPhoto{
			UserID:      u.ID,
			URL:         fmt.Sprintf("/api/v1/media/photos/x/photo%d.jpg", i),
			SortOrder:   int16(i),
			AuditStatus: model.AuditApproved,
			Visibility:  "public",
		}
		if err := db.Create(p).Error; err != nil {
			t.Fatalf("造照片失败: %v", err)
		}
		ids = append(ids, p.ID)
	}

	// 倒序提交：第三张挪到第一张
	want := []int64{ids[2], ids[1], ids[0]}
	if err := svc.ReorderPhotos(ctx, u.ID, want); err != nil {
		t.Fatalf("换序失败（CHECK/唯一约束的回归）: %v", err)
	}

	var got []int64
	if err := db.Model(&model.UserPhoto{}).Where("user_id = ?", u.ID).
		Order("sort_order asc").Pluck("id", &got).Error; err != nil {
		t.Fatal(err)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("落库顺序不对：期望 %v，实际 %v", want, got)
		}
	}

	// 「头像＝相册第一张」要跟着新顺序变
	p, err := NewProfileService(db, NewExposureService(db)).MyProfile(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if p.AvatarURL != "/api/v1/media/photos/x/photo3.jpg" {
		t.Fatalf("头像应当是第一张（photo3），实际 %q", p.AvatarURL)
	}

	// 顺序号必须仍是合法的 1..9（不能被写坏成负数或空洞）
	var min, max int16
	db.Model(&model.UserPhoto{}).Where("user_id = ?", u.ID).
		Select("MIN(sort_order), MAX(sort_order)").Row().Scan(&min, &max)
	if min != 1 || max != 3 {
		t.Fatalf("顺序号范围应为 1..3，实际 %d..%d", min, max)
	}
}
