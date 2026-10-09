package middleware

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/davisu-china/mutual-app/server/internal/auth"
)

// MediaCookie 在已登录的请求上维护「读图 cookie」。
//
// 为什么挂在中间件上而不是登录接口里：注册、登录、刷新三条路径都得设，而且它有
// 30 天有效期需要续签。挂在这里就是「谁带着 Access Token 来过，谁就自动拿到」，
// 不用在三个 handler 里各写一遍，也不会漏。
//
// Path 收窄到媒体路由上，别的接口收不到这个 cookie——它是「能看图」的凭证，
// 不该跟着每个请求到处跑。只在缺失或过半有效期时才重签，避免每个响应都带 Set-Cookie。
func MediaCookie(secret, path string, ttl time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := UserID(c)
		if uid == 0 {
			c.Next()
			return
		}

		if raw, err := c.Cookie(auth.MediaCookieName); err == nil && raw != "" {
			if got, exp, ok := auth.VerifyMediaToken(secret, raw); ok && got == uid &&
				time.Until(exp) > ttl/2 {
				c.Next()
				return
			}
		}

		http.SetCookie(c.Writer, &http.Cookie{
			Name:     auth.MediaCookieName,
			Value:    auth.SignMediaToken(secret, uid, ttl),
			Path:     path,
			MaxAge:   int(ttl.Seconds()),
			HttpOnly: true,
			Secure:   true,
			SameSite: http.SameSiteLaxMode,
		})
		c.Next()
	}
}
