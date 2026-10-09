package handler

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/davisu-china/mutual-app/server/internal/auth"
	"github.com/davisu-china/mutual-app/server/internal/config"
	"github.com/davisu-china/mutual-app/server/internal/service"
)

// 单张图片的硬上限，与前端提示、nginx 的 client_max_body_size 保持一致。
const maxUploadByte = 10 << 20

// MediaHandler 提供图片的读写。
//
// 浏览器里的 <img> 和上传的 PUT 都带不了 Authorization 头，所以这里用签名 cookie
// 认人（见 auth.MediaCookieName / middleware.MediaCookie），而不是 Bearer。
type MediaHandler struct {
	svc *service.UploadService
	cfg *config.Config
}

func NewMediaHandler(svc *service.UploadService, cfg *config.Config) *MediaHandler {
	return &MediaHandler{svc: svc, cfg: cfg}
}

// viewer 从读图 cookie 里取用户 id；没有或无效返回 0。
func (h *MediaHandler) viewer(c *gin.Context) int64 {
	raw, err := c.Cookie(auth.MediaCookieName)
	if err != nil || raw == "" {
		return 0
	}
	uid, _, ok := auth.VerifyMediaToken(h.cfg.JWTSecret, raw)
	if !ok {
		return 0
	}
	return uid
}

// 对象 key 是路由通配段，gin 会带上前导斜杠
func mediaKey(c *gin.Context) string {
	return strings.TrimPrefix(c.Param("key"), "/")
}

func (h *MediaHandler) Get(c *gin.Context) {
	key := mediaKey(c)
	uid := h.viewer(c)
	if uid == 0 {
		fail(c, http.StatusUnauthorized, "UNAUTHORIZED", "请先登录")
		return
	}

	readable, err := h.svc.MediaReadable(c.Request.Context(), uid, key)
	if err != nil {
		fail(c, http.StatusInternalServerError, "INTERNAL", "读取失败，请稍后重试")
		return
	}
	if !readable {
		// 「不存在」与「没有权限」都回 404：不告诉探测者这个 key 到底存不存在
		fail(c, http.StatusNotFound, "NOT_FOUND", "图片不存在")
		return
	}

	// 默认给缩略图：卡片/列表上只显示一两百像素，而用户传的是手机原图（几 MB），
	// 这台机器的公网上行只有 ~0.47MB/s——不缩的话首屏就是几秒钟的白块。
	// `?w=` 指定宽度，`?full=1` 取原图（给将来的大图查看用）。
	width := service.DefaultThumbWidth
	if v := c.Query("w"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			width = n
		}
	}
	if c.Query("full") == "1" {
		width = 0
	}

	// 同一张图、同一宽度，内容永远一样（对象名带 uuid，不会复用），
	// 所以 ETag 直接用 key+宽度算，省掉一次图片传输。
	etag := fmt.Sprintf(`"%s@%d"`, key, width)
	if c.GetHeader("If-None-Match") == etag {
		c.Status(http.StatusNotModified)
		return
	}
	c.Header("ETag", etag)
	c.Header("Cache-Control", "private, max-age=86400")

	if width > 0 {
		if data, ct, ok := h.svc.ThumbBytes(c.Request.Context(), key, width); ok {
			c.Header("Content-Type", ct)
			c.Header("Content-Length", strconv.Itoa(len(data)))
			c.Status(http.StatusOK)
			_, _ = c.Writer.Write(data)
			return
		}
		// 缩不了（不认识的编码等）就回原图，不能因为缩略图失败让图片打不开
	}

	obj, contentType, size, err := h.svc.OpenMedia(c.Request.Context(), key)
	if err != nil {
		if errors.Is(err, service.ErrMediaNotFound) {
			fail(c, http.StatusNotFound, "NOT_FOUND", "图片不存在")
			return
		}
		fail(c, http.StatusInternalServerError, "INTERNAL", "读取失败，请稍后重试")
		return
	}
	defer obj.Close()

	c.Header("Content-Type", contentType)
	if size > 0 {
		c.Header("Content-Length", strconv.FormatInt(size, 10))
	}
	c.Status(http.StatusOK)
	_, _ = io.Copy(c.Writer, obj)
}

func (h *MediaHandler) Put(c *gin.Context) {
	key := mediaKey(c)
	uid := h.viewer(c)
	if uid == 0 {
		fail(c, http.StatusUnauthorized, "UNAUTHORIZED", "请先登录")
		return
	}

	_, owner, okKey := service.ParseMediaKey(key)
	if !okKey {
		fail(c, http.StatusBadRequest, "INVALID_PARAM", "对象名不合法")
		return
	}
	if owner != uid {
		fail(c, http.StatusForbidden, "FORBIDDEN", "只能上传到自己的目录")
		return
	}

	// 上传大小硬限制。Content-Length 可以撒谎，所以按实际读到的字节数再判一次。
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxUploadByte)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			fail(c, http.StatusRequestEntityTooLarge, "TOO_LARGE", "图片不能超过 10MB")
			return
		}
		fail(c, http.StatusBadRequest, "INVALID_PARAM", "读取上传内容失败")
		return
	}
	if len(body) == 0 {
		fail(c, http.StatusBadRequest, "INVALID_PARAM", "上传内容为空")
		return
	}

	// 不信 Content-Type 头：真按字节嗅探一次，免得有人把脚本改名成 .jpg 传上来。
	contentType := http.DetectContentType(body)
	if !allowedUploadType(contentType) {
		fail(c, http.StatusBadRequest, "INVALID_FILE", "只支持 jpg / png / webp 图片")
		return
	}

	if err := h.svc.PutMedia(c.Request.Context(), key, contentType, bytes.NewReader(body), int64(len(body))); err != nil {
		fail(c, http.StatusInternalServerError, "INTERNAL", "上传失败，请重试")
		return
	}
	ok(c, gin.H{"objectKey": key})
}

func allowedUploadType(ct string) bool {
	switch ct {
	case "image/jpeg", "image/png", "image/webp":
		return true
	}
	return false
}
