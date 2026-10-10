package handler

import (
	"net/http"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"github.com/davisu-china/mutual-app/server/internal/auth"
	"github.com/davisu-china/mutual-app/server/internal/config"
	"github.com/davisu-china/mutual-app/server/internal/middleware"
)

type Deps struct {
	Cfg     *config.Config
	DB      *gorm.DB
	Redis   *redis.Client
	Issuer  *auth.Issuer
	Auth    *AuthHandler
	Profile *ProfileHandler
	Disc    *DiscoveryHandler
	Chat    *ChatHandler
	Upload  *UploadHandler
	Media   *MediaHandler
	WS      *WSChatHandler
	Admin   *AdminHandler
}

// NewRouter 组装路由。
//
// 中间件按「由外到内」的顺序挂：Recovery → CORS → 限流 → 鉴权 → 业务守卫。
// 特别注意 OnboardGuard 的位置：它必须在鉴权之后、业务之前，
// 这样「未完成五步」的拦截对**所有**发现类接口都生效（PRD 3.3）。
func NewRouter(d Deps) *gin.Engine {
	if d.Cfg.Env != "dev" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(requestLogger())
	r.Use(cors.New(cors.Config{
		AllowOrigins:     d.Cfg.AllowOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "Idempotency-Key"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "env": d.Cfg.Env})
	})

	v1 := r.Group("/api/v1")

	// ---------- 公开接口（无需登录） ----------
	authGroup := v1.Group("/auth")
	authGroup.Use(middleware.RateLimitByIP(d.Redis, "auth", 30, time.Minute))
	{
		authGroup.POST("/register", d.Auth.Register)
		authGroup.POST("/login", d.Auth.Login)
		authGroup.POST("/refresh", d.Auth.Refresh)
	}

	// ---------- 媒体（图片读写）----------
	//
	// 单独一组、不用 Bearer 鉴权：<img src> 和直传的 PUT 都是浏览器直接发的，
	// 带不了 Authorization 头，所以改用签名 cookie 认人（见 middleware.MediaCookie）。
	// 具体能读哪张图由服务端查库决定，cookie 只证明「这个浏览器登录过」。
	mediaGroup := v1.Group("/media")
	{
		mediaGroup.GET("/*key", d.Media.Get)
		mediaGroup.PUT("/*key", d.Media.Put)
	}

	// ---------- 需要登录 ----------
	authed := v1.Group("")
	authed.Use(middleware.Auth(d.Issuer))
	// 顺带把读图 cookie 发下去 / 续签
	authed.Use(middleware.MediaCookie(d.Cfg.JWTSecret, d.Cfg.MediaPathPrefix(), auth.MediaTokenTTL))
	{
		// 资料填写相关：只要登录 + 账号可用即可，**不能加 OnboardGuard**，
		// 否则用户会被自己的守卫卡住，永远填不完
		me := authed.Group("/users/me")
		me.Use(middleware.RequireActive(d.DB))
		{
			me.GET("", d.Profile.Me)
			me.PATCH("/profile", d.Profile.Update)
			me.PUT("/hobbies", d.Profile.SetHobbies)
			me.PATCH("/texts", d.Profile.SetTexts)
			me.PATCH("/preference", d.Profile.SetPreference)
			me.POST("/onboarding/complete", d.Profile.Complete)

			me.POST("/photos/presign", d.Upload.PresignPhoto)
			me.POST("/photos/confirm", d.Upload.ConfirmPhoto)
			me.GET("/photos", d.Upload.MyPhotos)
			me.DELETE("/photos/:id", d.Upload.DeletePhoto)
			me.PUT("/photos/order", d.Upload.Reorder)
			me.PATCH("/photos/:id", d.Upload.SetVisibility)

			me.POST("/avatar/presign", d.Upload.PresignAvatar)
			me.POST("/avatar/confirm", d.Upload.ConfirmAvatar)
		}

		// WebSocket：升级前不走 OnboardGuard（否则未完成资料的人连不上也没提示），
		// 但连上后能推什么由服务端决定
		authed.GET("/ws", d.WS.WS)

		// 后台：只要登录 + is_admin，**不挂 OnboardGuard**——
		// 管理员自己的资料填没填完，和能不能看后台是两件事。
		// 全部只读（GET），写操作留给运维直接改库。
		admin := authed.Group("/admin")
		admin.Use(middleware.AdminGuard(d.DB))
		{
			admin.GET("/stats", d.Admin.Stats)
			admin.GET("/users", d.Admin.Users)
			admin.GET("/users/:id", d.Admin.UserDetail)
			admin.GET("/users/:id/actions", d.Admin.UserActions)
			admin.GET("/conversations", d.Admin.Conversations)
			admin.GET("/conversations/:id", d.Admin.Conversation)
		}

		// 发现与互动：**必须完成 Onboarding**
		app := authed.Group("")
		app.Use(middleware.OnboardGuard(d.DB))
		{
			app.GET("/cards", d.Disc.Cards)
			app.GET("/quota", d.Disc.Quota)
			app.POST("/actions", d.Disc.Act)
			app.GET("/plaza", d.Disc.Plaza)
			app.GET("/likes-me", d.Disc.LikesMe)
			app.GET("/visits-me", d.Disc.VisitsMe)
			app.GET("/counts", d.Disc.Counts)
			app.GET("/matches", d.Disc.Matches)
			app.DELETE("/matches/:id", d.Disc.Unmatch)
			app.POST("/blocks", d.Disc.Block)
			app.DELETE("/blocks", d.Disc.Unblock)
			app.POST("/reports", d.Disc.Report)

			app.GET("/users/:id", d.Profile.View)

			app.GET("/conversations", d.Chat.Conversations)
			app.GET("/conversations/:id/messages", d.Chat.Messages)
			app.POST("/conversations/:id/messages", d.Chat.Send)
			app.POST("/conversations/:id/read", d.Chat.MarkRead)
		}
	}

	r.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, Resp{Code: "NOT_FOUND", Message: "接口不存在"})
	})

	return r
}

func requestLogger() gin.HandlerFunc {
	return gin.LoggerWithConfig(gin.LoggerConfig{
		// 跳过健康检查，避免日志被探活刷满
		SkipPaths: []string{"/health"},
	})
}
