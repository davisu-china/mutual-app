package service

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"

	"github.com/davisu-china/mutual-app/server/internal/model"
)

// ErrAccountRestricted 封禁期内尝试被限制的写操作（喜欢别人 / 发消息）。
//
// **不是"整号不可用"**：封禁的口径是限制互动——还能看推荐、看消息、看自己的资料。
// 所以这个哨兵只从具体动作里返回，中间件不再整块拦（见 middleware.OnboardGuard 的说明）。
//
// 用专门的哨兵而不是 invalidInput：客户端要能分辨"这是账号被限制"，
// 而不是"我填的东西不对"——前者要把限制说明顶到界面上（ActionService / ChatService）。
var ErrAccountRestricted = errors.New("账号被限制")

// checkRestricted 判断某个写操作能不能做。
//
// what 是给用户看的动作名（"喜欢别人" / "发消息"），拼出来的话要能直接显示：
// 用户在划卡页点了个喜欢，弹出来的就是这句。
func checkRestricted(ctx context.Context, db *gorm.DB, uid int64, what string) error {
	var u model.User
	if err := db.WithContext(ctx).Select("id", "status").First(&u, uid).Error; err != nil {
		return err
	}
	if u.Status != model.UserBanned {
		return nil
	}
	return fmt.Errorf("%w：暂时不能%s", ErrAccountRestricted, what)
}
