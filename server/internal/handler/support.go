package handler

import (
	"github.com/gin-gonic/gin"

	"github.com/davisu-china/mutual-app/server/internal/config"
)

// SupportHandler 告诉客户端"有问题找谁"。
//
// 为什么放在服务端而不是写死在客户端：联系方式是会变的（换微信号、换成客服号），
// 而 App 发出去之后改一行字就要重新发版；放这里改一处配置，App 和网页两个客户端
// 读的是同一个值。
type SupportHandler struct{ cfg *config.Config }

func NewSupportHandler(cfg *config.Config) *SupportHandler { return &SupportHandler{cfg: cfg} }

// Get 返回联系方式。
//
// **没配置就返回空串**——客户端据此把整个入口藏起来，而不是显示一个假的微信号。
// 这个接口只要登录就能访问（不挂 OnboardGuard）：注册完第一屏就要弹给用户看，
// 而那时候他还没填完资料。
func (h *SupportHandler) Get(c *gin.Context) {
	ok(c, gin.H{"wechat": h.cfg.SupportWechat})
}
