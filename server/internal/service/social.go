package service

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/davisu-china/mutual-app/server/internal/model"
)

type SocialService struct {
	db *gorm.DB
}

func NewSocialService(db *gorm.DB) *SocialService {
	return &SocialService{db: db}
}

// Interactor 是「谁喜欢我 / 谁看过我」列表里的一行。
type Interactor struct {
	UserID       int64     `json:"userId"`
	Nickname     string    `json:"nickname"`
	Age          int       `json:"age"`
	Gender       int16     `json:"gender"`
	HeightCm     int16     `json:"heightCm"`
	CityCity     string    `json:"city"`
	Occupation   string    `json:"occupation"`
	AvatarURL    string    `json:"avatarUrl"`
	Completeness int16     `json:"completeness"`
	ActedAt      time.Time `json:"actedAt"`
	// 只有「谁喜欢我」才有：对方喜欢我的时间
	LikedAt *time.Time `json:"likedAt,omitempty"`
	// 已经配对的话带上 matchId，前端可直接跳会话
	MatchID *int64 `json:"matchId,omitempty"`
}

// LikesMe 返回喜欢过我、且我尚未回应的人（PRD 11.2）。
//
// 排除条件：我已经 Like 过（那就已成配对，走会话）、我已经 Pass 过（不再打扰）。
func (s *SocialService) LikesMe(ctx context.Context, uid int64, limit int) ([]Interactor, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	rows, err := s.db.WithContext(ctx).Raw(`
		SELECT u.id, u.nickname, u.gender,
		       EXTRACT(YEAR FROM age(u.birthday))::int,
		       p.height_cm, p.city_city, p.occupation, p.completeness,
		       COALESCE(av.url, '') AS avatar_url,
		       a.created_at AS acted_at
		FROM user_actions a
		JOIN users u ON u.id = a.from_user
		JOIN user_profiles p ON p.user_id = u.id
		-- 头像＝相册里第一张已过审的照片（用户 2026-10-09 定的口径：只维护一份照片）。
		-- 用 LATERAL 而不是关联子查询，让「取第一张」只算一次；别名仍叫 av，
		-- 所以上面 SELECT 里的 COALESCE(av.url,'') 和后面的扫描代码都不用动。
		LEFT JOIN LATERAL (
		    SELECT ph.url FROM user_photos ph
		     WHERE ph.user_id = u.id AND ph.audit_status = 'approved'
		     ORDER BY ph.sort_order ASC LIMIT 1
		) av ON true
		WHERE a.to_user = ?
		  AND a.action = 'like'
		  AND u.status = 'active'
		  AND u.onboarded_at IS NOT NULL
		  AND NOT EXISTS (
		      SELECT 1 FROM user_actions x
		      WHERE x.from_user = ? AND x.to_user = u.id AND x.action IN ('like','pass')
		  )
		  AND NOT EXISTS (
		      SELECT 1 FROM blocks b
		      WHERE (b.user_id = ? AND b.blocked_user_id = u.id)
		         OR (b.user_id = u.id AND b.blocked_user_id = ?)
		  )
		ORDER BY a.created_at DESC
		LIMIT ?
	`, uid, uid, uid, uid, limit).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Interactor, 0)
	for rows.Next() {
		var it Interactor
		if err := rows.Scan(
			&it.UserID, &it.Nickname, &it.Gender, &it.Age,
			&it.HeightCm, &it.CityCity, &it.Occupation, &it.Completeness,
			&it.AvatarURL, &it.ActedAt,
		); err != nil {
			return nil, err
		}
		t := it.ActedAt
		it.LikedAt = &t
		out = append(out, it)
	}
	return out, rows.Err()
}

// VisitsMe 返回看过我主页的人。
//
// Visit 不通知对方（PRD 11.2），所以这里只做静默呈现。
func (s *SocialService) VisitsMe(ctx context.Context, uid int64, limit int) ([]Interactor, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	rows, err := s.db.WithContext(ctx).Raw(`
		SELECT u.id, u.nickname, u.gender,
		       EXTRACT(YEAR FROM age(u.birthday))::int,
		       p.height_cm, p.city_city, p.occupation, p.completeness,
		       COALESCE(av.url, '') AS avatar_url,
		       a.updated_at AS acted_at
		FROM user_actions a
		JOIN users u ON u.id = a.from_user
		JOIN user_profiles p ON p.user_id = u.id
		-- 头像＝相册里第一张已过审的照片（用户 2026-10-09 定的口径：只维护一份照片）。
		-- 用 LATERAL 而不是关联子查询，让「取第一张」只算一次；别名仍叫 av，
		-- 所以上面 SELECT 里的 COALESCE(av.url,'') 和后面的扫描代码都不用动。
		LEFT JOIN LATERAL (
		    SELECT ph.url FROM user_photos ph
		     WHERE ph.user_id = u.id AND ph.audit_status = 'approved'
		     ORDER BY ph.sort_order ASC LIMIT 1
		) av ON true
		WHERE a.to_user = ?
		  AND a.action = 'visit'
		  AND u.status = 'active'
		  AND u.onboarded_at IS NOT NULL
		  AND NOT EXISTS (
		      SELECT 1 FROM user_actions x
		      WHERE x.from_user = ? AND x.to_user = u.id AND x.action IN ('like','pass')
		  )
		  AND NOT EXISTS (
		      SELECT 1 FROM blocks b
		      WHERE (b.user_id = ? AND b.blocked_user_id = u.id)
		         OR (b.user_id = u.id AND b.blocked_user_id = ?)
		  )
		ORDER BY a.updated_at DESC
		LIMIT ?
	`, uid, uid, uid, uid, limit).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Interactor, 0)
	for rows.Next() {
		var it Interactor
		if err := rows.Scan(
			&it.UserID, &it.Nickname, &it.Gender, &it.Age,
			&it.HeightCm, &it.CityCity, &it.Occupation, &it.Completeness,
			&it.AvatarURL, &it.ActedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// Counts 返回待处理的数量，用于底部 Tab 的红点。
func (s *SocialService) Counts(ctx context.Context, uid int64) (likes, visits, unread int64, err error) {
	err = s.db.WithContext(ctx).Raw(`
		SELECT
		  (SELECT COUNT(*) FROM user_actions a
		     JOIN users u ON u.id = a.from_user
		    WHERE a.to_user = ? AND a.action = 'like'
		      AND u.status = 'active'
		      AND NOT EXISTS (SELECT 1 FROM user_actions x
		                      WHERE x.from_user = ? AND x.to_user = a.from_user
		                        AND x.action IN ('like','pass'))) AS likes,
		  (SELECT COUNT(*) FROM user_actions a
		     JOIN users u ON u.id = a.from_user
		    WHERE a.to_user = ? AND a.action = 'visit'
		      AND u.status = 'active'
		      AND NOT EXISTS (SELECT 1 FROM user_actions x
		                      WHERE x.from_user = ? AND x.to_user = a.from_user
		                        AND x.action IN ('like','pass'))) AS visits,
		  (SELECT COALESCE(SUM(CASE WHEN user_a = ? THEN unread_a ELSE unread_b END), 0)
		     FROM conversations
		    WHERE (user_a = ? OR user_b = ?) AND status <> 'frozen') AS unread
	`, uid, uid, uid, uid, uid, uid, uid).Row().Scan(&likes, &visits, &unread)
	return
}

// MatchList 返回我的配对列表（用于会话页与个人页）。
func (s *SocialService) MatchList(ctx context.Context, uid int64, limit int) ([]Interactor, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}

	rows, err := s.db.WithContext(ctx).Raw(`
		SELECT u.id, u.nickname, u.gender,
		       EXTRACT(YEAR FROM age(u.birthday))::int,
		       p.height_cm, p.city_city, p.occupation, p.completeness,
		       COALESCE(av.url, '') AS avatar_url,
		       m.matched_at AS acted_at,
		       m.id AS match_id
		FROM match_records m
		JOIN users u ON u.id = CASE WHEN m.user_a = ? THEN m.user_b ELSE m.user_a END
		JOIN user_profiles p ON p.user_id = u.id
		-- 头像＝相册里第一张已过审的照片（用户 2026-10-09 定的口径：只维护一份照片）。
		-- 用 LATERAL 而不是关联子查询，让「取第一张」只算一次；别名仍叫 av，
		-- 所以上面 SELECT 里的 COALESCE(av.url,'') 和后面的扫描代码都不用动。
		LEFT JOIN LATERAL (
		    SELECT ph.url FROM user_photos ph
		     WHERE ph.user_id = u.id AND ph.audit_status = 'approved'
		     ORDER BY ph.sort_order ASC LIMIT 1
		) av ON true
		WHERE (m.user_a = ? OR m.user_b = ?)
		  AND m.status = ?
		ORDER BY m.matched_at DESC
		LIMIT ?
	`, uid, uid, uid, model.MatchActive, limit).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Interactor, 0)
	for rows.Next() {
		var it Interactor
		var matchID int64
		if err := rows.Scan(
			&it.UserID, &it.Nickname, &it.Gender, &it.Age,
			&it.HeightCm, &it.CityCity, &it.Occupation, &it.Completeness,
			&it.AvatarURL, &it.ActedAt, &matchID,
		); err != nil {
			return nil, err
		}
		it.MatchID = &matchID
		out = append(out, it)
	}
	return out, rows.Err()
}
