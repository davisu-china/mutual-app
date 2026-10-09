package service

import (
	"strings"
	"testing"

	"github.com/davisu-china/mutual-app/server/internal/config"
)

const sampleKey = "avatars/12/9f8c1e2a-1111-2222-3333-444455556666.jpg"

func TestMediaPathFollowsPublicAPIPath(t *testing.T) {
	cases := map[string]string{
		"/api":        "/api/v1/media/" + sampleKey,
		"/mutual/api": "/mutual/api/v1/media/" + sampleKey,
		"/api/":       "/api/v1/media/" + sampleKey, // 结尾斜杠不该拼出双斜杠
	}
	for prefix, want := range cases {
		s := NewUploadService(nil, &config.Config{PublicAPIPath: prefix}, nil)
		if got := s.MediaPath(sampleKey); got != want {
			t.Errorf("PublicAPIPath=%q 时 MediaPath=%q，期望 %q", prefix, got, want)
		}
	}
}

func TestParseMediaKey(t *testing.T) {
	valid := []struct {
		key    string
		prefix string
		owner  int64
	}{
		{"avatars/12/9f8c1e2a-1111-2222-3333-444455556666.jpg", "avatars", 12},
		{"photos/1/9f8c1e2a-1111-2222-3333-444455556666.png", "photos", 1},
		{"photos/999/9F8C1E2A-1111-2222-3333-444455556666.webp", "photos", 999},
	}
	for _, c := range valid {
		prefix, owner, ok := ParseMediaKey(c.key)
		if !ok || prefix != c.prefix || owner != c.owner {
			t.Errorf("%q 应该解析成 (%s, %d)，实际 (%s, %d, %v)", c.key, c.prefix, c.owner, prefix, owner, ok)
		}
	}

	invalid := []string{
		"", // 空
		"avatar/12/9f8c1e2a-1111-2222-3333-444455556666.jpg",         // 前缀不在白名单
		"avatars/../9f8c1e2a-1111-2222-3333-444455556666.jpg",        // 路径花招
		"avatars/12/9f8c1e2a-1111-2222-3333-444455556666.gif",        // 扩展名不支持
		"avatars/12/not-a-uuid.jpg",                                  // 不是 uuid
		"avatars/abc/9f8c1e2a-1111-2222-3333-444455556666.jpg",       // 属主不是数字
		"avatars/12/9f8c1e2a-1111-2222-3333-444455556666",            // 没有扩展名
		"photos/12/sub/dir/9f8c1e2a-1111-2222-3333-444455556666.jpg", // 多了一层目录
	}
	for _, key := range invalid {
		if _, _, ok := ParseMediaKey(key); ok {
			t.Errorf("%q 不该解析成功", key)
		}
	}
}

// 媒体路径必须是同源相对路径——绝对 URL 会绕开鉴权，也会在 https 页面里触发混合内容。
func TestMediaPathStaysSameOrigin(t *testing.T) {
	s := NewUploadService(nil, &config.Config{PublicAPIPath: "/mutual/api"}, nil)
	got := s.MediaPath(sampleKey)
	if !strings.HasPrefix(got, "/") || strings.Contains(got, "://") {
		t.Fatalf("媒体路径应当是站内相对路径，实际 %q", got)
	}
}
