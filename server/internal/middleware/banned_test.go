package middleware

import (
	"encoding/json"
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

// 被封禁的账号，**任何业务接口的 403 都必须把管理员填的理由带上**。
//
// 这是"App 能感知到被封"的唯一通道：账号一旦被封，中间件会在业务逻辑之前
// 拦下来，所以 App 能拿到的就这个响应体。理由只写进后台日志、不放进响应，
// 用户那边看到的就是一句干巴巴的"账号已被封禁"，等于没说。
func TestOnboardGuardBannedCarriesReason(t *testing.T) {
	dsn := os.Getenv("TEST_DSN")
	if dsn == "" {
		t.Skip("未设置 TEST_DSN，跳过集成测试")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("连库失败: %v", err)
	}
	gin.SetMode(gin.TestMode)

	const reason = "头像与本人不符，请更换后联系客服"
	// phone 是 VARCHAR(11)，凑满 11 位
	id := seedUser(t, db, fmt.Sprintf("198%08d", time.Now().UnixNano()%10000000), false)
	t.Cleanup(func() { db.Exec("DELETE FROM users WHERE id = ?", id) })
	if err := db.Exec(`UPDATE users SET status = 'banned', ban_reason = ? WHERE id = ?`, reason, id).Error; err != nil {
		t.Fatalf("设封禁失败: %v", err)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/cards", nil)
	c.Set(ctxUserID, id)

	OnboardGuard(db)(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("被封的账号应当是 403，实际 %d", w.Code)
	}
	var body struct {
		Code    string         `json:"code"`
		Message string         `json:"message"`
		Data    map[string]any `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("响应不是 JSON: %v（%s）", err, w.Body.String())
	}
	if body.Code != "ACCOUNT_BANNED" {
		t.Errorf("code 应当是 ACCOUNT_BANNED，实际 %q —— App 靠它识别封禁态", body.Code)
	}
	// message 里带理由：这样任何客户端（包括还没改的旧版本）都能直接显示出来
	if want := "账号已被封禁：" + reason; body.Message != want {
		t.Errorf("message 应当带理由：\n  想要 %q\n  实际 %q", want, body.Message)
	}
	// data.reason 给 App 单独排版用
	if got, _ := body.Data["reason"].(string); got != reason {
		t.Errorf("data.reason 应当是原话，实际 %v", body.Data["reason"])
	}
}

// 运维直接改库封人时不会填理由，这时候不能给用户一个空的"账号已被封禁："。
func TestAbortBannedWithoutReason(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	abortBanned(c, nil)

	var body struct {
		Message string         `json:"message"`
		Data    map[string]any `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Message != "账号已被封禁" {
		t.Errorf("没有理由时应当是通用话术，实际 %q", body.Message)
	}
	if body.Data != nil {
		t.Errorf("没有理由时 data 应当是 null，实际 %v", body.Data)
	}
}
