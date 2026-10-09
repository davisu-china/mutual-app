package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/davisu-china/mutual-app/server/internal/middleware"
	"github.com/davisu-china/mutual-app/server/internal/service"
)

type UploadHandler struct {
	svc *service.UploadService
}

func NewUploadHandler(svc *service.UploadService) *UploadHandler {
	return &UploadHandler{svc: svc}
}

type presignReq struct {
	ContentType string `json:"contentType" binding:"required"`
}

func (h *UploadHandler) PresignPhoto(c *gin.Context) {
	var req presignReq
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, "INVALID_PARAM", "缺少 contentType")
		return
	}
	res, err := h.svc.PresignPhoto(c.Request.Context(), middleware.UserID(c), req.ContentType)
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, res)
}

func (h *UploadHandler) PresignAvatar(c *gin.Context) {
	var req presignReq
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, "INVALID_PARAM", "缺少 contentType")
		return
	}
	res, err := h.svc.PresignAvatar(c.Request.Context(), middleware.UserID(c), req.ContentType)
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, res)
}

type confirmReq struct {
	ObjectKey string `json:"objectKey" binding:"required"`
}

func (h *UploadHandler) ConfirmPhoto(c *gin.Context) {
	var req confirmReq
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, "INVALID_PARAM", "缺少 objectKey")
		return
	}
	p, err := h.svc.ConfirmPhoto(c.Request.Context(), middleware.UserID(c), req.ObjectKey)
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, p)
}

func (h *UploadHandler) ConfirmAvatar(c *gin.Context) {
	var req confirmReq
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, "INVALID_PARAM", "缺少 objectKey")
		return
	}
	av, err := h.svc.ConfirmAvatar(c.Request.Context(), middleware.UserID(c), req.ObjectKey)
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, av)
}

func (h *UploadHandler) MyPhotos(c *gin.Context) {
	list, err := h.svc.MyPhotos(c.Request.Context(), middleware.UserID(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, gin.H{"items": list})
}

func (h *UploadHandler) DeletePhoto(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		fail(c, 400, "INVALID_PARAM", "照片 id 不合法")
		return
	}
	if err := h.svc.DeletePhoto(c.Request.Context(), middleware.UserID(c), id); err != nil {
		mapErr(c, err)
		return
	}
	ok(c, nil)
}

// Reorder 提交拖拽后的顺序。
//
// 前端在用户松手后就调这个接口——顺序是用户的显式意图，不该等到点保存才落库。
type reorderReq struct {
	OrderedIDs []int64 `json:"orderedIds" binding:"required"`
}

func (h *UploadHandler) Reorder(c *gin.Context) {
	var req reorderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, "INVALID_PARAM", "缺少 orderedIds")
		return
	}
	if err := h.svc.ReorderPhotos(c.Request.Context(), middleware.UserID(c), req.OrderedIDs); err != nil {
		mapErr(c, err)
		return
	}
	ok(c, nil)
}

type visibilityReq struct {
	Visibility string `json:"visibility" binding:"required"`
}

func (h *UploadHandler) SetVisibility(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		fail(c, 400, "INVALID_PARAM", "照片 id 不合法")
		return
	}
	var req visibilityReq
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, "INVALID_PARAM", "缺少 visibility")
		return
	}
	if err := h.svc.SetPhotoVisibility(c.Request.Context(), middleware.UserID(c), id, req.Visibility); err != nil {
		mapErr(c, err)
		return
	}
	ok(c, nil)
}
