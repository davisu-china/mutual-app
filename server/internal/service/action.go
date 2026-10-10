package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/davisu-china/mutual-app/server/internal/config"
	"github.com/davisu-china/mutual-app/server/internal/model"
)

var (
	ErrQuotaExhausted = errors.New("今日喜欢次数已用完")
	ErrCannotActSelf  = errors.New("不能对自己操作")
	ErrTargetInvalid  = errors.New("对方账号不可用")
	ErrBlocked        = errors.New("无法与该用户互动")
	ErrMatchNotFound  = errors.New("配对不存在")
	ErrNotMatchOwner  = errors.New("无权操作该配对")
)

// MatchHook 在配对成功时被调用（事务提交后）。
// 用它把「推送通知 / WebSocket 消息」解耦出去，避免在事务里做 IO。
type MatchHook func(userA, userB int64, matchID int64)

type ActionService struct {
	db      *gorm.DB
	cfg     *config.Config
	onMatch MatchHook
	exp     *ExposureService
}

func NewActionService(db *gorm.DB, cfg *config.Config, onMatch MatchHook, exp *ExposureService) *ActionService {
	return &ActionService{db: db, cfg: cfg, onMatch: onMatch, exp: exp}
}

type ActionResult struct {
	Matched       bool   `json:"matched"`
	MatchID       int64  `json:"matchId,omitempty"`
	QuotaUsed     int16  `json:"quotaUsed"`
	QuotaLimit    int16  `json:"quotaLimit"`
	QuotaRemain   int16  `json:"quotaRemain"`
	AlreadyActed  bool   `json:"alreadyActed"`
}

type ActionInput struct {
	FromUser int64
	ToUser   int64
	Action   string // like / pass / visit
	Source   string // card / plaza / likes_me
}

// Do 执行一次动作。
//
// 只有 like 会消耗额度；pass 与 visit 免费（PRD 8.1 / 10.3）。
// 划卡、广场、回 Like 三种来源**共用同一份额度池**，所以这里不区分 source 来扣减。
func (s *ActionService) Do(ctx context.Context, in ActionInput) (*ActionResult, error) {
	if in.FromUser == in.ToUser {
		return nil, ErrCannotActSelf
	}
	switch in.Action {
	case model.ActionLike:
		return s.doLike(ctx, in)
	case model.ActionPass:
		return s.doSimple(ctx, in, model.ActionPass)
	case model.ActionVisit:
		return s.doVisit(ctx, in)
	}
	return nil, fmt.Errorf("未知动作: %s", in.Action)
}

func (s *ActionService) doLike(ctx context.Context, in ActionInput) (*ActionResult, error) {
	day := s.cfg.Today()
	limit := int16(s.cfg.DailyLikeLimit)

	var res ActionResult
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 目标可用性校验放在事务内，避免「校验通过后被封禁」的窗口
		if err := s.ensureTargetUsable(tx, in.FromUser, in.ToUser); err != nil {
			return err
		}

		// ---- 1. 先写动作，靠唯一索引判重 ----
		//
		// 顺序很重要：**先 INSERT 再扣额度**。
		// 如果先扣额度后发现重复 Like，额度就被白白吃掉了。
		// 反过来，插入成功才扣减，扣减失败就整体回滚——两边都成立。
		act := model.UserAction{
			FromUser: in.FromUser,
			ToUser:   in.ToUser,
			Action:   model.ActionLike,
			Source:   in.Source,
		}
		r := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&act)
		if r.Error != nil {
			return r.Error
		}
		// 判重看主键而不是 RowsAffected —— 后者在冲突时仍返回 1（实测）
		if act.ID == 0 {
			// 之前已经 Like 过：幂等返回，不再扣额度
			res.AlreadyActed = true
			return s.fillMatchState(tx, in.FromUser, in.ToUser, &res, day, limit)
		}

		// ---- 2. 扣额度（条件更新，靠 RowsAffected 判断） ----
		if err := s.ensureQuotaRow(tx, in.FromUser, day, limit); err != nil {
			return err
		}
		upd := tx.Model(&model.DailyQuota{}).
			Where("user_id = ? AND quota_date = ? AND used_like_count < limit_count",
				in.FromUser, day).
			Update("used_like_count", gorm.Expr("used_like_count + 1"))
		if upd.Error != nil {
			return upd.Error
		}
		if upd.RowsAffected == 0 {
			// 额度已满 → 回滚，刚才插入的 action 一并撤销
			return ErrQuotaExhausted
		}

		// ---- 3. 判配对：RowsAffected > 0 才算本次真的配上 ----
		a, b := orderPair(in.FromUser, in.ToUser)

		// 先看对方是否已经 Like 过我
		var reverseCount int64
		if err := tx.Model(&model.UserAction{}).
			Where("from_user = ? AND to_user = ? AND action = ?", in.ToUser, in.FromUser, model.ActionLike).
			Count(&reverseCount).Error; err != nil {
			return err
		}

		if reverseCount > 0 {
			m := model.MatchRecord{UserA: a, UserB: b, Status: model.MatchActive}
			rm := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&m)
			if rm.Error != nil {
				return rm.Error
			}
			// 同样是看主键：m.ID 有值才代表本次真的插入了配对记录
			if m.ID > 0 {
				res.Matched = true
				res.MatchID = m.ID

				conv := model.Conversation{
					MatchID: m.ID, UserA: a, UserB: b, Status: model.ConvActive,
				}
				if err := tx.Create(&conv).Error; err != nil {
					return err
				}
			} else {
				// 已存在配对记录（比如之前配过又解除），沿用原记录
				var exist model.MatchRecord
				if err := tx.Where("user_a = ? AND user_b = ?", a, b).First(&exist).Error; err == nil {
					res.MatchID = exist.ID
				}
			}
		}

		return s.fillQuota(tx, in.FromUser, day, limit, &res)
	})
	if err != nil {
		return nil, err
	}

	// 事务提交后再触发外部动作（推送、WS 广播、统计）。
	// 放在提交后是刻意的：统计失败不该回滚一笔已经成立的 Like。
	if !res.AlreadyActed {
		s.exp.Bump(in.ToUser, "like")
	}
	if res.Matched && res.MatchID > 0 && s.onMatch != nil {
		s.onMatch(in.FromUser, in.ToUser, res.MatchID)
	}
	return &res, nil
}

func (s *ActionService) doSimple(ctx context.Context, in ActionInput, action string) (*ActionResult, error) {
	day := s.cfg.Today()
	limit := int16(s.cfg.DailyLikeLimit)

	var res ActionResult
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.ensureTargetUsable(tx, in.FromUser, in.ToUser); err != nil {
			return err
		}
		// Pass 与 Like 互斥：如果之前 Like 过，Pass 不应覆盖（避免「先喜欢再拉黑」的误导）
		var likeCount int64
		tx.Model(&model.UserAction{}).
			Where("from_user = ? AND to_user = ? AND action = ?", in.FromUser, in.ToUser, model.ActionLike).
			Count(&likeCount)
		if likeCount > 0 {
			res.AlreadyActed = true
			return s.fillMatchState(tx, in.FromUser, in.ToUser, &res, day, limit)
		}

		act := model.UserAction{
			FromUser: in.FromUser, ToUser: in.ToUser,
			Action: action, Source: in.Source,
		}
		r := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&act)
		if r.Error != nil {
			return r.Error
		}
		// 同样看主键：act.ID == 0 表示冲突未插入（RowsAffected 在这不可信）
		res.AlreadyActed = act.ID == 0
		return s.fillQuota(tx, in.FromUser, day, limit, &res)
	})
	if err != nil {
		return nil, err
	}
	return &res, nil
}

func (s *ActionService) doVisit(ctx context.Context, in ActionInput) (*ActionResult, error) {
	// Visit 不消耗额度，用 upsert 只更新时间戳
	err := s.db.WithContext(ctx).Exec(`
		INSERT INTO user_actions (from_user, to_user, action, source, created_at, updated_at)
		VALUES (?, ?, 'visit', ?, now(), now())
		ON CONFLICT (from_user, to_user, action)
		DO UPDATE SET updated_at = now(), source = EXCLUDED.source
	`, in.FromUser, in.ToUser, in.Source).Error
	if err != nil {
		return nil, err
	}
	s.exp.Bump(in.ToUser, "visit")

	var res ActionResult
	if err := s.fillQuota(s.db.WithContext(ctx), in.FromUser, s.cfg.Today(),
		int16(s.cfg.DailyLikeLimit), &res); err != nil {
		return nil, err
	}
	return &res, nil
}

// ---------- 额度 ----------

// ensureQuotaRow 保证当日额度行存在。
// INSERT ... ON CONFLICT DO NOTHING 是并发安全的，不用先查后插。
func (s *ActionService) ensureQuotaRow(tx *gorm.DB, uid int64, day string, limit int16) error {
	return tx.Exec(`
		INSERT INTO daily_quotas (user_id, quota_date, used_like_count, limit_count, updated_at)
		VALUES (?, ?, 0, ?, now())
		ON CONFLICT (user_id, quota_date) DO NOTHING
	`, uid, day, limit).Error
}

func (s *ActionService) fillQuota(tx *gorm.DB, uid int64, day string, limit int16, res *ActionResult) error {
	var q model.DailyQuota
	if err := tx.Where("user_id = ? AND quota_date = ?", uid, day).First(&q).Error; err != nil {
		// 还没建行表示今天一次都没用过
		res.QuotaUsed = 0
		res.QuotaLimit = limit
		res.QuotaRemain = limit
		return nil
	}
	res.QuotaUsed = q.UsedLikeCount
	res.QuotaLimit = q.LimitCount
	res.QuotaRemain = q.LimitCount - q.UsedLikeCount
	if res.QuotaRemain < 0 {
		res.QuotaRemain = 0
	}
	return nil
}

func (s *ActionService) fillMatchState(tx *gorm.DB, from, to int64, res *ActionResult, day string, limit int16) error {
	a, b := orderPair(from, to)
	var m model.MatchRecord
	if err := tx.Where("user_a = ? AND user_b = ?", a, b).First(&m).Error; err == nil {
		if m.Status == model.MatchActive {
			res.Matched = true
		}
		res.MatchID = m.ID
	}
	return s.fillQuota(tx, from, day, limit, res)
}

// Quota 查询今日额度（用于前端渲染「今日还可喜欢 N 人」）。
func (s *ActionService) Quota(ctx context.Context, uid int64) (*ActionResult, error) {
	var res ActionResult
	err := s.fillQuota(s.db.WithContext(ctx), uid, s.cfg.Today(),
		int16(s.cfg.DailyLikeLimit), &res)
	if err != nil {
		return nil, err
	}
	return &res, nil
}

// ---------- 校验 ----------

func (s *ActionService) ensureTargetUsable(tx *gorm.DB, from, to int64) error {
	var u model.User
	if err := tx.Select("id", "status", "onboarded_at").First(&u, to).Error; err != nil {
		return ErrTargetInvalid
	}
	if u.Status == model.UserBanned || u.Status == model.UserDeleted || u.OnboardedAt == nil {
		return ErrTargetInvalid
	}

	var n int64
	if err := tx.Model(&model.Block{}).
		Where("(user_id = ? AND blocked_user_id = ?) OR (user_id = ? AND blocked_user_id = ?)",
			from, to, to, from).
		Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return ErrBlocked
	}
	return nil
}

// ---------- 解除配对 ----------

func (s *ActionService) Unmatch(ctx context.Context, uid, matchID int64) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var m model.MatchRecord
		if err := tx.First(&m, matchID).Error; err != nil {
			return ErrMatchNotFound
		}
		if m.UserA != uid && m.UserB != uid {
			return ErrNotMatchOwner
		}

		now := time.Now()
		if err := tx.Model(&model.MatchRecord{}).Where("id = ?", matchID).Updates(map[string]any{
			"status":       model.MatchUnmatched,
			"unmatched_at": now,
			"unmatched_by": uid,
		}).Error; err != nil {
			return err
		}

		// 会话转只读，历史消息保留可查（PRD 9.2）
		return tx.Model(&model.Conversation{}).Where("match_id = ?", matchID).
			Update("status", model.ConvReadonly).Error
	})
}

// ---------- 拉黑 / 举报 ----------

func (s *ActionService) Block(ctx context.Context, uid, target int64) error {
	if uid == target {
		return ErrCannotActSelf
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		b := model.Block{UserID: uid, BlockedUserID: target}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&b).Error; err != nil {
			return err
		}
		// 重复拉黑是幂等的，不需要额外处理
		// 拉黑使配对失效、会话冻结
		a, c := orderPair(uid, target)
		if err := tx.Model(&model.MatchRecord{}).
			Where("user_a = ? AND user_b = ?", a, c).
			Update("status", model.MatchBlocked).Error; err != nil {
			return err
		}
		return tx.Model(&model.Conversation{}).
			Where("(user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)", uid, target, target, uid).
			Update("status", model.ConvFrozen).Error
	})
}

func (s *ActionService) Unblock(ctx context.Context, uid, target int64) error {
	return s.db.WithContext(ctx).
		Where("user_id = ? AND blocked_user_id = ?", uid, target).
		Delete(&model.Block{}).Error
}

func (s *ActionService) Report(ctx context.Context, reporter, target int64, targetType, reason string, detail *string) error {
	rep := model.Report{
		ReporterID: reporter,
		TargetUser: target,
		TargetType: targetType,
		Reason:     reason,
		Detail:     detail,
		Status:     "pending",
	}
	return s.db.WithContext(ctx).Create(&rep).Error
}
