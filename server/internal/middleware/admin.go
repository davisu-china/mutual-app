package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// AdminGuard 只放行 `users.is_admin = true` 的账号。
//
// 为什么用一个库里的布尔位，而不是另建 admin 表或加一个环境变量：
// **不给部署再加一个要人工同步的秘密**。管理员用自己已有的账号登录即可
// （前端在 web/src/admin，走的就是普通的 /auth/login）。
// 代价是"谁有后台"这件事要在库里改——对一个内部工具来说这正好。
//
// 必须挂在 Auth 之后：UserID(c) 是 Auth 写进 context 的。
func AdminGuard(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := UserID(c)
		var isAdmin bool
		err := db.WithContext(c.Request.Context()).
			Raw("SELECT is_admin FROM users WHERE id = ?", uid).Row().Scan(&isAdmin)
		if err != nil || !isAdmin {
			// 用 403 而不是 404：后台入口本来就是公开的，藏起来只会让
			// "普通用户点进来"变成一件莫名其妙的事。这里要防的是越权，不是被发现。
			abort(c, http.StatusForbidden, "NOT_ADMIN", "这个账号没有后台权限")
			return
		}
		c.Next()
	}
}
