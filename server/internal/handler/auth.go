package handler

import (
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/davisu-china/mutual-app/server/internal/middleware"
	"github.com/davisu-china/mutual-app/server/internal/service"
)

type AuthHandler struct {
	svc *service.AuthService
}

func NewAuthHandler(svc *service.AuthService) *AuthHandler {
	return &AuthHandler{svc: svc}
}

type registerReq struct {
	Phone    string `json:"phone" binding:"required"`
	Password string `json:"password" binding:"required"`
	DeviceID string `json:"deviceId"`
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req registerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, "INVALID_PARAM", "参数不完整")
		return
	}

	res, err := h.svc.Register(c.Request.Context(), service.RegisterInput{
		Phone:    strings.TrimSpace(req.Phone),
		Password: req.Password,
		DeviceID: req.DeviceID,
		IP:       c.ClientIP(),
	})
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, res)
}

type loginReq struct {
	Phone    string `json:"phone" binding:"required"`
	Password string `json:"password" binding:"required"`
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req loginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, "INVALID_PARAM", "参数不完整")
		return
	}

	res, err := h.svc.Login(c.Request.Context(), strings.TrimSpace(req.Phone), req.Password)
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, res)
}

type refreshReq struct {
	RefreshToken string `json:"refreshToken" binding:"required"`
}

func (h *AuthHandler) Refresh(c *gin.Context) {
	var req refreshReq
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, "INVALID_PARAM", "缺少 refreshToken")
		return
	}
	res, err := h.svc.Refresh(c.Request.Context(), req.RefreshToken)
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, res)
}

// Me 返回登录态与 Onboarding 进度，前端据此决定跳哪个页面。
func (h *AuthHandler) Me(c *gin.Context) {
	ok(c, gin.H{
		"userId": middleware.UserID(c),
	})
}
