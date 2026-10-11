package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/davisu-china/mutual-app/server/internal/middleware"
	"github.com/davisu-china/mutual-app/server/internal/service"
)

// AdminHandler 后台接口。
//
// **几乎全是 GET**：唯一会写的两个是封禁 / 解封（用户资料或相册有问题时用），
// 删号之类的破坏性操作仍然留给运维直接改库。
//
// 鉴权不在这一层——路由上挂了 middleware.AdminGuard，
// 所以这里只管参数绑定和调 service。
type AdminHandler struct{ svc *service.AdminService }

func NewAdminHandler(svc *service.AdminService) *AdminHandler { return &AdminHandler{svc: svc} }

func (h *AdminHandler) Stats(c *gin.Context) {
	v, err := h.svc.Stats(c.Request.Context())
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, v)
}

func (h *AdminHandler) Users(c *gin.Context) {
	f := service.AdminUserFilter{
		Keyword:  c.Query("q"),
		Status:   c.Query("status"),
		OnlyDone: c.Query("onboarded") == "1",
		Page:     atoiDefault(c.Query("page"), 1),
		PageSize: atoiDefault(c.Query("pageSize"), 20),
	}
	if g := atoiDefault(c.Query("gender"), 0); g == 1 || g == 2 {
		f.Gender = int16(g)
	}
	items, total, err := h.svc.Users(c.Request.Context(), f)
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, gin.H{"items": items, "total": total, "page": f.Page, "pageSize": f.PageSize})
}

func (h *AdminHandler) UserDetail(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		fail(c, http.StatusBadRequest, "INVALID_PARAM", "用户 id 不合法")
		return
	}
	v, err := h.svc.Detail(c.Request.Context(), id)
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, v)
}

// BanUser 封禁。body 里必须带 reason——它会原话展示给被封的用户。
func (h *AdminHandler) BanUser(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		fail(c, http.StatusBadRequest, "INVALID_PARAM", "用户 id 不合法")
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, http.StatusBadRequest, "INVALID_PARAM", "缺少 reason")
		return
	}
	// 操作人是当前登录的管理员（AdminGuard 已经验过 is_admin）
	if err := h.svc.BanUser(c.Request.Context(), middleware.UserID(c), id, body.Reason); err != nil {
		mapErr(c, err)
		return
	}
	ok(c, gin.H{"status": "banned"})
}

// UnbanUser 解封（封错了、或者整改后放回来）。
func (h *AdminHandler) UnbanUser(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		fail(c, http.StatusBadRequest, "INVALID_PARAM", "用户 id 不合法")
		return
	}
	if err := h.svc.UnbanUser(c.Request.Context(), middleware.UserID(c), id); err != nil {
		mapErr(c, err)
		return
	}
	ok(c, gin.H{"status": "active"})
}

// UserActions 划卡记录。direction=sent 是"TA 划别人"，received 是"别人划 TA"。
func (h *AdminHandler) UserActions(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		fail(c, http.StatusBadRequest, "INVALID_PARAM", "用户 id 不合法")
		return
	}
	sent := c.DefaultQuery("direction", "sent") != "received"
	action := c.Query("action")
	if action != "" && action != "like" && action != "pass" && action != "visit" {
		fail(c, http.StatusBadRequest, "INVALID_PARAM", "action 只能是 like / pass / visit")
		return
	}
	page, size := atoiDefault(c.Query("page"), 1), atoiDefault(c.Query("pageSize"), 20)
	items, total, err := h.svc.Actions(c.Request.Context(), id, sent, action, page, size)
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, gin.H{"items": items, "total": total, "page": page, "pageSize": size, "direction": map[bool]string{true: "sent", false: "received"}[sent]})
}

func (h *AdminHandler) Conversations(c *gin.Context) {
	page, size := atoiDefault(c.Query("page"), 1), atoiDefault(c.Query("pageSize"), 20)
	items, total, err := h.svc.Conversations(
		c.Request.Context(), c.Query("q"),
		int64(atoiDefault(c.Query("userId"), 0)), page, size)
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, gin.H{"items": items, "total": total, "page": page, "pageSize": size})
}

func (h *AdminHandler) Conversation(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		fail(c, http.StatusBadRequest, "INVALID_PARAM", "会话 id 不合法")
		return
	}
	v, err := h.svc.Conversation(c.Request.Context(), id)
	if err != nil {
		mapErr(c, err)
		return
	}
	ok(c, v)
}

// atoiDefault 把查询参数转成 int，缺省或非法时给默认值。
// 后台的翻页参数没必要因为一个手写的 ?page=abc 就报错——按第一页处理即可。
func atoiDefault(s string, def int) int {
	if n, err := strconv.Atoi(s); err == nil && n > 0 {
		return n
	}
	return def
}
