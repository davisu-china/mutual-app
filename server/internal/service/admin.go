package service

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"gorm.io/gorm"
)

// 后台管理的数据层。
//
// 只读——后台不做任何写操作（除了 is_admin 位由运维直接改库），
// 所以这里没有任何事务，全是查询。
//
// ⚠️ 这里的查询**没有为百万级用户做优化**：用户列表每行都带几个标量子查询
// （照片数、发出/收到的喜欢数、配对数），全表 ORDER BY created_at。当前量级
// （几十到几万）完全没问题；真要长大，第一步是把这些计数改成物化列。
// 写在注释里是为了别让人以为"已经优化过了"。
type AdminService struct{ db *gorm.DB }

func NewAdminService(db *gorm.DB) *AdminService { return &AdminService{db: db} }

/* ------------------------------------------------------------------ 概览 */

type AdminUserStats struct {
	Total       int64 `json:"total"`
	Onboarded   int64 `json:"onboarded"`
	Active      int64 `json:"active"`
	NewToday    int64 `json:"newToday"`
	New7d       int64 `json:"new7d"`
	LoginToday  int64 `json:"loginToday"`
	Male        int64 `json:"male"`
	Female      int64 `json:"female"`
	GenderUnset int64 `json:"genderUnset"`
}

type AdminActionStats struct {
	Like  int64 `json:"like"`
	Pass  int64 `json:"pass"`
	Visit int64 `json:"visit"`
	// 今日新增
	LikeToday  int64 `json:"likeToday"`
	PassToday  int64 `json:"passToday"`
	VisitToday int64 `json:"visitToday"`
}

type AdminMatchStats struct {
	Total  int64 `json:"total"`
	Active int64 `json:"active"`
	Today  int64 `json:"today"`
}

type AdminMessageStats struct {
	Total         int64 `json:"total"`
	Today         int64 `json:"today"`
	Conversations int64 `json:"conversations"`
	// 至少有一条消息的会话数——「配对了但没人开口」是这类产品最主要的流失点，
	// 所以它单独给一个数，而不是藏在平均值里
	ChattedConversations int64 `json:"chattedConversations"`
}

// AdminEngagement 是几个"率"。分母为 0 时一律返回 0，不返回 NaN。
type AdminEngagement struct {
	// 划卡时右滑的比例
	LikeRate float64 `json:"likeRate"`
	// **回喜率**：我发出的 like 里，对方也 like 过我的比例。
	// 这是匹配质量最直接的指标——注意分母是"发出的 like 数"而不是"配对数"。
	MutualLikeRate float64 `json:"mutualLikeRate"`
	// 会话开口率：有消息的会话 / 全部会话
	ReplyRate float64 `json:"replyRate"`
	// 平均每个会话多少条消息
	AvgMessages float64 `json:"avgMessages"`
	// 曝光转化：累计被喜欢数 / 累计曝光数
	ExposureToLike float64 `json:"exposureToLike"`
}

type AdminDailyPoint struct {
	Date      string `json:"date"`
	Registers int64  `json:"registers"`
	Likes     int64  `json:"likes"`
	Passes    int64  `json:"passes"`
	Matches   int64  `json:"matches"`
	Messages  int64  `json:"messages"`
}

type AdminStats struct {
	Users      AdminUserStats    `json:"users"`
	Actions    AdminActionStats  `json:"actions"`
	Matches    AdminMatchStats   `json:"matches"`
	Messages   AdminMessageStats `json:"messages"`
	Engagement AdminEngagement   `json:"engagement"`
	Daily      []AdminDailyPoint `json:"daily"`
}

// Stats 汇总首页用的全部数字。
//
// 时间口径统一用 `CURRENT_DATE`（数据库时区是 Asia/Shanghai，见 schema.sql 的注释），
// 和 daily_quotas 的 quota_date 是同一套，不然"今天"会在两处对不上。
func (s *AdminService) Stats(ctx context.Context) (*AdminStats, error) {
	out := &AdminStats{}
	db := s.db.WithContext(ctx)

	if err := db.Raw(`
		SELECT count(*),
		       count(*) FILTER (WHERE onboarded_at IS NOT NULL),
		       count(*) FILTER (WHERE status = 'active'),
		       count(*) FILTER (WHERE created_at::date = CURRENT_DATE),
		       count(*) FILTER (WHERE created_at > now() - interval '7 days'),
		       count(*) FILTER (WHERE last_login_at::date = CURRENT_DATE),
		       count(*) FILTER (WHERE gender = 1),
		       count(*) FILTER (WHERE gender = 2),
		       count(*) FILTER (WHERE gender IS NULL)
		  FROM users WHERE status <> 'deleted'
	`).Row().Scan(
		&out.Users.Total, &out.Users.Onboarded, &out.Users.Active,
		&out.Users.NewToday, &out.Users.New7d, &out.Users.LoginToday,
		&out.Users.Male, &out.Users.Female, &out.Users.GenderUnset,
	); err != nil {
		return nil, err
	}

	if err := db.Raw(`
		SELECT
		  count(*) FILTER (WHERE action = 'like'),
		  count(*) FILTER (WHERE action = 'pass'),
		  count(*) FILTER (WHERE action = 'visit'),
		  count(*) FILTER (WHERE action = 'like'  AND created_at::date = CURRENT_DATE),
		  count(*) FILTER (WHERE action = 'pass'  AND created_at::date = CURRENT_DATE),
		  count(*) FILTER (WHERE action = 'visit' AND created_at::date = CURRENT_DATE)
		  FROM user_actions
	`).Row().Scan(
		&out.Actions.Like, &out.Actions.Pass, &out.Actions.Visit,
		&out.Actions.LikeToday, &out.Actions.PassToday, &out.Actions.VisitToday,
	); err != nil {
		return nil, err
	}

	if err := db.Raw(`
		SELECT count(*),
		       count(*) FILTER (WHERE status = 'active'),
		       count(*) FILTER (WHERE matched_at::date = CURRENT_DATE)
		  FROM match_records
	`).Row().Scan(&out.Matches.Total, &out.Matches.Active, &out.Matches.Today); err != nil {
		return nil, err
	}

	if err := db.Raw(`
		SELECT (SELECT count(*) FROM messages),
		       (SELECT count(*) FROM messages WHERE created_at::date = CURRENT_DATE),
		       (SELECT count(*) FROM conversations),
		       (SELECT count(*) FROM conversations c
		         WHERE EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id))
	`).Row().Scan(
		&out.Messages.Total, &out.Messages.Today,
		&out.Messages.Conversations, &out.Messages.ChattedConversations,
	); err != nil {
		return nil, err
	}

	// 率：分母为 0 时保持 0（不要 NaN——JSON 序列化出去前端会显示成 null）
	var mutualLikes int64
	if err := db.Raw(`
		SELECT count(*) FROM user_actions a
		 WHERE a.action = 'like'
		   AND EXISTS (SELECT 1 FROM user_actions b
		                WHERE b.from_user = a.to_user AND b.to_user = a.from_user AND b.action = 'like')
	`).Row().Scan(&mutualLikes); err != nil {
		return nil, err
	}
	if denom := out.Actions.Like + out.Actions.Pass; denom > 0 {
		out.Engagement.LikeRate = round4(float64(out.Actions.Like) / float64(denom))
	}
	if out.Actions.Like > 0 {
		out.Engagement.MutualLikeRate = round4(float64(mutualLikes) / float64(out.Actions.Like))
	}
	if out.Messages.Conversations > 0 {
		out.Engagement.ReplyRate = round4(float64(out.Messages.ChattedConversations) / float64(out.Messages.Conversations))
		out.Engagement.AvgMessages = round4(float64(out.Messages.Total) / float64(out.Messages.Conversations))
	}

	var exposed, liked int64
	if err := db.Raw(`SELECT COALESCE(SUM(exposed_count),0), COALESCE(SUM(liked_count),0) FROM exposure_stats`).
		Row().Scan(&exposed, &liked); err != nil {
		return nil, err
	}
	if exposed > 0 {
		out.Engagement.ExposureToLike = round4(float64(liked) / float64(exposed))
	}

	// 近 14 天逐日。用 generate_series 补齐没有数据的那几天——
	// 否则折线图会把"零"画成"跳过"，看着像那天不存在。
	rows, err := db.Raw(`
		WITH days AS (
		  SELECT generate_series(CURRENT_DATE - interval '13 days', CURRENT_DATE, interval '1 day')::date AS d
		)
		SELECT to_char(d, 'YYYY-MM-DD'),
		       (SELECT count(*) FROM users u WHERE u.created_at::date = d AND u.status <> 'deleted'),
		       (SELECT count(*) FROM user_actions a WHERE a.created_at::date = d AND a.action = 'like'),
		       (SELECT count(*) FROM user_actions a WHERE a.created_at::date = d AND a.action = 'pass'),
		       (SELECT count(*) FROM match_records m WHERE m.matched_at::date = d),
		       (SELECT count(*) FROM messages msg WHERE msg.created_at::date = d)
		  FROM days ORDER BY d
	`).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var p AdminDailyPoint
		if err := rows.Scan(&p.Date, &p.Registers, &p.Likes, &p.Passes, &p.Matches, &p.Messages); err != nil {
			return nil, err
		}
		out.Daily = append(out.Daily, p)
	}
	return out, rows.Err()
}

func round4(f float64) float64 {
	return float64(int64(f*10000+0.5)) / 10000
}

/* ------------------------------------------------------------------ 用户 */

type AdminUserFilter struct {
	Keyword  string
	Gender   int16 // 0 = 不限
	Status   string
	OnlyDone bool // 只看走完 onboarding 的
	Page     int
	PageSize int
}

type AdminUserRow struct {
	ID           int64   `json:"id"`
	Phone        string  `json:"phone"`
	Nickname     string  `json:"nickname"`
	Gender       *int16  `json:"gender"`
	Age          int     `json:"age"`
	City         string  `json:"city"`
	CityProv     string  `json:"cityProvince"`
	Completeness int16   `json:"completeness"`
	Status       string  `json:"status"`
	Onboarded    bool    `json:"onboarded"`
	IsAdmin      bool    `json:"isAdmin"`
	CreatedAt    string  `json:"createdAt"`
	LastLoginAt  *string `json:"lastLoginAt"`
	Photos       int64   `json:"photos"`
	LikesSent    int64   `json:"likesSent"`
	PassesSent   int64   `json:"passesSent"`
	LikesGot     int64   `json:"likesReceived"`
	VisitsGot    int64   `json:"visitsReceived"`
	Matches      int64   `json:"matches"`
	Messages     int64   `json:"messages"`
}

// Users 用户列表（分页 + 关键词/性别/状态筛选）。
// 条件动态拼 WHERE——这正是 fetchCandidates 里说过的「条件多时 GORM 链式 API
// 拼出来难读也难 EXPLAIN」，所以统一走原始 SQL。
func (s *AdminService) Users(ctx context.Context, f AdminUserFilter) ([]AdminUserRow, int64, error) {
	page, size := normPage(f.Page, f.PageSize)

	var where strings.Builder
	args := []any{}
	where.WriteString(" WHERE u.status <> 'deleted'")
	if kw := strings.TrimSpace(f.Keyword); kw != "" {
		where.WriteString(" AND (u.nickname ILIKE ? OR u.phone LIKE ?)")
		args = append(args, "%"+kw+"%", "%"+kw+"%")
	}
	if f.Gender != 0 {
		where.WriteString(" AND u.gender = ?")
		args = append(args, f.Gender)
	}
	if f.Status != "" {
		where.WriteString(" AND u.status = ?")
		args = append(args, f.Status)
	}
	if f.OnlyDone {
		where.WriteString(" AND u.onboarded_at IS NOT NULL")
	}

	var total int64
	if err := s.db.WithContext(ctx).Raw(
		"SELECT count(*) FROM users u"+where.String(), args...).Row().Scan(&total); err != nil {
		return nil, 0, err
	}

	q := `
		SELECT u.id, u.phone, u.nickname, u.gender,
		       EXTRACT(YEAR FROM age(u.birthday))::int,
		       COALESCE(p.city_prov, ''), COALESCE(p.city_city, ''), COALESCE(p.completeness, 0),
		       u.status, u.onboarded_at IS NOT NULL, u.is_admin,
		       to_char(u.created_at, 'YYYY-MM-DD HH24:MI'),
		       to_char(u.last_login_at, 'YYYY-MM-DD HH24:MI'),
		       (SELECT count(*) FROM user_photos ph WHERE ph.user_id = u.id),
		       (SELECT count(*) FROM user_actions a WHERE a.from_user = u.id AND a.action = 'like'),
		       (SELECT count(*) FROM user_actions a WHERE a.from_user = u.id AND a.action = 'pass'),
		       (SELECT count(*) FROM user_actions a WHERE a.to_user = u.id AND a.action = 'like'),
		       (SELECT count(*) FROM user_actions a WHERE a.to_user = u.id AND a.action = 'visit'),
		       (SELECT count(*) FROM match_records m WHERE m.user_a = u.id OR m.user_b = u.id),
		       (SELECT count(*) FROM messages msg WHERE msg.from_user = u.id)
		  FROM users u
		  LEFT JOIN user_profiles p ON p.user_id = u.id` +
		where.String() +
		" ORDER BY u.created_at DESC, u.id DESC LIMIT ? OFFSET ?"
	args = append(args, size, (page-1)*size)

	rows, err := s.db.WithContext(ctx).Raw(q, args...).Rows()
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := []AdminUserRow{}
	for rows.Next() {
		var r AdminUserRow
		if err := rows.Scan(
			&r.ID, &r.Phone, &r.Nickname, &r.Gender, &r.Age,
			&r.CityProv, &r.City, &r.Completeness,
			&r.Status, &r.Onboarded, &r.IsAdmin,
			&r.CreatedAt, &r.LastLoginAt,
			&r.Photos, &r.LikesSent, &r.PassesSent, &r.LikesGot, &r.VisitsGot, &r.Matches, &r.Messages,
		); err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, rows.Err()
}

type AdminUserHeader struct {
	ID          int64   `json:"id"`
	Phone       string  `json:"phone"`
	Nickname    string  `json:"nickname"`
	Gender      *int16  `json:"gender"`
	Age         int     `json:"age"`
	Status      string  `json:"status"`
	Onboarded   bool    `json:"onboarded"`
	IsAdmin     bool    `json:"isAdmin"`
	DeviceID    *string `json:"deviceId"`
	RegisterIP  *string `json:"registerIp"`
	CreatedAt   string  `json:"createdAt"`
	LastLoginAt *string `json:"lastLoginAt"`
}

type AdminUserProfile struct {
	HeightCm          int16   `json:"heightCm"`
	WeightKg          *int16  `json:"weightKg"`
	HometownProv      string  `json:"hometownProvince"`
	HometownCity      string  `json:"hometownCity"`
	CityProv          string  `json:"cityProvince"`
	CityCity          string  `json:"city"`
	CityDistrict      *string `json:"cityDistrict"`
	Occupation        string  `json:"occupation"`
	MBTI              *string `json:"mbti"`
	Smoking           int16   `json:"smoking"`
	Drinking          int16   `json:"drinking"`
	IncomeRange       *int16  `json:"incomeRange"`
	Education         int16   `json:"education"`
	School            *string `json:"school"`
	Company           *string `json:"company"`
	IsOnlyChild       bool    `json:"isOnlyChild"`
	EldercarePressure *int16  `json:"eldercarePressure"`
	HasCar            bool    `json:"hasCar"`
	HasHouse          int16   `json:"hasHouse"`
	IsDink            int16   `json:"isDink"`
	Completeness      int16   `json:"completeness"`
	GeoHash           *string `json:"geoHash"`
}

type AdminTexts struct {
	AboutMe       *string `json:"aboutMe"`
	ExpectPartner *string `json:"expectPartner"`
}

type AdminHobby struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	SortOrder   int16  `json:"sortOrder"`
}

type AdminPhoto struct {
	ID          int64  `json:"id"`
	URL         string `json:"url"`
	SortOrder   int16  `json:"sortOrder"`
	AuditStatus string `json:"auditStatus"`
	Visibility  string `json:"visibility"`
}

type AdminCounts struct {
	LikesSent    int64 `json:"likesSent"`
	PassesSent   int64 `json:"passesSent"`
	VisitsSent   int64 `json:"visitsSent"`
	LikesGot     int64 `json:"likesReceived"`
	PassesGot    int64 `json:"passesReceived"`
	VisitsGot    int64 `json:"visitsReceived"`
	Matches      int64 `json:"matches"`
	ActiveMatch  int64 `json:"activeMatches"`
	MessagesSent int64 `json:"messagesSent"`
	MessagesGot  int64 `json:"messagesReceived"`
	Blocks       int64 `json:"blocks"`
	ReportedBy   int64 `json:"reportedByOthers"`
	ReportsMade  int64 `json:"reportsMade"`
}

type AdminUserDetail struct {
	User     AdminUserHeader   `json:"user"`
	Profile  *AdminUserProfile `json:"profile"`
	Texts    *AdminTexts       `json:"texts"`
	Hobbies  []AdminHobby      `json:"hobbies"`
	Photos   []AdminPhoto      `json:"photos"`
	Counts   AdminCounts       `json:"counts"`
	Quota    *AdminQuotaToday  `json:"quotaToday"`
	Preference map[string]any  `json:"preference"`
	Avatar   string            `json:"avatarUrl"`
	Sessions int64             `json:"conversations"`
}

type AdminQuotaToday struct {
	Used  int16 `json:"used"`
	Limit int16 `json:"limit"`
}

// Detail 一个人名下能看的东西，一次取全。
//
// 分成很多条小查询而不是一个巨型 JOIN：JOIN 会把一对多的行乘开
// （一个人有 3 个兴趣 × 5 张照片 = 15 行），还得在应用层去重。小查询更直白。
func (s *AdminService) Detail(ctx context.Context, id int64) (*AdminUserDetail, error) {
	db := s.db.WithContext(ctx)
	out := &AdminUserDetail{Hobbies: []AdminHobby{}, Photos: []AdminPhoto{}, Preference: map[string]any{}}

	if err := db.Raw(`
		SELECT u.id, u.phone, u.nickname, u.gender,
		       EXTRACT(YEAR FROM age(u.birthday))::int,
		       u.status, u.onboarded_at IS NOT NULL, u.is_admin,
		       u.device_id, u.register_ip::text,
		       to_char(u.created_at, 'YYYY-MM-DD HH24:MI'),
		       to_char(u.last_login_at, 'YYYY-MM-DD HH24:MI')
		  FROM users u WHERE u.id = ?
	`, id).Row().Scan(
		&out.User.ID, &out.User.Phone, &out.User.Nickname, &out.User.Gender, &out.User.Age,
		&out.User.Status, &out.User.Onboarded, &out.User.IsAdmin,
		&out.User.DeviceID, &out.User.RegisterIP, &out.User.CreatedAt, &out.User.LastLoginAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrTargetInvalid
		}
		return nil, err
	}

	// 头像＝相册里第一张已过审的照片（全项目统一口径，见 discovery.go 的说明）
	if err := db.Raw(`
		SELECT COALESCE((SELECT ph.url FROM user_photos ph
		                  WHERE ph.user_id = ? AND ph.audit_status = 'approved'
		                  ORDER BY ph.sort_order LIMIT 1), '')
	`, id).Row().Scan(&out.Avatar); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	var p AdminUserProfile
	if err := db.Raw(`
		SELECT height_cm, weight_kg, hometown_prov, hometown_city, city_prov, city_city, city_district,
		       occupation, mbti, smoking, drinking, income_range, education, school, company,
		       is_only_child, eldercare_pressure, has_car, has_house, is_dink, completeness, geo_hash
		  FROM user_profiles WHERE user_id = ?
	`, id).Row().Scan(
		&p.HeightCm, &p.WeightKg, &p.HometownProv, &p.HometownCity, &p.CityProv, &p.CityCity, &p.CityDistrict,
		&p.Occupation, &p.MBTI, &p.Smoking, &p.Drinking, &p.IncomeRange, &p.Education, &p.School, &p.Company,
		&p.IsOnlyChild, &p.EldercarePressure, &p.HasCar, &p.HasHouse, &p.IsDink, &p.Completeness, &p.GeoHash,
	); err == nil {
		out.Profile = &p // 有行才算"有资料"
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err // 别把 SQL 错误当成"这个人没填资料"
	}

	var t AdminTexts
	if err := db.Raw(`SELECT about_me, expect_partner FROM user_texts WHERE user_id = ?`, id).
		Row().Scan(&t.AboutMe, &t.ExpectPartner); err == nil {
		out.Texts = &t
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	rows, err := db.Raw(`SELECT name, description, sort_order FROM user_hobbies WHERE user_id = ? ORDER BY sort_order`, id).Rows()
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var h AdminHobby
		if err := rows.Scan(&h.Name, &h.Description, &h.SortOrder); err != nil {
			rows.Close()
			return nil, err
		}
		out.Hobbies = append(out.Hobbies, h)
	}
	rows.Close()

	prows, err := db.Raw(`SELECT id, url, sort_order, audit_status, visibility FROM user_photos WHERE user_id = ? ORDER BY sort_order`, id).Rows()
	if err != nil {
		return nil, err
	}
	for prows.Next() {
		var ph AdminPhoto
		if err := prows.Scan(&ph.ID, &ph.URL, &ph.SortOrder, &ph.AuditStatus, &ph.Visibility); err != nil {
			prows.Close()
			return nil, err
		}
		out.Photos = append(out.Photos, ph)
	}
	prows.Close()

	// 参数只传一次：用一个只含一行 CTE（me）把 id 带进去。
	// 原来是把 id 重复写 19 遍，结果多写了一个——PG 报的是"输入末尾语法错误"，
	// 从报错完全看不出是参数个数的问题。这种"同一个值重复 N 次"的写法不值得留。
	if err := db.Raw(`
		WITH me AS (SELECT ?::bigint AS id)
		SELECT
		  (SELECT count(*) FROM user_actions a, me WHERE a.from_user = me.id AND a.action = 'like'),
		  (SELECT count(*) FROM user_actions a, me WHERE a.from_user = me.id AND a.action = 'pass'),
		  (SELECT count(*) FROM user_actions a, me WHERE a.from_user = me.id AND a.action = 'visit'),
		  (SELECT count(*) FROM user_actions a, me WHERE a.to_user   = me.id AND a.action = 'like'),
		  (SELECT count(*) FROM user_actions a, me WHERE a.to_user   = me.id AND a.action = 'pass'),
		  (SELECT count(*) FROM user_actions a, me WHERE a.to_user   = me.id AND a.action = 'visit'),
		  (SELECT count(*) FROM match_records m, me WHERE m.user_a = me.id OR m.user_b = me.id),
		  (SELECT count(*) FROM match_records m, me
		    WHERE (m.user_a = me.id OR m.user_b = me.id) AND m.status = 'active'),
		  (SELECT count(*) FROM messages msg, me WHERE msg.from_user = me.id),
		  (SELECT count(*) FROM messages msg, me
		    WHERE msg.conversation_id IN (SELECT c.id FROM conversations c, me WHERE c.user_a = me.id OR c.user_b = me.id)
		      AND msg.from_user <> me.id),
		  (SELECT count(*) FROM blocks b, me WHERE b.user_id = me.id),
		  (SELECT count(*) FROM reports r, me WHERE r.target_user = me.id),
		  (SELECT count(*) FROM reports r, me WHERE r.reporter_id = me.id),
		  (SELECT count(*) FROM conversations c, me WHERE c.user_a = me.id OR c.user_b = me.id)
	`, id).Row().Scan(
		&out.Counts.LikesSent, &out.Counts.PassesSent, &out.Counts.VisitsSent,
		&out.Counts.LikesGot, &out.Counts.PassesGot, &out.Counts.VisitsGot,
		&out.Counts.Matches, &out.Counts.ActiveMatch,
		&out.Counts.MessagesSent, &out.Counts.MessagesGot,
		&out.Counts.Blocks, &out.Counts.ReportedBy, &out.Counts.ReportsMade,
		&out.Sessions,
	); err != nil {
		return nil, err
	}

	var q AdminQuotaToday
	if err := db.Raw(`SELECT used_like_count, limit_count FROM daily_quotas WHERE user_id = ? AND quota_date = CURRENT_DATE`, id).
		Row().Scan(&q.Used, &q.Limit); err == nil {
		out.Quota = &q
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	// 伴侣偏好整行丢给前端展示：字段多、都是标量，没必要逐个建结构体。
	// GORM 的 Scan(&map) 正好干这个（Rows() 扫不进 map）。
	if m, err := s.prefMap(ctx, id); err == nil {
		out.Preference = m
	}
	return out, nil
}

func (s *AdminService) prefMap(ctx context.Context, id int64) (map[string]any, error) {
	var raw map[string]any
	res := s.db.WithContext(ctx).Raw(`SELECT * FROM partner_preferences WHERE user_id = ?`, id).Scan(&raw)
	if res.Error != nil || res.RowsAffected == 0 {
		return map[string]any{}, res.Error
	}
	return raw, nil
}

/* ------------------------------------------------------------ 划卡记录 */

type AdminActionRow struct {
	ID         int64  `json:"id"`
	Action     string `json:"action"`
	Source     string `json:"source"`
	CreatedAt  string `json:"createdAt"`
	PeerID     int64  `json:"peerId"`
	PeerName   string `json:"peerNickname"`
	PeerAvatar string `json:"peerAvatar"`
}

// Actions 某人**发出**的或**收到**的划卡记录。
//
// sent=true 取 from_user=id（我划别人），false 取 to_user=id（别人划我）——
// 这两种正是需求里的"划卡记录"和"被划卡记录"，所以用同一个查询参数化方向，
// 而不是写两个几乎一样的函数。
func (s *AdminService) Actions(ctx context.Context, id int64, sent bool, action string, page, size int) ([]AdminActionRow, int64, error) {
	page, size = normPage(page, size)

	joinCol, filterCol := "a.to_user", "a.from_user"
	if !sent {
		joinCol, filterCol = "a.from_user", "a.to_user"
	}
	cond := " WHERE " + filterCol + " = ?"
	args := []any{id}
	if action != "" {
		cond += " AND a.action = ?"
		args = append(args, action)
	}

	var total int64
	if err := s.db.WithContext(ctx).Raw("SELECT count(*) FROM user_actions a"+cond, args...).Row().Scan(&total); err != nil {
		return nil, 0, err
	}

	q := `
		SELECT a.id, a.action, a.source, to_char(a.created_at, 'YYYY-MM-DD HH24:MI'),
		       peer.id, peer.nickname, COALESCE(av.url, '')
		  FROM user_actions a
		  JOIN users peer ON peer.id = ` + joinCol + `
		  LEFT JOIN LATERAL (
		      SELECT url FROM user_photos ph
		       WHERE ph.user_id = peer.id AND ph.audit_status = 'approved'
		       ORDER BY ph.sort_order LIMIT 1
		  ) av ON true` + cond +
		" ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?"
	args = append(args, size, (page-1)*size)

	rows, err := s.db.WithContext(ctx).Raw(q, args...).Rows()
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []AdminActionRow{}
	for rows.Next() {
		var r AdminActionRow
		if err := rows.Scan(&r.ID, &r.Action, &r.Source, &r.CreatedAt, &r.PeerID, &r.PeerName, &r.PeerAvatar); err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, rows.Err()
}

/* -------------------------------------------------------------- 会话 */

type AdminConvPeer struct {
	ID       int64  `json:"id"`
	Nickname string `json:"nickname"`
	Avatar   string `json:"avatarUrl"`
}

type AdminConvRow struct {
	ID            int64         `json:"id"`
	Status        string        `json:"status"`
	A             AdminConvPeer `json:"userA"`
	B             AdminConvPeer `json:"userB"`
	MessageCount  int64         `json:"messageCount"`
	LastMessage   string        `json:"lastMessage"`
	LastMessageAt *string       `json:"lastMessageAt"`
	CreatedAt     string        `json:"createdAt"`
}

type AdminConvDetail struct {
	ID       int64           `json:"id"`
	Status   string          `json:"status"`
	Users    []AdminConvPeer `json:"users"`
	Messages []AdminMsgRow   `json:"messages"`
	Truncated bool           `json:"truncated"`
}

type AdminMsgRow struct {
	ID        int64  `json:"id"`
	FromUser  int64  `json:"fromUser"`
	MsgType   string `json:"msgType"`
	Content   string `json:"content"`
	Seq       int64  `json:"seq"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
}

// Conversations 全部会话，按最后活跃时间倒序。
//
// userId 非 0 时只看这个人的会话——从用户详情页点进"他的聊天记录"走的就是这条。
func (s *AdminService) Conversations(ctx context.Context, keyword string, userID int64, page, size int) ([]AdminConvRow, int64, error) {
	page, size = normPage(page, size)

	var where strings.Builder
	args := []any{}
	cond := []string{}
	if kw := strings.TrimSpace(keyword); kw != "" {
		cond = append(cond, "(a.nickname ILIKE ? OR b.nickname ILIKE ?)")
		args = append(args, "%"+kw+"%", "%"+kw+"%")
	}
	if userID != 0 {
		cond = append(cond, "(c.user_a = ? OR c.user_b = ?)")
		args = append(args, userID, userID)
	}
	if len(cond) > 0 {
		where.WriteString(" WHERE " + strings.Join(cond, " AND "))
	}

	var total int64
	if err := s.db.WithContext(ctx).Raw(
		`SELECT count(*) FROM conversations c
		   JOIN users a ON a.id = c.user_a JOIN users b ON b.id = c.user_b`+where.String(), args...).
		Row().Scan(&total); err != nil {
		return nil, 0, err
	}

	q := `
		SELECT c.id, c.status,
		       a.id, a.nickname, COALESCE(ava.url, ''),
		       b.id, b.nickname, COALESCE(avb.url, ''),
		       (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id),
		       COALESCE(lm.content, ''),
		       to_char(c.last_message_at, 'YYYY-MM-DD HH24:MI'),
		       to_char(c.created_at, 'YYYY-MM-DD HH24:MI')
		  FROM conversations c
		  JOIN users a ON a.id = c.user_a
		  JOIN users b ON b.id = c.user_b
		  LEFT JOIN messages lm ON lm.id = c.last_message_id
		  LEFT JOIN LATERAL (SELECT url FROM user_photos ph WHERE ph.user_id = a.id AND ph.audit_status='approved' ORDER BY ph.sort_order LIMIT 1) ava ON true
		  LEFT JOIN LATERAL (SELECT url FROM user_photos ph WHERE ph.user_id = b.id AND ph.audit_status='approved' ORDER BY ph.sort_order LIMIT 1) avb ON true` +
		where.String() +
		" ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC LIMIT ? OFFSET ?"
	args = append(args, size, (page-1)*size)

	rows, err := s.db.WithContext(ctx).Raw(q, args...).Rows()
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []AdminConvRow{}
	for rows.Next() {
		var r AdminConvRow
		if err := rows.Scan(
			&r.ID, &r.Status,
			&r.A.ID, &r.A.Nickname, &r.A.Avatar,
			&r.B.ID, &r.B.Nickname, &r.B.Avatar,
			&r.MessageCount, &r.LastMessage, &r.LastMessageAt, &r.CreatedAt,
		); err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, rows.Err()
}

// convMessageCap 单个会话一次最多返回多少条消息。
// 后台看的是"聊了什么"，不是归档导出；真要看超长会话后面再说。
const convMessageCap = 500

// Conversation 一个会话的完整聊天记录。
func (s *AdminService) Conversation(ctx context.Context, id int64) (*AdminConvDetail, error) {
	db := s.db.WithContext(ctx)
	out := &AdminConvDetail{ID: id, Users: []AdminConvPeer{}, Messages: []AdminMsgRow{}}

	if err := db.Raw(`SELECT status FROM conversations WHERE id = ?`, id).Row().Scan(&out.Status); err != nil {
		return nil, err
	}

	urows, err := db.Raw(`
		SELECT u.id, u.nickname, COALESCE(av.url, '')
		  FROM conversations c
		  JOIN users u ON u.id IN (c.user_a, c.user_b)
		  LEFT JOIN LATERAL (
		      SELECT url FROM user_photos ph
		       WHERE ph.user_id = u.id AND ph.audit_status = 'approved'
		       ORDER BY ph.sort_order LIMIT 1
		  ) av ON true
		 WHERE c.id = ?
		 ORDER BY u.id
	`, id).Rows()
	if err != nil {
		return nil, err
	}
	for urows.Next() {
		var p AdminConvPeer
		if err := urows.Scan(&p.ID, &p.Nickname, &p.Avatar); err != nil {
			urows.Close()
			return nil, err
		}
		out.Users = append(out.Users, p)
	}
	urows.Close()

	mrows, err := db.Raw(`
		SELECT id, from_user, msg_type, COALESCE(content, ''), seq, status,
		       to_char(created_at, 'YYYY-MM-DD HH24:MI:SS')
		  FROM messages WHERE conversation_id = ?
		 ORDER BY seq LIMIT ?
	`, id, convMessageCap+1).Rows()
	if err != nil {
		return nil, err
	}
	defer mrows.Close()
	for mrows.Next() {
		var m AdminMsgRow
		if err := mrows.Scan(&m.ID, &m.FromUser, &m.MsgType, &m.Content, &m.Seq, &m.Status, &m.CreatedAt); err != nil {
			return nil, err
		}
		if len(out.Messages) == convMessageCap {
			out.Truncated = true
			break
		}
		out.Messages = append(out.Messages, m)
	}
	return out, mrows.Err()
}

func normPage(page, size int) (int, int) {
	if page < 1 {
		page = 1
	}
	if size <= 0 {
		size = 20
	}
	if size > 100 {
		size = 100
	}
	return page, size
}
