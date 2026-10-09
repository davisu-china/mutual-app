// Package middleware 提供鉴权、限流、参数校验等横切能力。
package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"github.com/davisu-china/mutual-app/server/internal/auth"
	"github.com/davisu-china/mutual-app/server/internal/model"
)

const ctxUserID = "uid"

// UserID 从 gin.Context 取出当前登录用户 id。
func UserID(c *gin.Context) int64 {
	v, ok := c.Get(ctxUserID)
	if !ok {
		return 0
	}
	id, _ := v.(int64)
	return id
}

// Auth 校验 Access Token。
func Auth(issuer *auth.Issuer) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := c.GetHeader("Authorization")
		if !strings.HasPrefix(raw, "Bearer ") {
			abort(c, http.StatusUnauthorized, "UNAUTHORIZED", "缺少访问凭证")
			return
		}
		claims, err := issuer.Parse(strings.TrimPrefix(raw, "Bearer "), auth.TypeAccess)
		if err != nil {
			abort(c, http.StatusUnauthorized, "UNAUTHORIZED", "凭证无效或已过期")
			return
		}
		c.Set(ctxUserID, claims.UserID)
		c.Next()
	}
}

// OnboardGuard 拦截未完成 Onboarding 的用户。
//
// PRD 3.3 规定五步不可跳过。**这个约束必须在这里实现，不能只靠前端**——
// 前端拦截只是体验，后端拦截才是规则。只做前端的话，改个请求就绕过去了。
func OnboardGuard(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := UserID(c)
		var u model.User
		if err := db.WithContext(c.Request.Context()).
			Select("id", "onboarded_at", "status").
			First(&u, uid).Error; err != nil {
			abort(c, http.StatusUnauthorized, "UNAUTHORIZED", "用户不存在")
			return
		}

		switch u.Status {
		case model.UserBanned:
			abort(c, http.StatusForbidden, "ACCOUNT_BANNED", "账号已被封禁")
			return
		case model.UserDeleted:
			abort(c, http.StatusForbidden, "ACCOUNT_DELETED", "账号已注销")
			return
		}

		if u.OnboardedAt == nil {
			abort(c, http.StatusForbidden, "ONBOARDING_REQUIRED", "请先完成资料填写")
			return
		}
		c.Next()
	}
}

// RequireActive 只校验账号状态，不要求完成 Onboarding。
// 用于「资料填写」本身相关的接口——否则用户会被自己卡住。
func RequireActive(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var u model.User
		if err := db.WithContext(c.Request.Context()).
			Select("id", "status").First(&u, UserID(c)).Error; err != nil {
			abort(c, http.StatusUnauthorized, "UNAUTHORIZED", "用户不存在")
			return
		}
		if u.Status == model.UserBanned || u.Status == model.UserDeleted {
			abort(c, http.StatusForbidden, "ACCOUNT_DISABLED", "账号不可用")
			return
		}
		c.Next()
	}
}

// RateLimit 基于 Redis 的固定窗口限流。
//
// Redis 不可用时**放行**而不是拒绝：限流是保护措施，不该在缓存故障时
// 变成拒绝服务的原因。真正需要强保护的接口（登录、注册）另有本地兜底。
func RateLimit(rdb *redis.Client, key string, limit int, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := UserID(c)
		if uid == 0 {
			uid = -1
		}
		k := fmt.Sprintf("rl:%s:%d:%d", key, uid, time.Now().Unix()/int64(window.Seconds()))

		ctx, cancel := context.WithTimeout(c.Request.Context(), 500*time.Millisecond)
		defer cancel()

		n, err := rdb.Incr(ctx, k).Result()
		if err != nil {
			c.Next() // 降级放行
			return
		}
		if n == 1 {
			rdb.Expire(ctx, k, window)
		}
		if n > int64(limit) {
			c.Header("Retry-After", fmt.Sprint(int(window.Seconds())))
			abort(c, http.StatusTooManyRequests, "RATE_LIMITED", "操作过于频繁，请稍后再试")
			return
		}
		c.Next()
	}
}

// RateLimitByIP 按 IP 限流，用于登录/注册这类还没有用户身份的接口。
func RateLimitByIP(rdb *redis.Client, key string, limit int, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		k := fmt.Sprintf("rl:%s:ip:%s:%d", key, ip, time.Now().Unix()/int64(window.Seconds()))

		ctx, cancel := context.WithTimeout(c.Request.Context(), 500*time.Millisecond)
		defer cancel()

		n, err := rdb.Incr(ctx, k).Result()
		if err != nil {
			c.Next()
			return
		}
		if n == 1 {
			rdb.Expire(ctx, k, window)
		}
		if n > int64(limit) {
			abort(c, http.StatusTooManyRequests, "RATE_LIMITED", "请求过于频繁，请稍后再试")
			return
		}
		c.Next()
	}
}

// abort 输出统一错误体并终止。
func abort(c *gin.Context, status int, code, msg string) {
	c.AbortWithStatusJSON(status, gin.H{"code": code, "message": msg, "data": nil})
}
