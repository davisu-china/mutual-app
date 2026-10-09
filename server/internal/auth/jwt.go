// Package auth 负责签发与校验 JWT。
package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type TokenType string

const (
	TypeAccess  TokenType = "access"
	TypeRefresh TokenType = "refresh"
)

var (
	ErrInvalidToken = errors.New("token 无效")
	ErrWrongType    = errors.New("token 类型不匹配")
)

type Claims struct {
	UserID int64     `json:"uid"`
	Type   TokenType `json:"typ"`
	jwt.RegisteredClaims
}

type Issuer struct {
	secret     []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
}

func NewIssuer(secret string, accessTTL, refreshTTL time.Duration) *Issuer {
	return &Issuer{
		secret:     []byte(secret),
		accessTTL:  accessTTL,
		refreshTTL: refreshTTL,
	}
}

func (i *Issuer) Issue(userID int64) (access, refresh string, err error) {
	access, err = i.sign(userID, TypeAccess, i.accessTTL)
	if err != nil {
		return "", "", err
	}
	refresh, err = i.sign(userID, TypeRefresh, i.refreshTTL)
	if err != nil {
		return "", "", err
	}
	return access, refresh, nil
}

func (i *Issuer) sign(userID int64, typ TokenType, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID: userID,
		Type:   typ,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "mutual",
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString(i.secret)
}

// Parse 校验签名与有效期，并确认 token 类型符合预期。
//
// 显式校验类型很重要：否则 refresh token 可以被当成 access token 直接调业务接口，
// 等于把「30 天有效期」的凭证变成了万能钥匙。
func (i *Issuer) Parse(tokenStr string, want TokenType) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("非预期的签名算法: %v", t.Header["alg"])
		}
		return i.secret, nil
	})
	if err != nil {
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, ErrInvalidToken
	}
	if claims.Type != want {
		return nil, ErrWrongType
	}
	return claims, nil
}
