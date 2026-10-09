// Package handler 是 HTTP 接入层。
//
// 这一层只做三件事：绑定与校验参数、调用 service、把错误翻译成响应。
// **不写业务规则，不自己开事务**——事务边界统一在 service 层（技术方案 2.2）。
package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/davisu-china/mutual-app/server/internal/service"
)

type Resp struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data"`
}

func ok(c *gin.Context, data any) {
	c.JSON(http.StatusOK, Resp{Code: "OK", Message: "success", Data: data})
}

func fail(c *gin.Context, status int, code, msg string) {
	c.AbortWithStatusJSON(status, Resp{Code: code, Message: msg, Data: nil})
}

// mapErr 把 service 层的业务错误翻译成 HTTP 状态码。
//
// 集中在一处映射，避免每个 handler 各写一套 if-else，
// 也保证同一个错误在任何接口下返回的状态码一致。
func mapErr(c *gin.Context, err error) {
	switch {
	case err == nil:
		return

	case errors.Is(err, service.ErrQuotaExhausted):
		fail(c, http.StatusTooManyRequests, "QUOTA_EXHAUSTED", err.Error())
	case errors.Is(err, service.ErrPhoneTaken):
		fail(c, http.StatusConflict, "PHONE_TAKEN", err.Error())
	case errors.Is(err, service.ErrBadCredentials):
		fail(c, http.StatusUnauthorized, "BAD_CREDENTIALS", err.Error())
	case errors.Is(err, service.ErrWeakPassword):
		fail(c, http.StatusBadRequest, "WEAK_PASSWORD", "密码需 8–20 位，且同时包含字母和数字")
	case errors.Is(err, service.ErrInvalidPhone):
		fail(c, http.StatusBadRequest, "INVALID_PHONE", err.Error())
	case errors.Is(err, service.ErrUnderage):
		fail(c, http.StatusBadRequest, "UNDERAGE", err.Error())
	case errors.Is(err, service.ErrDeviceLimit):
		fail(c, http.StatusForbidden, "DEVICE_LIMIT", err.Error())

	case errors.Is(err, service.ErrCannotActSelf):
		fail(c, http.StatusBadRequest, "CANNOT_ACT_SELF", err.Error())
	case errors.Is(err, service.ErrTargetInvalid):
		fail(c, http.StatusNotFound, "TARGET_INVALID", err.Error())
	case errors.Is(err, service.ErrBlocked):
		fail(c, http.StatusForbidden, "BLOCKED", err.Error())

	case errors.Is(err, service.ErrPhotoLimit):
		fail(c, http.StatusBadRequest, "PHOTO_LIMIT", err.Error())
	case errors.Is(err, service.ErrPhotoLastOne):
		fail(c, http.StatusBadRequest, "PHOTO_LAST_ONE", err.Error())

	case errors.Is(err, service.ErrNotInConversation):
		fail(c, http.StatusForbidden, "NOT_IN_CONVERSATION", err.Error())
	case errors.Is(err, service.ErrConversationClosed):
		fail(c, http.StatusForbidden, "CONVERSATION_CLOSED", err.Error())
	case errors.Is(err, service.ErrEmptyMessage):
		fail(c, http.StatusBadRequest, "EMPTY_MESSAGE", err.Error())

	default:
		// 未知错误统一 500，不把内部细节透给客户端
		fail(c, http.StatusInternalServerError, "INTERNAL", "服务暂时不可用，请稍后重试")
	}
}
