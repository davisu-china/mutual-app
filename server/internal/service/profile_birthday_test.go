package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/davisu-china/mutual-app/server/internal/model"
)

// 生日只给**本人**，不给别人——这是两条都必须成立的事：
//
//   - 给本人：编辑资料要回显。不给的话每次进向导都得重选生日，手一滑就把生日改错了
//     （用户报的正是这个："个人资料里的出生年月日 没有回显，还是显示请选择"）。
//   - 不给别人：PRD 第 15 章的隐私口径——对外只展示年龄。
//
// 一条用例把两边一起钉住，因为这个字段最容易"为了修 A 弄坏 B"。
func TestIntegrationBirthdayVisibleToSelfOnly(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)

	me := seedUser(t, db, "126"+suffix, model.GenderFemale, 165)
	other := seedUser(t, db, "125"+suffix, model.GenderMale, 178)
	cleanUsers(t, db, me.ID, other.ID)

	svc := NewProfileService(db, NewExposureService(db))

	self, err := svc.MyProfile(ctx, me.ID)
	if err != nil {
		t.Fatalf("取自己资料失败: %v", err)
	}
	// seedUser 里写的是 1996-06-06
	if self.Birthday != "1996-06-06" {
		t.Errorf("本人应当拿到自己的生日（YYYY-MM-DD），实际 %q", self.Birthday)
	}
	if self.Age <= 0 {
		t.Errorf("年龄也该照常有，实际 %d", self.Age)
	}

	byOther, err := svc.PublicProfile(ctx, other.ID, me.ID)
	if err != nil {
		t.Fatalf("看别人资料失败: %v", err)
	}
	if byOther.Birthday != "" {
		t.Errorf("别人不该拿到生日（只给年龄），实际 %q", byOther.Birthday)
	}
	if byOther.Age <= 0 {
		t.Errorf("年龄要照常给，实际 %d", byOther.Age)
	}
}
