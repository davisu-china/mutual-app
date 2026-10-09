package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/davisu-china/mutual-app/server/internal/middleware"
	"github.com/davisu-china/mutual-app/server/internal/service"
)

type ProfileHandler struct {
	svc *service.ProfileService
}

func NewProfileHandler(svc *service.ProfileService) *ProfileHandler {
	return &ProfileHandler{svc: svc}
}

// Me 返回本人完整资料。
func (h *ProfileHandler) Me(c *gin.Context) {
	v, err := h.svc.MyProfile(c.Request.Context(), middleware.UserID(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, v)
}

// Update 更新本人画像（增量：只传要改的字段）。
func (h *ProfileHandler) Update(c *gin.Context) {
	var req service.UpdateProfileInput
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, "INVALID_PARAM", "参数格式不正确")
		return
	}
	if err := h.svc.Update(c.Request.Context(), middleware.UserID(c), req); err != nil {
		mapErr(c, err)
		return
	}
	ok(c, nil)
}

type hobbiesReq struct {
	Hobbies []service.HobbyView `json:"hobbies" binding:"required"`
}

func (h *ProfileHandler) SetHobbies(c *gin.Context) {
	var req hobbiesReq
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, "INVALID_PARAM", "请提供 hobbies 数组")
		return
	}
	if err := h.svc.SetHobbies(c.Request.Context(), middleware.UserID(c), req.Hobbies); err != nil {
		mapErr(c, err)
		return
	}
	ok(c, nil)
}

type textsReq struct {
	AboutMe       *string `json:"aboutMe"`
	ExpectPartner *string `json:"expectPartner"`
}

func (h *ProfileHandler) SetTexts(c *gin.Context) {
	var req textsReq
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, "INVALID_PARAM", "参数格式不正确")
		return
	}
	if err := h.svc.SetTexts(c.Request.Context(), middleware.UserID(c),
		req.AboutMe, req.ExpectPartner); err != nil {
		mapErr(c, err)
		return
	}
	ok(c, nil)
}

func (h *ProfileHandler) SetPreference(c *gin.Context) {
	var req service.PreferenceView
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, "INVALID_PARAM", "参数格式不正确")
		return
	}
	if err := h.svc.SetPreference(c.Request.Context(), middleware.UserID(c), req); err != nil {
		mapErr(c, err)
		return
	}
	ok(c, nil)
}

// Complete 收口 Onboarding，通过后才允许进入划卡。
func (h *ProfileHandler) Complete(c *gin.Context) {
	if err := h.svc.CompleteOnboarding(c.Request.Context(), middleware.UserID(c)); err != nil {
		mapErr(c, err)
		return
	}
	ok(c, gin.H{"onboarded": true})
}

// View 查看他人主页（会自动记一次 Visit）。
func (h *ProfileHandler) View(c *gin.Context) {
	target, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		fail(c, 400, "INVALID_PARAM", "用户 id 不合法")
		return
	}
	v, err := h.svc.PublicProfile(c.Request.Context(), middleware.UserID(c), target)
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, v)
}
