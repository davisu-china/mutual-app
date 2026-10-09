package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/davisu-china/mutual-app/server/internal/middleware"
	"github.com/davisu-china/mutual-app/server/internal/model"
	"github.com/davisu-china/mutual-app/server/internal/service"
)

type DiscoveryHandler struct {
	disc   *service.DiscoveryService
	action *service.ActionService
	social *service.SocialService
}

func NewDiscoveryHandler(
	disc *service.DiscoveryService,
	action *service.ActionService,
	social *service.SocialService,
) *DiscoveryHandler {
	return &DiscoveryHandler{disc: disc, action: action, social: social}
}

// Cards 拉取划卡候选，并带上今日剩余额度。
//
// 额度和卡片一起返回，前端一次请求就能画出「今日还可喜欢 N 人」，
// 不用再单独请求一次。
func (h *DiscoveryHandler) Cards(c *gin.Context) {
	uid := middleware.UserID(c)
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))

	cards, err := h.disc.Cards(c.Request.Context(), uid, limit)
	if err != nil {
		mapErr(c, err)
		return
	}
	quota, err := h.action.Quota(c.Request.Context(), uid)
	if err != nil {
		mapErr(c, err)
		return
	}

	ok(c, gin.H{
		"cards": cards,
		"quota": gin.H{
			"used":   quota.QuotaUsed,
			"limit":  quota.QuotaLimit,
			"remain": quota.QuotaRemain,
		},
	})
}

// Quota 单独查额度（划卡页刷新时用）。
func (h *DiscoveryHandler) Quota(c *gin.Context) {
	q, err := h.action.Quota(c.Request.Context(), middleware.UserID(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, gin.H{"used": q.QuotaUsed, "limit": q.QuotaLimit, "remain": q.QuotaRemain})
}

type actionReq struct {
	ToUser int64  `json:"toUser" binding:"required"`
	Action string `json:"action" binding:"required"`
	Source string `json:"source"`
}

// Act 提交 like / pass / visit。
//
// 返回体里的 matched 决定前端是否播放配对动画。
func (h *DiscoveryHandler) Act(c *gin.Context) {
	var req actionReq
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, "INVALID_PARAM", "参数不完整")
		return
	}
	if req.Source == "" {
		req.Source = model.SourceCard
	}

	res, err := h.action.Do(c.Request.Context(), service.ActionInput{
		FromUser: middleware.UserID(c),
		ToUser:   req.ToUser,
		Action:   req.Action,
		Source:   req.Source,
	})
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, res)
}

// Plaza 按条件检索。
func (h *DiscoveryHandler) Plaza(c *gin.Context) {
	uid := middleware.UserID(c)

	f := service.PlazaFilter{}
	if v := c.Query("gender"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			g := int16(n)
			f.Gender = &g
		}
	}
	f.AgeMin = intPtr(c.Query("ageMin"))
	f.AgeMax = intPtr(c.Query("ageMax"))
	f.HeightMin = int16Ptr(c.Query("heightMin"))
	f.HeightMax = int16Ptr(c.Query("heightMax"))
	if v := c.Query("cityProvince"); v != "" {
		f.CityProv = &v
	}
	if v := c.Query("keyword"); v != "" {
		f.Keyword = &v
	}
	if v := c.Query("education"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			f.Education = append(f.Education, int16(n))
		}
	}
	if v := c.Query("cursor"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			f.Cursor = n
		}
	}

	cards, next, err := h.disc.Plaza(c.Request.Context(), uid, f, 20)
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, gin.H{"cards": cards, "nextCursor": next})
}

// LikesMe 谁喜欢我。
func (h *DiscoveryHandler) LikesMe(c *gin.Context) {
	list, err := h.social.LikesMe(c.Request.Context(), middleware.UserID(c), 50)
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, gin.H{"items": list})
}

// VisitsMe 谁看过我。
func (h *DiscoveryHandler) VisitsMe(c *gin.Context) {
	list, err := h.social.VisitsMe(c.Request.Context(), middleware.UserID(c), 50)
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, gin.H{"items": list})
}

// Counts 底部 Tab 的角标数。
func (h *DiscoveryHandler) Counts(c *gin.Context) {
	likes, visits, unread, err := h.social.Counts(c.Request.Context(), middleware.UserID(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, gin.H{"likes": likes, "visits": visits, "unread": unread})
}

// Matches 我的配对列表。
func (h *DiscoveryHandler) Matches(c *gin.Context) {
	list, err := h.social.MatchList(c.Request.Context(), middleware.UserID(c), 100)
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, gin.H{"items": list})
}

// Unmatch 解除配对。
func (h *DiscoveryHandler) Unmatch(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		fail(c, 400, "INVALID_PARAM", "配对 id 不合法")
		return
	}
	if err := h.action.Unmatch(c.Request.Context(), middleware.UserID(c), id); err != nil {
		mapErr(c, err)
		return
	}
	ok(c, nil)
}

type blockReq struct {
	TargetUser int64 `json:"targetUser" binding:"required"`
}

func (h *DiscoveryHandler) Block(c *gin.Context) {
	var req blockReq
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, "INVALID_PARAM", "参数不完整")
		return
	}
	if err := h.action.Block(c.Request.Context(), middleware.UserID(c), req.TargetUser); err != nil {
		mapErr(c, err)
		return
	}
	ok(c, nil)
}

func (h *DiscoveryHandler) Unblock(c *gin.Context) {
	var req blockReq
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, "INVALID_PARAM", "参数不完整")
		return
	}
	if err := h.action.Unblock(c.Request.Context(), middleware.UserID(c), req.TargetUser); err != nil {
		mapErr(c, err)
		return
	}
	ok(c, nil)
}

type reportReq struct {
	TargetUser int64  `json:"targetUser" binding:"required"`
	TargetType string `json:"targetType"`
	Reason     string `json:"reason" binding:"required"`
	Detail     string `json:"detail"`
}

func (h *DiscoveryHandler) Report(c *gin.Context) {
	var req reportReq
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, 400, "INVALID_PARAM", "参数不完整")
		return
	}
	if req.TargetType == "" {
		req.TargetType = "user"
	}
	var detail *string
	if req.Detail != "" {
		detail = &req.Detail
	}
	if err := h.action.Report(c.Request.Context(), middleware.UserID(c),
		req.TargetUser, req.TargetType, req.Reason, detail); err != nil {
		mapErr(c, err)
		return
	}
	ok(c, nil)
}

// ---------- 小工具 ----------

func intPtr(s string) *int {
	if s == "" {
		return nil
	}
	if n, err := strconv.Atoi(s); err == nil {
		return &n
	}
	return nil
}

func int16Ptr(s string) *int16 {
	if s == "" {
		return nil
	}
	if n, err := strconv.Atoi(s); err == nil {
		v := int16(n)
		return &v
	}
	return nil
}
