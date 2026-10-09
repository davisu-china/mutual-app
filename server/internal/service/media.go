package service

import (
	"context"
	"errors"
	"io"
	"regexp"
	"strconv"
	"strings"

	"github.com/minio/minio-go/v7"
	"gorm.io/gorm"

	"github.com/davisu-china/mutual-app/server/internal/model"
)

// ---------- 媒体（头像 / 相册）----------
//
// 为什么不把 MinIO 直接暴露给浏览器、也不把桶设成公开读：
// 相册里有「只给配对对象看」的照片，公开读等于把「可见性」这个功能抹掉；
// 而预签名 URL 又有有效期，存进库里过几天就失效，图片会集体变裂。
//
// 所以浏览器请求的是本服务的 <API 前缀>/v1/media/<key>，由服务端查完权限再回源
// MinIO。代价是图片要走一次 API 进程（技术方案 9.4 原本想省掉这一跳），换来的是：
// 桶保持私有、库里存的是稳定不失效的同源路径、可见性规则每次请求都生效。

// ErrMediaNotFound 表示对象不存在（或不该让当前用户知道它存在）。
var ErrMediaNotFound = errors.New("图片不存在")

// 对象 key 的形状由服务端在签发上传凭证时决定，这里据此严格校验：
// 前缀决定桶、第二段是属主 id、第三段是 uuid，扩展名只有三种。
// 严格匹配顺带挡掉了 ../ 之类的路径花招。
var mediaKeyRe = regexp.MustCompile(
	`^(avatars|photos)/(\d+)/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(jpg|png|webp)$`)

// MediaPath 把对象 key 拼成浏览器可直接请求的同源路径。
func (s *UploadService) MediaPath(key string) string {
	return s.cfg.MediaPathPrefix() + "/" + key
}

// ParseMediaKey 解析 "photos/12/<uuid>.jpg"，返回前缀与属主 id。
func ParseMediaKey(key string) (prefix string, ownerID int64, ok bool) {
	m := mediaKeyRe.FindStringSubmatch(key)
	if m == nil {
		return "", 0, false
	}
	id, err := strconv.ParseInt(m[2], 10, 64)
	if err != nil {
		return "", 0, false
	}
	return m[1], id, true
}

func (s *UploadService) bucketOf(prefix string) string {
	if prefix == "avatars" {
		return s.storage.Avatars
	}
	return s.storage.Photos
}

// MediaReadable 判断 viewer 能不能读这个对象。
//
// 规则（PRD 13.2 / 15 章）：
//   - 头像：登录用户都能看——卡片、广场、聊天里本来就到处露脸；
//   - 相册：本人随便看；别人的要看照片自己的可见性（public 谁都能看，
//     match_only 只有配对上的人能看），且必须已过审。
func (s *UploadService) MediaReadable(ctx context.Context, viewer int64, key string) (bool, error) {
	prefix, owner, ok := ParseMediaKey(key)
	if !ok {
		return false, nil
	}
	if prefix == "avatars" {
		return true, nil
	}
	if viewer == owner {
		return true, nil
	}

	var p model.UserPhoto
	err := s.db.WithContext(ctx).
		Where("user_id = ? AND url LIKE ?", owner, "%"+key).
		First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if p.AuditStatus != model.AuditApproved {
		return false, nil
	}
	if p.Visibility == "public" {
		return true, nil
	}
	return s.isMatchedWith(ctx, viewer, owner)
}

func (s *UploadService) isMatchedWith(ctx context.Context, a, b int64) (bool, error) {
	if a == 0 || b == 0 || a == b {
		return false, nil
	}
	lo, hi := a, b
	if lo > hi {
		lo, hi = hi, lo
	}
	var n int64
	err := s.db.WithContext(ctx).Model(&model.MatchRecord{}).
		Where("user_a = ? AND user_b = ? AND status = ?", lo, hi, model.MatchActive).
		Count(&n).Error
	return n > 0, err
}

// PutMedia 把客户端上传的字节写进对象存储。
func (s *UploadService) PutMedia(ctx context.Context, key, contentType string, r io.Reader, size int64) error {
	prefix, _, ok := ParseMediaKey(key)
	if !ok {
		return invalidInput("对象名不合法")
	}
	if !isAllowedImageType(contentType) {
		return invalidInput("仅支持 jpg / png / webp 图片")
	}
	_, err := s.storage.Client.PutObject(ctx, s.bucketOf(prefix), key, r, size,
		minio.PutObjectOptions{ContentType: contentType})
	return err
}

// OpenMedia 取回对象，返回流、它的 Content-Type 和字节数。
func (s *UploadService) OpenMedia(ctx context.Context, key string) (io.ReadCloser, string, int64, error) {
	prefix, _, ok := ParseMediaKey(key)
	if !ok {
		return nil, "", 0, ErrMediaNotFound
	}

	obj, err := s.storage.Client.GetObject(ctx, s.bucketOf(prefix), key, minio.GetObjectOptions{})
	if err != nil {
		return nil, "", 0, err
	}
	st, err := obj.Stat()
	if err != nil {
		obj.Close()
		var e minio.ErrorResponse
		if errors.As(err, &e) && strings.Contains(e.Code, "NoSuchKey") {
			return nil, "", 0, ErrMediaNotFound
		}
		return nil, "", 0, err
	}
	ct := st.ContentType
	if ct == "" {
		ct = "application/octet-stream"
	}
	return obj, ct, st.Size, nil
}
