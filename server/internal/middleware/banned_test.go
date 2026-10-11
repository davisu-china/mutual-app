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

// ⚠️ 这条以前断言的是相反的行为（封禁账号在中间件就被 403 拦掉）。
// 2026-10-11 用户明确了口径："ban 不是踢，是禁止他 like 别人、禁止他聊天"。
//
// 所以**中间件必须放行封禁用户**——放行之后才谈得上"能看推荐、能看消息"。
// 真正拦人的地方挪到了具体动作上（`service.checkRestricted`，
// 由 ActionService / ChatService 调用，见 admin_ban_test / restriction_test）。
//
// 这条用例就是钉住"别把闸门又装回中间件上"：装回去的表现是封禁用户连推荐页都打不开。
func TestOnboardGuardAllowsBanned(t *testing.T) {
	dsn := os.Getenv("TEST_DSN")
	if dsn == "" {
		t.Skip("未设置 TEST_DSN，跳过集成测试")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("连库失败: %v", err)
	}
	gin.SetMode(gin.TestMode)

	// phone 是 VARCHAR(11)，凑满 11 位
	id := seedUser(t, db, fmt.Sprintf("197%08d", time.Now().UnixNano()%10000000), false)
	t.Cleanup(func() { db.Exec("DELETE FROM users WHERE id = ?", id) })
	if err := db.Exec(`UPDATE users SET status = 'banned', ban_reason = '头像与本人不符' WHERE id = ?`, id).Error; err != nil {
		t.Fatalf("设封禁失败: %v", err)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/cards", nil)
	c.Set(ctxUserID, id)

	OnboardGuard(db)(c)

	if c.IsAborted() {
		t.Fatalf("封禁用户不该被中间件拦下（他只是不能喜欢和发消息），实际 %d %s", w.Code, w.Body.String())
	}
}

// 注销仍然整号拦（那是"人走了"，不是"限制互动"）。
func TestOnboardGuardBlocksDeleted(t *testing.T) {
	dsn := os.Getenv("TEST_DSN")
	if dsn == "" {
		t.Skip("未设置 TEST_DSN，跳过集成测试")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("连库失败: %v", err)
	}
	gin.SetMode(gin.TestMode)

	id := seedUser(t, db, fmt.Sprintf("196%08d", time.Now().UnixNano()%10000000), false)
	t.Cleanup(func() { db.Exec("DELETE FROM users WHERE id = ?", id) })
	db.Exec(`UPDATE users SET status = 'deleted' WHERE id = ?`, id)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/cards", nil)
	c.Set(ctxUserID, id)

	OnboardGuard(db)(c)
	if !c.IsAborted() || w.Code != http.StatusForbidden {
		t.Fatalf("已注销的账号应当被拦下，实际 %d", w.Code)
	}
}
