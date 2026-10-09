// 相悦 Mutual · API 服务
//
// 启动顺序：配置 → 基础设施 → 服务 → 路由 → 监听。
// 任何一步失败都直接退出，不做「带病启动」——配置错误在上线前暴露，
// 比在第一个真实请求时暴露代价小得多。
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/davisu-china/mutual-app/server/internal/auth"
	"github.com/davisu-china/mutual-app/server/internal/config"
	"github.com/davisu-china/mutual-app/server/internal/handler"
	"github.com/davisu-china/mutual-app/server/internal/infra"
	"github.com/davisu-china/mutual-app/server/internal/service"
	"github.com/davisu-china/mutual-app/server/internal/ws"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("配置加载失败: %v", err)
	}
	log.Printf("[info] 启动中 env=%s 时区=%s 每日额度=%d",
		cfg.Env, cfg.TZ, cfg.DailyLikeLimit)

	db, err := infra.OpenDB(cfg)
	if err != nil {
		log.Fatalf("数据库不可用: %v", err)
	}
	log.Printf("[info] 数据库已连接")

	rdb := infra.OpenRedis(cfg)

	storage, err := infra.OpenStorage(cfg)
	if err != nil {
		// 对象存储不可用不阻断启动：资料填写、划卡、聊天都不依赖它，
		// 只有上传会失败。这样至少不会因为一个组件挂掉导致整站 502。
		log.Printf("[warn] 对象存储不可用，上传功能将不可用: %v", err)
		storage = nil
	}

	issuer := auth.NewIssuer(cfg.JWTSecret, cfg.AccessTTL, cfg.RefreshTTL)

	// ---- WebSocket Hub ----
	hub := ws.NewHub()
	hub.SetPresenceHooks(
		func(uid int64) {
			// 在线状态用带 TTL 的键表示，断开或进程崩溃后自然过期，
			// 不需要显式清理
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			rdb.Set(ctx, fmt.Sprintf("online:%d", uid), 1, 90*time.Second)
		},
		func(uid int64) {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			rdb.Del(ctx, fmt.Sprintf("online:%d", uid))
		},
	)

	// ---- 服务层 ----
	exposureSvc := service.NewExposureService(db)

	authSvc := service.NewAuthService(db, issuer)
	profileSvc := service.NewProfileService(db, exposureSvc)
	discSvc := service.NewDiscoveryService(db, profileSvc, exposureSvc)
	socialSvc := service.NewSocialService(db)
	chatSvc := service.NewChatService(db)

	// 配对成功后推送：由 ActionService 在事务提交后回调。
	// 放在这里注入，service 层就不必知道 WebSocket 的存在。
	actionSvc := service.NewActionService(db, cfg, func(a, b, matchID int64) {
		handler.PushMatch(a, b, matchID)
		log.Printf("[info] 配对成功 match=%d a=%d b=%d", matchID, a, b)
	}, exposureSvc)

	var uploadSvc *service.UploadService
	if storage != nil {
		uploadSvc = service.NewUploadService(db, cfg, storage)
	} else {
		uploadSvc = service.NewUploadService(db, cfg, infra.NewNilStorage())
	}

	// ---- 接入层 ----
	handler.SetRealtime(hub, issuer, cfg)

	r := handler.NewRouter(handler.Deps{
		Cfg:     cfg,
		DB:      db,
		Redis:   rdb,
		Issuer:  issuer,
		Auth:    handler.NewAuthHandler(authSvc),
		Profile: handler.NewProfileHandler(profileSvc),
		Disc:    handler.NewDiscoveryHandler(discSvc, actionSvc, socialSvc),
		Chat:    handler.NewChatHandler(chatSvc),
		Upload:  handler.NewUploadHandler(uploadSvc),
		Media:   handler.NewMediaHandler(uploadSvc, cfg, issuer),
		WS:      handler.NewWSChatHandler(),
	})

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		// 读超时给足：图片上传走本服务中转（见 service/media.go），
		// 手机弱网传 10MB 可能要几十秒，30 秒会把请求从中间掐断。
		// 防慢速攻击靠上面的 ReadHeaderTimeout，不靠这个值。
		ReadTimeout: 120 * time.Second,
		// 写超时不能太短：WebSocket 是长连接，会被这个值掐断
		WriteTimeout: 0,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Printf("[info] 监听 :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("监听失败: %v", err)
		}
	}()

	// ---- 优雅退出 ----
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Printf("[info] 收到退出信号，开始优雅关闭")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("[warn] 关闭超时: %v", err)
	}

	if sqlDB, err := db.DB(); err == nil {
		_ = sqlDB.Close()
	}
	log.Printf("[info] 已退出")
}
