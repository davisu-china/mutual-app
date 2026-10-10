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
	ErrPhotoNotFound   = errors.New("照片不存在")
)

const (
	presignTTL   = 10 * time.Minute
	maxPhotoByte = 10 << 20 // 10MB
)

type UploadService struct {
	db      *gorm.DB
	cfg     *config.Config
	storage *infra.Storage
	// 缩略图内存缓存（见 media_resize.go）
	thumbs *thumbCache
}

func NewUploadService(db *gorm.DB, cfg *config.Config, storage *infra.Storage) *UploadService {
	return &UploadService{db: db, cfg: cfg, storage: storage, thumbs: newThumbCache(96 << 20)}
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
// 客户端拿到的是一个**服务端自己的媒体地址**（上传走本服务的 /v1/media/<key>），
// 由服务端校验后写进 MinIO。内容类型在签发时就钉死，防止被当成免费图床滥用。
func (s *UploadService) PresignPhoto(ctx context.Context, uid int64, contentType string) (*PresignResult, error) {
	if err := s.assertPhotoCapacity(ctx, uid); err != nil {
		return nil, err
	}
	return s.presign(ctx, uid, "photos", contentType)
}

func (s *UploadService) PresignAvatar(ctx context.Context, uid int64, contentType string) (*PresignResult, error) {
	return s.presign(ctx, uid, "avatars", contentType)
}

func (s *UploadService) presign(ctx context.Context, uid int64, prefix, contentType string) (*PresignResult, error) {
	if !isAllowedImageType(contentType) {
		return nil, invalidInput("仅支持 jpg / png / webp 图片")
	}

	ext := extFor(contentType)
	key := fmt.Sprintf("%s/%d/%s%s", prefix, uid, uuid.NewString(), ext)

	// 上传地址指向本服务自己的媒体路由：浏览器 PUT 过来，服务端再写进 MinIO。
	// 前端那套「presign → 直传 → confirm」的协议不用改，但**地址必须同源**：
	// 原先返回的是 MinIO 的预签名 URL，主机是 127.0.0.1:9000 且是 http，
	// 在 https 页面里既够不着（127.0.0.1 是用户自己的机器），
	// 也会被浏览器当混合内容直接拦掉——头像上传就是这么失败的。
	return &PresignResult{
		UploadURL: s.MediaPath(key),
		ObjectKey: key,
		PublicURL: s.MediaPath(key),
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

	// 由显式开关决定，而不是看 env。
	// 没有审核服务时照片全停在 pending，卡池会永远是空的（见 config.AuditAutoApprove）。
	status := model.AuditPending
	if s.cfg.AuditAutoApprove {
		status = model.AuditApproved
	}

	p := &model.UserPhoto{
		UserID:      uid,
		URL:         s.MediaPath(objectKey),
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
	if s.cfg.AuditAutoApprove {
		status = model.AuditApproved
	}

	av := &model.UserAvatar{
		UserID:      uid,
		URL:         s.MediaPath(objectKey),
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
			return ErrPhotoNotFound
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
// 直接按新顺序逐条写回即可：uq_photo_order 是 DEFERRABLE INITIALLY DEFERRED，
// 唯一性推迟到事务提交时才校验，所以中途出现重复值不会被拒。
//
// ⚠️ 这里原本先把整组顺序号取负「腾位置」，但表上有
// CHECK (sort_order BETWEEN 1 AND 9) —— 负值直接违反约束，事务整条回滚。
// 也就是说**相册拖拽排序一直是坏的**，任何一次换序都会失败。
// 约束本来就是延迟的，那一步从一开始就是多余的。
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
			return invalidInput("排序列表与现有照片数量不一致")
		}

		owned := map[int64]bool{}
		for _, p := range existing {
			owned[p.ID] = true
		}
		for _, id := range orderedIDs {
			if !owned[id] {
				return invalidInput("排序列表包含不属于你的照片")
			}
		}

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
		return invalidInput("可见性取值不合法")
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
