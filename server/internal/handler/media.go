package handler

import (
	"bytes"
	"errors"
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

	// 私有内容：允许浏览器缓存，但只允许私有缓存（共享缓存里不能留副本）
	c.Header("Cache-Control", "private, max-age=3600")
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
