package middleware

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// AdminGuard 是后台唯一的一道门，值得有测试钉着——它要是漏了，
// 任何一个普通用户都能翻全部人的资料、划卡记录和聊天记录。
//
// 和其它集成测试一样：没设 TEST_DSN 就整体跳过，不污染别人的环境。
func TestAdminGuard(t *testing.T) {
	dsn := os.Getenv("TEST_DSN")
	if dsn == "" {
		t.Skip("未设置 TEST_DSN，跳过集成测试")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("连库失败: %v", err)
	}
	gin.SetMode(gin.TestMode)

	// phone 是 VARCHAR(11)，后缀拼太长会直接插不进去——凑满 11 位就够
	base := time.Now().UnixNano() % 10000000
	adminID := seedUser(t, db, fmt.Sprintf("199%08d", base), true)
	plainID := seedUser(t, db, fmt.Sprintf("199%08d", base+1), false)
	t.Cleanup(func() {
		db.Exec("DELETE FROM users WHERE id IN (?, ?)", adminID, plainID)
	})

	// 模拟"Auth 中间件已经把人放进来了"：直接把 uid 塞进 context，
	// 这里要验的就是 AdminGuard 自己那一段
	status := func(uid int64) int {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/stats", nil)
		c.Set(ctxUserID, uid)
		AdminGuard(db)(c)
		return w.Code
	}

	if got := status(adminID); got != http.StatusOK {
		t.Errorf("is_admin=true 应当放行，实际 %d", got)
	}
	if got := status(plainID); got != http.StatusForbidden {
		t.Errorf("is_admin=false 应当 403，实际 %d", got)
	}
	if got := status(999999999); got != http.StatusForbidden {
		t.Errorf("用户不存在应当 403（不能因为查不到就放行），实际 %d", got)
	}
	// uid=0 是"context 里没有 uid"——Auth 没挂或挂错顺序时的样子。
	// 这种情况**必须**挡掉：那正是中间件顺序写错时最容易出现的一种状态。
	if got := status(0); got != http.StatusForbidden {
		t.Errorf("uid=0（未鉴权）应当 403，实际 %d", got)
	}
}

// seedUser 直接插一行最小可用的用户，只为了测这一个中间件。
func seedUser(t *testing.T, db *gorm.DB, phone string, isAdmin bool) int64 {
	t.Helper()
	var id int64
	err := db.Raw(`
		INSERT INTO users (phone, password_hash, nickname, gender, birthday, status, onboarded_at, is_admin)
		VALUES (?, 'x', ?, 2, '1996-06-06', 'active', now(), ?)
		RETURNING id
	`, phone, "中间件测试"+phone[len(phone)-4:], isAdmin).Row().Scan(&id)
	if err != nil {
		t.Fatalf("造用户失败: %v", err)
	}
	return id
}
