package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strconv"
	"strings"
	"time"
)

// MediaCookieName 是读图用的凭证 cookie。
//
// 为什么不能复用 Access Token：图片是浏览器按 <img src> 直接发的请求，带不了
// Authorization 头，所有图片都得先过 JS 变成 blob——那样既没法缓存也拖慢首屏。
// 所以单独签一个**只用来读图**的令牌放进 cookie，浏览器会自动带上。
// 它的作用域也被限制在媒体路径上（见 middleware.MediaCookie 里的 Path），
// 拿它换不来任何 API 权限。
const MediaCookieName = "mutual_media"

// MediaTokenTTL 是读图令牌的有效期。比 Access Token 长得多——它只是「这个浏览器
// 登录过」的证明，真正的权限判断（照片是否可见）每次请求都会查库。
const MediaTokenTTL = 30 * 24 * time.Hour

// SignMediaToken 签发 "<uid>.<过期时间戳>.<签名>"。
func SignMediaToken(secret string, uid int64, ttl time.Duration) string {
	payload := strconv.FormatInt(uid, 10) + "." + strconv.FormatInt(time.Now().Add(ttl).Unix(), 10)
	return payload + "." + mediaSig(secret, payload)
}

// VerifyMediaToken 校验令牌。第三个返回值是过期时间，调用方据此决定要不要续签。
func VerifyMediaToken(secret, token string) (int64, time.Time, bool) {
	i := strings.LastIndex(token, ".")
	if i <= 0 || i == len(token)-1 {
		return 0, time.Time{}, false
	}
	payload, sig := token[:i], token[i+1:]
	if !hmac.Equal([]byte(sig), []byte(mediaSig(secret, payload))) {
		return 0, time.Time{}, false
	}

	uidStr, expStr, ok := strings.Cut(payload, ".")
	if !ok {
		return 0, time.Time{}, false
	}
	uid, err := strconv.ParseInt(uidStr, 10, 64)
	if err != nil || uid <= 0 {
		return 0, time.Time{}, false
	}
	expUnix, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil {
		return 0, time.Time{}, false
	}
	exp := time.Unix(expUnix, 0)
	if time.Now().After(exp) {
		return 0, time.Time{}, false
	}
	return uid, exp, true
}

func mediaSig(secret, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
