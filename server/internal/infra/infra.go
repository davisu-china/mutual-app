// Package infra 提供数据库、缓存与对象存储的初始化。
package infra

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/davisu-china/mutual-app/server/internal/config"
)

// ---------- PostgreSQL ----------

func OpenDB(cfg *config.Config) (*gorm.DB, error) {
	logLevel := logger.Warn
	if cfg.Env == "dev" {
		logLevel = logger.Info
	}

	db, err := gorm.Open(postgres.Open(cfg.DSN), &gorm.Config{
		Logger: logger.Default.LogMode(logLevel),
		// 表名不做复数化处理——我们的模型已经显式指定了 TableName()
		NamingStrategy: nil,
	})
	if err != nil {
		return nil, fmt.Errorf("连接数据库失败: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}

	// 连接池：核数 × 2 + 磁盘数 是经验值。
	// 本机按 8 核估，实际部署时按机器规格调。
	sqlDB.SetMaxOpenConns(20)
	sqlDB.SetMaxIdleConns(10)
	// 比数据库端的 idle_in_transaction_session_timeout 短，
	// 避免拿到已被服务端断开的僵死连接
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	sqlDB.SetConnMaxIdleTime(5 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("数据库 ping 失败: %w", err)
	}

	return db, nil
}

// ---------- Redis ----------

func OpenRedis(cfg *config.Config) *redis.Client {
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
		// 超时给短一点：Redis 只做缓存与限流，挂了也不该拖垮主流程
		DialTimeout:  2 * time.Second,
		ReadTimeout:  1 * time.Second,
		WriteTimeout: 1 * time.Second,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		// Redis 不可用不阻断启动——降级为「无缓存」运行，
		// 但额度与配对这类强一致逻辑本来就走 PG，所以不影响正确性
		log.Printf("[warn] Redis 不可用，将以无缓存模式运行: %v", err)
	} else {
		log.Printf("[info] Redis 已连接: %s", cfg.RedisAddr)
	}
	return rdb
}

// ---------- MinIO ----------

type Storage struct {
	Client     *minio.Client
	Photos     string
	Avatars    string
	PublicBase string
}

func OpenStorage(cfg *config.Config) (*Storage, error) {
	cli, err := minio.New(cfg.MinIOEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.MinIOAccessKey, cfg.MinIOSecretKey, ""),
		Secure: cfg.MinIOUseSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("初始化 MinIO 失败: %w", err)
	}

	s := &Storage{
		Client:     cli,
		Photos:     cfg.BucketPhotos,
		Avatars:    cfg.BucketAvatars,
		PublicBase: cfg.MinIOPublicURL,
	}

	// 确保 bucket 存在且为私有。
	// 照片桶**绝不能设为 public**——否则相册可被直接爬走（技术方案 9.4）。
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, b := range []string{s.Photos, s.Avatars} {
		exists, err := cli.BucketExists(ctx, b)
		if err != nil {
			return nil, fmt.Errorf("检查 bucket %s 失败: %w", b, err)
		}
		if !exists {
			if err := cli.MakeBucket(ctx, b, minio.MakeBucketOptions{}); err != nil {
				return nil, fmt.Errorf("创建 bucket %s 失败: %w", b, err)
			}
			log.Printf("[info] 已创建 bucket: %s", b)
		}
	}

	return s, nil
}

// NewNilStorage 返回一个「不可用」的 Storage。
//
// 对象存储连不上时用它占位，让服务能正常启动——
// 资料填写、划卡、聊天都不依赖存储，只有上传会失败。
// 这比因为一个组件挂掉导致整站起不来要好。
func NewNilStorage() *Storage {
	return &Storage{
		Client:  nil,
		Photos:  "mutual-photos",
		Avatars: "mutual-avatars",
	}
}
