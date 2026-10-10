package service

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"github.com/davisu-china/mutual-app/server/internal/auth"
	"github.com/davisu-china/mutual-app/server/internal/model"
)

var (
	ErrPhoneTaken     = errors.New("该手机号已注册")
	ErrBadCredentials = errors.New("手机号或密码不正确")
	ErrWeakPassword   = errors.New("密码强度不足")
	ErrInvalidPhone   = errors.New("手机号格式不正确")
	ErrUnderage       = errors.New("未满 18 周岁")
	ErrDeviceLimit    = errors.New("该设备注册的账号数已达上限")
	// 这两个原来写成裸 errors.New，被 mapErr 兜底成 500「服务暂时不可用」——
	// 被封禁的用户会以为 App 坏了，而不是知道该找客服。
	ErrAccountBanned  = errors.New("账号已被封禁，请联系客服")
	ErrAccountDeleted = errors.New("账号已注销")
)

// 中国大陆手机号
var phoneRe = regexp.MustCompile(`^1[3-9]\d{9}$`)

const (
	bcryptCost        = 12
	maxAccountsPerDev = 3 // PRD 4.4：同设备每月最多注册 3 个账号
)

type AuthService struct {
	db     *gorm.DB
	issuer *auth.Issuer
}

func NewAuthService(db *gorm.DB, issuer *auth.Issuer) *AuthService {
	return &AuthService{db: db, issuer: issuer}
}

type RegisterInput struct {
	Phone    string
	Password string
	DeviceID string
	IP       string
}

type AuthResult struct {
	UserID       int64  `json:"userId"`
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	Onboarded    bool   `json:"onboarded"`
}

func (s *AuthService) Register(ctx context.Context, in RegisterInput) (*AuthResult, error) {
	if !phoneRe.MatchString(in.Phone) {
		return nil, ErrInvalidPhone
	}
	if err := ValidatePassword(in.Password); err != nil {
		return nil, err
	}

	// 设备维度风控：没有验证码，注册成本为零，必须靠设备指纹兜一道
	if in.DeviceID != "" {
		var n int64
		if err := s.db.WithContext(ctx).Model(&model.User{}).
			Where("device_id = ? AND created_at > ?", in.DeviceID, time.Now().AddDate(0, -1, 0)).
			Count(&n).Error; err != nil {
			return nil, err
		}
		if n >= maxAccountsPerDev {
			return nil, ErrDeviceLimit
		}
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcryptCost)
	if err != nil {
		return nil, fmt.Errorf("密码加密失败: %w", err)
	}

	u := &model.User{
		Phone:        in.Phone,
		PasswordHash: string(hash),
		Nickname: defaultNickname(in.Phone),
		// 性别与生日在 Onboarding 里收集。
		// 性别留 NULL（而不是填 0），生日给一个中性值以便后续按年龄过滤时不为空。
		Status:   model.UserRegistered,
		Birthday: time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC),
	}
	if in.DeviceID != "" {
		u.DeviceID = &in.DeviceID
	}
	if in.IP != "" {
		u.RegisterIP = &in.IP
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 手机号唯一靠数据库唯一索引兜底，先查一次只是为了给友好提示；
		// 并发下仍可能撞索引，所以下面要把唯一键冲突翻译成业务错误
		var exists int64
		if err := tx.Model(&model.User{}).Where("phone = ?", in.Phone).Count(&exists).Error; err != nil {
			return err
		}
		if exists > 0 {
			return ErrPhoneTaken
		}
		return tx.Create(u).Error
	})
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrPhoneTaken
		}
		return nil, err
	}

	return s.issue(u)
}

func (s *AuthService) Login(ctx context.Context, phone, password string) (*AuthResult, error) {
	var u model.User
	err := s.db.WithContext(ctx).Where("phone = ?", phone).First(&u).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// 统一话术，不泄露手机号是否注册过（防账号枚举）
			return nil, ErrBadCredentials
		}
		return nil, err
	}

	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) != nil {
		return nil, ErrBadCredentials
	}

	switch u.Status {
	case model.UserBanned:
		return nil, ErrAccountBanned
	case model.UserDeleted:
		return nil, ErrAccountDeleted
	}

	now := time.Now()
	s.db.WithContext(ctx).Model(&model.User{}).Where("id = ?", u.ID).
		Update("last_login_at", now)

	return s.issue(&u)
}

// Refresh 用 refresh token 换一对新 token。
func (s *AuthService) Refresh(ctx context.Context, refreshToken string) (*AuthResult, error) {
	claims, err := s.issuer.Parse(refreshToken, auth.TypeRefresh)
	if err != nil {
		return nil, ErrBadCredentials
	}

	var u model.User
	if err := s.db.WithContext(ctx).First(&u, claims.UserID).Error; err != nil {
		return nil, ErrBadCredentials
	}
	if u.Status == model.UserBanned || u.Status == model.UserDeleted {
		return nil, ErrBadCredentials
	}
	return s.issue(&u)
}

func (s *AuthService) issue(u *model.User) (*AuthResult, error) {
	access, refresh, err := s.issuer.Issue(u.ID)
	if err != nil {
		return nil, err
	}
	return &AuthResult{
		UserID:       u.ID,
		AccessToken:  access,
		RefreshToken: refresh,
		Onboarded:    u.OnboardedAt != nil,
	}, nil
}

// ValidatePassword 校验密码强度（PRD 4.1）。
func ValidatePassword(pw string) error {
	if len(pw) < 8 || len(pw) > 20 {
		return ErrWeakPassword
	}
	var hasLetter, hasDigit bool
	for _, r := range pw {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z':
			hasLetter = true
		case r >= '0' && r <= '9':
			hasDigit = true
		}
	}
	if !hasLetter || !hasDigit {
		return ErrWeakPassword
	}
	if isSequential(pw) {
		return ErrWeakPassword
	}
	return nil
}

// isSequential 判断是否为连续或重复字符，如 12345678 / aaaaaaaa。
func isSequential(s string) bool {
	if len(s) < 3 {
		return false
	}
	allSame, asc, desc := true, true, true
	for i := 1; i < len(s); i++ {
		if s[i] != s[0] {
			allSame = false
		}
		if s[i] != s[i-1]+1 {
			asc = false
		}
		if s[i]+1 != s[i-1] {
			desc = false
		}
	}
	return allSame || asc || desc
}

func defaultNickname(phone string) string {
	if len(phone) >= 4 {
		return "用户" + phone[len(phone)-4:]
	}
	return "新用户"
}

// isUniqueViolation 判断是否为唯一键冲突。
// 不引 pgconn 依赖，用错误文本判断，够用且不增加耦合。
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "unique constraint") ||
		strings.Contains(msg, "SQLSTATE 23505")
}
