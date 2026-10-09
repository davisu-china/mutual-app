package auth

import (
	"strings"
	"testing"
	"time"
)

func TestMediaTokenRoundTrip(t *testing.T) {
	const secret = "s3cret-for-test"
	tok := SignMediaToken(secret, 42, time.Hour)

	uid, exp, ok := VerifyMediaToken(secret, tok)
	if !ok {
		t.Fatal("自己签的令牌验不过")
	}
	if uid != 42 {
		t.Fatalf("uid 应该还原成 42，实际 %d", uid)
	}
	if time.Until(exp) < 50*time.Minute || time.Until(exp) > time.Hour {
		t.Fatalf("过期时间不对：%v", time.Until(exp))
	}
}

func TestMediaTokenRejects(t *testing.T) {
	const secret = "s3cret-for-test"
	tok := SignMediaToken(secret, 7, time.Hour)

	cases := map[string]string{
		"换个密钥":   SignMediaToken("other-secret", 7, time.Hour),
		"空串":     "",
		"没有签名":   strings.TrimSuffix(tok, "."+tok[strings.LastIndex(tok, ".")+1:]),
		"签名被改":   tok[:strings.LastIndex(tok, ".")] + ".AAAA",
		"过期":     SignMediaToken(secret, 7, -time.Minute),
		"uid 被换": SignMediaToken(secret, 8, time.Hour),
	}
	for name, bad := range cases {
		if name == "uid 被换" {
			// 换 uid 会连带重签，所以它其实是合法的——这里只确认解出来的不是 7
			uid, _, ok := VerifyMediaToken(secret, bad)
			if ok && uid == 7 {
				t.Errorf("%s：解出的 uid 不应还是 7", name)
			}
			continue
		}
		if _, _, ok := VerifyMediaToken(secret, bad); ok {
			t.Errorf("%s：不该通过校验", name)
		}
	}
}
