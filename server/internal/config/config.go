// Package config 从环境变量加载配置。
//
// 全部走环境变量而不读配置文件：密钥不进仓库，容器里注入最省事。
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Env  string
	Port string

	// PostgreSQL
	DSN string

	// Redis
	RedisAddr     string
	RedisPassword string
	RedisDB       int

	// 鉴权
	JWTSecret     string
	AccessTTL     time.Duration
	RefreshTTL    time.Duration

	// MinIO
	MinIOEndpoint  string
	MinIOAccessKey string
	MinIOSecretKey string
	MinIOUseSSL    bool
	MinIOPublicURL string // 对外可访问的基地址（用于拼接预签名 URL 的 fallback）
	BucketPhotos   string
	BucketAvatars  string

	// 业务
	// 照片自动过审。
	//
	// 这里刻意用一个**显式开关**而不是「判断 env==dev」：
	// 没有审核服务时，照片会全部停在 pending，而卡池要求「有已过审照片」，
	// 结果是**站能打开但没有任何人能刷到人**——一个很容易误判成「功能坏了」的坑。
	// 用独立开关，部署时能明确地打开它并知道自己在做什么。
	AuditAutoApprove bool

	DailyLikeLimit int
	MaxPhotos      int
	AllowOrigins   []string

	// 时区：额度按这个时区的「今天」重置（PRD 8.1 定的是北京时间）
	TZ *time.Location
}

func Load() (*Config, error) {
	tz, err := time.LoadLocation(getEnv("TZ_NAME", "Asia/Shanghai"))
	if err != nil {
		return nil, fmt.Errorf("加载时区失败: %w", err)
	}

	c := &Config{
		Env:  getEnv("APP_ENV", "dev"),
		Port: getEnv("PORT", "8080"),

		DSN: getEnv("DATABASE_DSN", ""),

		RedisAddr:     getEnv("REDIS_ADDR", "127.0.0.1:6379"),
		RedisPassword: getEnv("REDIS_PASSWORD", ""),
		RedisDB:       getEnvInt("REDIS_DB", 0),

		JWTSecret:  getEnv("JWT_SECRET", ""),
		AccessTTL:  time.Duration(getEnvInt("ACCESS_TTL_MIN", 120)) * time.Minute,
		RefreshTTL: time.Duration(getEnvInt("REFRESH_TTL_DAY", 30)) * 24 * time.Hour,

		MinIOEndpoint:  getEnv("MINIO_ENDPOINT", "127.0.0.1:9000"),
		MinIOAccessKey: getEnv("MINIO_ACCESS_KEY", "minioadmin"),
		MinIOSecretKey: getEnv("MINIO_SECRET_KEY", "minioadmin"),
		MinIOUseSSL:    getEnvBool("MINIO_USE_SSL", false),
		MinIOPublicURL: getEnv("MINIO_PUBLIC_URL", ""),
		BucketPhotos:   getEnv("MINIO_BUCKET_PHOTOS", "mutual-photos"),
		BucketAvatars:  getEnv("MINIO_BUCKET_AVATARS", "mutual-avatars"),

		// 默认：开发环境自动过审，生产环境必须接审核服务
		AuditAutoApprove: getEnvBool("AUDIT_AUTO_APPROVE", getEnv("APP_ENV", "dev") == "dev"),

		DailyLikeLimit: getEnvInt("DAILY_LIKE_LIMIT", 10),
		MaxPhotos:      getEnvInt("MAX_PHOTOS", 9),
		AllowOrigins:   strings.Split(getEnv("ALLOW_ORIGINS", "http://localhost:5173"), ","),

		TZ: tz,
	}

	// 数据库连接串在生产环境必须显式配置。
	//
	// 之前这里有个指向 127.0.0.1:5432 的默认值，很危险：万一环境变量没加载成功
	// （比如 systemd 的 EnvironmentFile 写错），服务会**静默连上一台不相干的数据库**
	// 然后报一个看起来像密码错的错误，排查方向全错。宁可启动就失败。
	if c.DSN == "" {
		if c.Env == "dev" {
			c.DSN = "host=127.0.0.1 port=5432 user=mutual dbname=mutual sslmode=disable TimeZone=UTC"
		} else {
			return nil, fmt.Errorf("生产环境必须设置 DATABASE_DSN")
		}
	}

	// 生产环境必须显式配置密钥，不允许用默认值兜底——
	// 默认密钥等于没有鉴权，这个错误必须在启动时就暴露，而不是上线后被利用。
	if c.JWTSecret == "" {
		if c.Env == "dev" {
			c.JWTSecret = "dev-only-insecure-secret-change-me"
		} else {
			return nil, fmt.Errorf("生产环境必须设置 JWT_SECRET")
		}
	}
	if c.Env != "dev" && len(c.JWTSecret) < 32 {
		return nil, fmt.Errorf("JWT_SECRET 长度不足 32 位")
	}

	return c, nil
}

// Today 返回当前配置时区下的日期字符串（YYYY-MM-DD）。
//
// 额度表以这个值为准。**不能用数据库的 CURRENT_DATE**——服务器若跑在 UTC，
// 北京时间早上 8 点前后会算错一天（PRD 8.1）。
func (c *Config) Today() string {
	return time.Now().In(c.TZ).Format("2006-01-02")
}

func getEnv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func getEnvInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func getEnvBool(k string, def bool) bool {
	if v := os.Getenv(k); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}
