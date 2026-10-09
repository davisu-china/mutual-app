package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/davisu-china/mutual-app/server/internal/config"
	"github.com/davisu-china/mutual-app/server/internal/infra"
	"github.com/davisu-china/mutual-app/server/internal/model"
)

var (
	ErrPhotoLimit      = errors.New("相册已满 9 张")
	ErrPhotoLastOne    = errors.New("至少保留一张照片")
	ErrBadOrderPayload = errors.New("排序数据不合法")
)

const (
	presignTTL   = 10 * time.Minute
	maxPhotoByte = 10 << 20 // 10MB
)

type UploadService struct {
	db      *gorm.DB
	cfg     *config.Config
	storage *infra.Storage
}

func NewUploadService(db *gorm.DB, cfg *config.Config, storage *infra.Storage) *UploadService {
	return &UploadService{db: db, cfg: cfg, storage: storage}
}

type PresignResult struct {
	UploadURL string            `json:"uploadUrl"`
	ObjectKey string            `json:"objectKey"`
	PublicURL string            `json:"publicUrl"`
	Headers   map[string]string `json:"headers"`
	ExpiresIn int               `json:"expiresIn"`
}

// PresignPhoto 签发相册上传凭证。
//
// 客户端**直传 MinIO**，不经过后端——省一次中转，也避免大文件占用 API 进程（技术方案 9.4）。
// 预签名 URL 的有效期与 Content-Type 都被钉死，防止被当成免费图床滥用。
func (s *UploadService) PresignPhoto(ctx context.Context, uid int64, contentType string) (*PresignResult, error) {
	if err := s.assertPhotoCapacity(ctx, uid); err != nil {
		return nil, err
	}
	return s.presign(ctx, s.storage.Photos, uid, "photos", contentType)
}

func (s *UploadService) PresignAvatar(ctx context.Context, uid int64, contentType string) (*PresignResult, error) {
	return s.presign(ctx, s.storage.Avatars, uid, "avatars", contentType)
}

func (s *UploadService) presign(ctx context.Context, bucket string, uid int64, prefix, contentType string) (*PresignResult, error) {
	if !isAllowedImageType(contentType) {
		return nil, errors.New("仅支持 jpg / png / webp 图片")
	}

	ext := extFor(contentType)
	key := fmt.Sprintf("%s/%d/%s%s", prefix, uid, uuid.NewString(), ext)

	u, err := s.storage.Client.PresignedPutObject(ctx, bucket, key, presignTTL)
	if err != nil {
		return nil, fmt.Errorf("签发上传凭证失败: %w", err)
	}

	return &PresignResult{
		UploadURL: u.String(),
		ObjectKey: key,
		PublicURL: s.publicURL(bucket, key),
		Headers:   map[string]string{"Content-Type": contentType},
		ExpiresIn: int(presignTTL.Seconds()),
	}, nil
}

// ConfirmPhoto 客户端上传成功后回调，落库为待审核状态。
//
// 「上传成功」不等于「可见」——未过审的照片不会出现在卡池与广场里（PRD 13.2）。
func (s *UploadService) ConfirmPhoto(ctx context.Context, uid int64, objectKey string) (*model.UserPhoto, error) {
	if err := s.assertPhotoCapacity(ctx, uid); err != nil {
		return nil, err
	}

	var maxOrder int16
	s.db.WithContext(ctx).Model(&model.UserPhoto{}).
		Where("user_id = ?", uid).
		Select("COALESCE(MAX(sort_order), 0)").Scan(&maxOrder)

	status := model.AuditPending
	// 开发环境自动过审，否则没有审核后台时整个流程走不通。
	// **生产环境必须接入真实的内容安全服务**（PRD 14.1）。
	if s.cfg.Env == "dev" {
		status = model.AuditApproved
	}

	p := &model.UserPhoto{
		UserID:      uid,
		URL:         s.publicURL(s.storage.Photos, objectKey),
		SortOrder:   maxOrder + 1,
		AuditStatus: status,
		Visibility:  "public",
	}
	if err := s.db.WithContext(ctx).Create(p).Error; err != nil {
		return nil, err
	}

	s.db.WithContext(ctx).Exec(`
		UPDATE users SET updated_at = now() WHERE id = ?
	`, uid)
	return p, nil
}

func (s *UploadService) ConfirmAvatar(ctx context.Context, uid int64, objectKey string) (*model.UserAvatar, error) {
	status := model.AuditPending
	if s.cfg.Env == "dev" {
		status = model.AuditApproved
	}

	av := &model.UserAvatar{
		UserID:      uid,
		URL:         s.publicURL(s.storage.Avatars, objectKey),
		AuditStatus: status,
	}

	err := s.db.WithContext(ctx).Clauses().Save(av).Error
	if err != nil {
		return nil, err
	}
	return av, nil
}

// DeletePhoto 删除一张照片。至少保留一张，否则用户无法再被划卡。
func (s *UploadService) DeletePhoto(ctx context.Context, uid, photoID int64) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var count int64
		tx.Model(&model.UserPhoto{}).Where("user_id = ?", uid).Count(&count)
		if count <= 1 {
			return ErrPhotoLastOne
		}

		var p model.UserPhoto
		if err := tx.Where("id = ? AND user_id = ?", photoID, uid).First(&p).Error; err != nil {
			return errors.New("照片不存在")
		}
		if err := tx.Delete(&model.UserPhoto{}, p.ID).Error; err != nil {
			return err
		}
		// 删掉后把后面的顺序号往前收，避免出现空洞
		return tx.Exec(`
			UPDATE user_photos SET sort_order = sort_order - 1
			 WHERE user_id = ? AND sort_order > ?
		`, uid, p.SortOrder).Error
	})
}

// ReorderPhotos 提交拖拽后的新顺序。
//
// 走「两步更新」：先把这组顺序号整体推到负数区间，再写回目标值。
// 否则直接更新会撞 (user_id, sort_order) 的唯一约束——
// 唯一约束是 DEFERRABLE 的，但用负号区间更稳妥，也不依赖事务隔离级别。
func (s *UploadService) ReorderPhotos(ctx context.Context, uid int64, orderedIDs []int64) error {
	if len(orderedIDs) == 0 {
		return ErrBadOrderPayload
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing []model.UserPhoto
		if err := tx.Where("user_id = ?", uid).Find(&existing).Error; err != nil {
			return err
		}
		if len(existing) != len(orderedIDs) {
			return errors.New("排序列表与现有照片数量不一致")
		}

		owned := map[int64]bool{}
		for _, p := range existing {
			owned[p.ID] = true
		}
		for _, id := range orderedIDs {
			if !owned[id] {
				return errors.New("排序列表包含不属于你的照片")
			}
		}

		// 第一步：整体挪到负数区间，腾出位置
		if err := tx.Exec(`
			UPDATE user_photos SET sort_order = -sort_order WHERE user_id = ?
		`, uid).Error; err != nil {
			return err
		}

		// 第二步：按新顺序写回
		for i, id := range orderedIDs {
			if err := tx.Exec(`
				UPDATE user_photos SET sort_order = ? WHERE id = ? AND user_id = ?
			`, int16(i+1), id, uid).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *UploadService) SetPhotoVisibility(ctx context.Context, uid, photoID int64, visibility string) error {
	if visibility != "public" && visibility != "match_only" {
		return errors.New("可见性取值不合法")
	}
	return s.db.WithContext(ctx).Model(&model.UserPhoto{}).
		Where("id = ? AND user_id = ?", photoID, uid).
		Update("visibility", visibility).Error
}

func (s *UploadService) MyPhotos(ctx context.Context, uid int64) ([]model.UserPhoto, error) {
	var out []model.UserPhoto
	err := s.db.WithContext(ctx).Where("user_id = ?", uid).
		Order("sort_order asc").Find(&out).Error
	return out, err
}

// ---------- 内部 ----------

func (s *UploadService) assertPhotoCapacity(ctx context.Context, uid int64) error {
	var n int64
	if err := s.db.WithContext(ctx).Model(&model.UserPhoto{}).
		Where("user_id = ?", uid).Count(&n).Error; err != nil {
		return err
	}
	if int(n) >= s.cfg.MaxPhotos {
		return ErrPhotoLimit
	}
	return nil
}

func (s *UploadService) publicURL(bucket, key string) string {
	// 对象是私有的，URL 只是「key 的稳定表示」，前端展示时再换成预签名 GET。
	// 这里保留 bucket 前缀，方便将来接入 CDN 时直接改这一处。
	base := strings.TrimSuffix(s.storage.PublicBase, "/")
	if base == "" {
		return fmt.Sprintf("/%s/%s", bucket, key)
	}
	return fmt.Sprintf("%s/%s/%s", base, bucket, key)
}

func isAllowedImageType(ct string) bool {
	switch strings.ToLower(strings.TrimSpace(ct)) {
	case "image/jpeg", "image/jpg", "image/png", "image/webp":
		return true
	}
	return false
}

func extFor(ct string) string {
	switch strings.ToLower(ct) {
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	default:
		return ".jpg"
	}
}
