package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/davisu-china/mutual-app/server/internal/service"
)

// 每一个「写给用户看」的业务错误都必须有明确的映射。
//
// 值得单独测的原因：`mapErr` 的兜底分支会把**认不出来**的错误统一成
// 500「服务暂时不可用」并丢掉原消息。这个设计本身是对的（不把内部细节漏给
// 客户端），但代价是——谁新加一个哨兵却忘了在 `mapErr` 里登记，用户看到的就是
// 「服务暂时不可用」。真实发生过两处：
//   - 拉黑之后再看对方资料（`PublicProfile` 那时返回的是裸 errors.New）；
//   - 被封禁的账号登录（`Login` 也是裸 errors.New）。
//
// 两者都是**很确定的状态**，却报成了服务故障，日志里也看不出所以然。
func TestMapErrMapsUserFacingErrors(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cases := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"拉黑关系看不到资料", service.ErrProfileHidden, http.StatusForbidden, "PROFILE_HIDDEN"},
		{"被封禁的账号登录", service.ErrAccountBanned, http.StatusForbidden, "ACCOUNT_BANNED"},
		{"已注销的账号登录", service.ErrAccountDeleted, http.StatusForbidden, "ACCOUNT_DELETED"},
		{"配对不存在", service.ErrMatchNotFound, http.StatusNotFound, "MATCH_NOT_FOUND"},
		{"不是自己的配对", service.ErrNotMatchOwner, http.StatusForbidden, "NOT_MATCH_OWNER"},
		{"照片不存在", service.ErrPhotoNotFound, http.StatusNotFound, "PHOTO_NOT_FOUND"},
		{"只剩一张照片", service.ErrPhotoLastOne, http.StatusBadRequest, "PHOTO_LAST_ONE"},
		{"额度用完", service.ErrQuotaExhausted, http.StatusTooManyRequests, "QUOTA_EXHAUSTED"},
		{"对方账号不可用", service.ErrTargetInvalid, http.StatusNotFound, "TARGET_INVALID"},
		{"会话已关闭", service.ErrConversationClosed, http.StatusForbidden, "CONVERSATION_CLOSED"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			// 兜底分支会读 c.Request 写日志，测试上下文默认不带，得自己塞一个
			c.Request = httptest.NewRequest(http.MethodGet, "/x", nil)
			mapErr(c, tc.err)

			if w.Code != tc.status {
				t.Fatalf("状态码应为 %d，实际 %d", tc.status, w.Code)
			}
			var resp Resp
			if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
				t.Fatalf("响应不是预期的 JSON：%v", err)
			}
			if resp.Code != tc.code {
				t.Fatalf("错误码应为 %s，实际 %s", tc.code, resp.Code)
			}
			// 关键的一条：消息必须是**这个错误自己的话**，
			// 而不是兜底的「服务暂时不可用」
			if resp.Message != tc.err.Error() {
				t.Fatalf("消息应原样透出 %q，实际 %q", tc.err.Error(), resp.Message)
			}
		})
	}
}

// 反过来的那一半：认不出来的错误仍然要收敛成 500，且不泄露内部细节。
// 这条是上面那条的「护栏」——不能为了让消息好看就把什么都往外透。
func TestMapErrHidesUnknownErrors(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/x", nil)
	mapErr(c, errors.New(`pq: column "sex" does not exist`))

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("未知错误应为 500，实际 %d", w.Code)
	}
	var resp Resp
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("响应不是预期的 JSON：%v", err)
	}
	if strings.Contains(resp.Message, "column") {
		t.Fatalf("不该把数据库细节漏给客户端，实际 %q", resp.Message)
	}
}

// 校验类错误（InvalidInputError）写了给用户看的话，要透出而不是 500。
func TestMapErrPassesInvalidInput(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/x", nil)
	mapErr(c, service.InvalidInputError{Msg: "「关于我」需要 20–500 字"})

	if w.Code != http.StatusBadRequest {
		t.Fatalf("校验错误应为 400，实际 %d", w.Code)
	}
	var resp Resp
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Code != "INVALID_INPUT" || resp.Message != "「关于我」需要 20–500 字" {
		t.Fatalf("校验错误应原样透出，实际 code=%s message=%q", resp.Code, resp.Message)
	}
}
