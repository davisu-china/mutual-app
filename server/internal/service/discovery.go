package service

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/davisu-china/mutual-app/server/internal/model"
)

// 候选集上限。
//
// 这是「按匹配分排序走不了索引」那个问题的解法（技术方案 9.2）：
// 先用**可索引的条件**（性别、状态、城市）把候选集压到几百人以内，
// 再在应用层算分排序。否则就是对全表算分。
const (
	candidatePoolSize = 300
	cardBatchSize     = 10
	plazaPageSize     = 20
)

// 曝光均衡参数（PRD 8.4）。
//
// 为什么必须做：完全按匹配分排序的结果是少数高吸引力用户吃掉绝大部分曝光，
// 其余人长期零配对后流失，卡池随之萎缩——马太效应会杀死交友产品的生态。
const (
	// 统计近多少天的曝光
	exposureWindowDays = 7
	// 一周内曝光到这个次数，降权达到上限
	exposureSaturation = 400
	// 曝光降权上限。**刻意压得比 newcomerBoost 小**：
	// 均衡是纠偏，不该盖过匹配度本身——否则会推一堆不合适但「没人看过」的人。
	maxExposurePenalty = 0.18
	// 新用户保护期与加权
	newcomerWindow = 72 * time.Hour
	newcomerBoost  = 0.15
)

type DiscoveryService struct {
	db  *gorm.DB
	svc *ProfileService
	exp *ExposureService
}

func NewDiscoveryService(db *gorm.DB, svc *ProfileService, exp *ExposureService) *DiscoveryService {
	return &DiscoveryService{db: db, svc: svc, exp: exp}
}

// Candidate 是一个候选人的原始数据（画像 + 伴侣偏好），用于算分。
type Candidate struct {
	UserID       int64
	Nickname     string
	Gender       *int16 // 可为空：性别在 Onboarding 才收集
	Age          int
	HeightCm     int16
	Education    int16
	Income       int16
	Smoking      int16
	Drinking     int16
	HasCar       bool
	HasHouse     int16
	IsDink       int16
	OnlyChild    bool
	CityProv     string
	CityCity     string
	GeoHash      *string
	HometownProv string
	Occupation   string
	MBTI         *string
	Completeness int16
	AvatarURL    string
	PhotoURLs    []string
	HobbyNames   []string
	// 自述。卡片下半部分会把它当成一段"引用"展示——比一串标签更能让人做决定
	AboutMe string

	// 近 7 天被曝光次数 + 注册时间，用于推荐公平性调控
	RecentExposure int
	CreatedAt      time.Time

	// 对方的伴侣偏好，用于反向匹配
	PrefHeightMin, PrefHeightMax                int16
	PrefIncomeMin, PrefIncomeMax                int16
	PrefEducationMin                            int16
	PrefSmoking, PrefDrinking                   int16
	PrefOnlyChild, PrefCar, PrefHouse, PrefDink int16
	PrefProvinces                               model.StringArray
	PrefTags                                    model.StringArray
}

type CardView struct {
	UserID       int64    `json:"userId"`
	Nickname     string   `json:"nickname"`
	Age          int      `json:"age"`
	Gender       *int16   `json:"gender"`
	HeightCm     int16    `json:"heightCm"`
	CityCity     string   `json:"city"`
	CityProv     string   `json:"cityProvince"`
	Occupation   string   `json:"occupation"`
	Education    int16    `json:"education"`
	DistanceFrom int      `json:"distanceKm"`
	HasDistance  bool     `json:"hasDistance"`
	AvatarURL    string   `json:"avatarUrl"`
	Photos       []string `json:"photos"`
	Hobbies      []string `json:"hobbies"`
	Completeness int16    `json:"completeness"`

	// 灰显提示：本次推荐里有几个软条件没满足（PRD 7.2 要求让用户知情）
	SoftMismatch []string `json:"softMismatch,omitempty"`
	Score        float64  `json:"-"`

	// 卡片下半部分的三样东西。这一屏最该回答的是"为什么给我看这个人"，
	// 而这三个恰好分别对应：我要求对方的（理由）、我们能聊的（共同兴趣）、
	// 以及她自己说的话（自述）。光摆字段是答不了这个问题的。
	Reasons       []string `json:"reasons,omitempty"`
	SharedHobbies []string `json:"sharedHobbies,omitempty"`
	AboutMe       string   `json:"aboutMe,omitempty"`
}

// Cards 返回划卡候选。
//
// 硬过滤只有四件事：性别、账号状态、已操作过、拉黑关系。
// 其余全是软加权——全当硬条件会让早期用户池直接归零（PRD 7.2）。
func (s *DiscoveryService) Cards(ctx context.Context, uid int64, limit int) ([]CardView, error) {
	if limit <= 0 || limit > cardBatchSize {
		limit = cardBatchSize
	}

	me, err := s.loadSelf(ctx, uid)
	if err != nil {
		return nil, err
	}

	// 异性匹配（PRD 已确认只做异性）。
	// 性别未填的用户进不到这里——OnboardGuard 已经保证五步走完，而性别是必填项。
	if me.Gender == nil {
		return nil, invalidInput("请先选择性别")
	}
	// ⚠️ 这里原本两个分支都写 GenderFemale（if 是空操作），于是**女生会看到女生**：
	// 男用户看女用户是对的，所以只有女性账号才会暴露这个问题。
	targetGender := int16(model.GenderMale)
	if *me.Gender == model.GenderMale {
		targetGender = model.GenderFemale
	}

	// 逐级放宽：先用较严的条件取候选，不够再放宽，**绝不返回「今日无推荐」**
	stages := []struct {
		sameCity bool
		note     string
	}{
		{sameCity: true},
		{sameCity: false},
	}

	for _, st := range stages {
		cands, err := s.fetchCandidates(ctx, uid, targetGender, me, st.sameCity, candidatePoolSize)
		if err != nil {
			return nil, err
		}
		if len(cands) == 0 {
			continue
		}
		cards := s.scoreAndRank(cands, me, targetGender)
		if len(cards) > 0 {
			top := cards[:min(limit, len(cards))]
			// 曝光在返回后才记，且是异步的——不阻塞响应
			ids := make([]int64, 0, len(top))
			for _, c := range top {
				ids = append(ids, c.UserID)
			}
			s.exp.RecordExposures(ids)
			return top, nil
		}
	}
	return []CardView{}, nil
}

// fetchCandidates 用硬过滤取候选集。
//
// 这段是**原始 SQL**，不走 GORM 链式 API——过滤条件多、又需要 EXISTS 子查询，
// 链式 API 拼出来既难读也难 EXPLAIN（技术方案 9.1 第 2 条）。
func (s *DiscoveryService) fetchCandidates(
	ctx context.Context, uid int64, gender int16, me *Candidate, sameCity bool, limit int,
) ([]Candidate, error) {
	var sb strings.Builder
	args := []any{uid, gender}

	sb.WriteString(`
		SELECT u.id, u.nickname, u.gender,
		       EXTRACT(YEAR FROM age(u.birthday))::int,
		       p.height_cm, p.education, p.income_range, p.smoking, p.drinking,
		       p.has_car, p.has_house, p.is_dink, p.is_only_child,
		       p.city_prov, p.city_city, p.geo_hash, p.hometown_prov,
		       p.occupation, p.mbti, p.completeness,
		       COALESCE(av.url, '') AS avatar_url,
		       COALESCE(pref.height_min, 0), COALESCE(pref.height_max, 0),
		       COALESCE(pref.income_min, 0), COALESCE(pref.income_max, 0),
		       COALESCE(pref.education_min, 0),
		       COALESCE(pref.smoking_accept, 0), COALESCE(pref.drinking_accept, 0),
		       COALESCE(pref.only_child_accept, 0), COALESCE(pref.car_prefer, 0),
		       COALESCE(pref.house_prefer, 0), COALESCE(pref.dink_accept, 0),
		       COALESCE(pref.hometown_provinces, '{}'), COALESCE(pref.tags, '{}'),
		       COALESCE((SELECT SUM(es.exposed_count) FROM exposure_stats es
		                 WHERE es.user_id = u.id
		                   AND es.stat_date > CURRENT_DATE - ` + strconv.Itoa(exposureWindowDays) + `), 0) AS recent_exposure,
		       u.created_at,
		       COALESCE(tx.about_me, '')
		FROM users u
		JOIN user_profiles p ON p.user_id = u.id
		-- 头像＝相册里第一张已过审的照片（用户 2026-10-09 定的口径：只维护一份照片）。
		-- 用 LATERAL 而不是关联子查询，让「取第一张」只算一次；别名仍叫 av，
		-- 所以上面 SELECT 里的 COALESCE(av.url,'') 和后面的扫描代码都不用动。
		LEFT JOIN LATERAL (
		    SELECT ph.url FROM user_photos ph
		     WHERE ph.user_id = u.id AND ph.audit_status = 'approved'
		     ORDER BY ph.sort_order ASC LIMIT 1
		) av ON true
		LEFT JOIN partner_preferences pref ON pref.user_id = u.id
		LEFT JOIN user_texts tx ON tx.user_id = u.id
		WHERE u.id <> ?
		  AND u.gender = ?
		  AND u.status = 'active'
		  AND u.onboarded_at IS NOT NULL
		  AND EXISTS (SELECT 1 FROM user_photos ph
		              WHERE ph.user_id = u.id AND ph.audit_status = 'approved')
		  AND NOT EXISTS (SELECT 1 FROM user_actions a
		                  WHERE a.from_user = ? AND a.to_user = u.id)
		  AND NOT EXISTS (SELECT 1 FROM blocks b
		                  WHERE (b.user_id = ? AND b.blocked_user_id = u.id)
		                     OR (b.user_id = u.id AND b.blocked_user_id = ?))
	`)
	args = append(args, uid, uid, uid)

	if sameCity && me.CityCity != "" {
		sb.WriteString(" AND p.city_city = ?")
		args = append(args, me.CityCity)
	} else if me.CityProv != "" {
		sb.WriteString(" AND p.city_prov = ?")
		args = append(args, me.CityProv)
	}

	// 候选集的选取顺序：**先按曝光量从少到多**。
	//
	// 匹配分算不出来（要读对方的偏好表），所以 SQL 这边只能做粗筛。真正合理的
	// 做法是「先用公平性选出候选池，再在池内按匹配度排序」——把这两个目标拆到
	// 两层，各司其职。若反过来（先按匹配度取前 N 人再做公平性），被曝光过量的
	// 头部用户会持续占据候选池，均衡就永远调不动。
	sb.WriteString(`
		ORDER BY recent_exposure ASC, p.completeness DESC, u.id DESC
		LIMIT ?
	`)
	args = append(args, limit)

	rows, err := s.db.WithContext(ctx).Raw(sb.String(), args...).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Candidate
	for rows.Next() {
		var c Candidate
		if err := rows.Scan(
			&c.UserID, &c.Nickname, &c.Gender, &c.Age,
			&c.HeightCm, &c.Education, &c.Income, &c.Smoking, &c.Drinking,
			&c.HasCar, &c.HasHouse, &c.IsDink, &c.OnlyChild,
			&c.CityProv, &c.CityCity, &c.GeoHash, &c.HometownProv,
			&c.Occupation, &c.MBTI, &c.Completeness,
			&c.AvatarURL,
			&c.PrefHeightMin, &c.PrefHeightMax,
			&c.PrefIncomeMin, &c.PrefIncomeMax, &c.PrefEducationMin,
			&c.PrefSmoking, &c.PrefDrinking,
			&c.PrefOnlyChild, &c.PrefCar, &c.PrefHouse, &c.PrefDink,
			&c.PrefProvinces, &c.PrefTags,
			&c.RecentExposure, &c.CreatedAt, &c.AboutMe,
		); err != nil {
			return nil, fmt.Errorf("扫描候选行失败: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// 兴趣单独批量查一次。原来是**根本没有查**——`HobbyNames` 声明了却从没被赋值，
	// 所以卡片上的兴趣标签一直渲染不出来（前端写的是 `(card.hobbies ?? [])`，
	// 空数组静默地什么都不画，所以谁也没发现）。
	if err := s.attachHobbies(ctx, out); err != nil {
		return nil, err
	}
	return out, nil
}

// attachHobbies 给这批候选补上兴趣名。一次查完，别在循环里逐个人查。
func (s *DiscoveryService) attachHobbies(ctx context.Context, cs []Candidate) error {
	if len(cs) == 0 {
		return nil
	}
	ids := make([]any, 0, len(cs))
	byID := make(map[int64]*Candidate, len(cs))
	for i := range cs {
		ids = append(ids, cs[i].UserID)
		byID[cs[i].UserID] = &cs[i]
	}
	rows, err := s.db.WithContext(ctx).Raw(`
		SELECT user_id, name FROM user_hobbies
		 WHERE user_id IN (`+placeholders(len(ids))+`)
		 ORDER BY user_id, sort_order
	`, ids...).Rows()
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var uid int64
		var name string
		if err := rows.Scan(&uid, &name); err != nil {
			return err
		}
		if c := byID[uid]; c != nil {
			c.HobbyNames = append(c.HobbyNames, name)
		}
	}
	return rows.Err()
}

// scoreAndRank 在应用层算分并排序。
//
// 分数构成（PRD 7.3）：
//
//	0.6 × 正向匹配（我的偏好 vs TA 的画像）
//
// + 0.4 × 反向匹配（TA 的偏好 vs 我的画像）
// + 完整度与活跃度微调
func (s *DiscoveryService) scoreAndRank(cands []Candidate, me *Candidate, targetGender int16) []CardView {
	_ = targetGender
	cards := make([]CardView, 0, len(cands))

	for i := range cands {
		c := &cands[i]

		fwd, fwdHits, fwdMiss := forwardScore(me, c)
		rev, _ := reverseScore(c, me)

		score := fwd*0.6 + rev*0.4
		// 完整度高的人优先曝光（同等条件下）
		score += float64(c.Completeness) / 100 * 0.1

		// ---- 曝光均衡 ----
		// 曝光越多扣得越多，上限 maxExposurePenalty。
		// 用线性而不是指数：线性在小曝光量下几乎不惩罚，不会因为「被看了 3 次」
		// 就被压下去；到上限后也不再恶化，避免把人彻底雪藏。
		penalty := float64(c.RecentExposure) / exposureSaturation * maxExposurePenalty
		if penalty > maxExposurePenalty {
			penalty = maxExposurePenalty
		}
		score -= penalty

		// 新用户加权：注册 72 小时内保证曝光，否则新人拿不到 Like 就流失了
		if !c.CreatedAt.IsZero() && time.Since(c.CreatedAt) < newcomerWindow {
			score += newcomerBoost
		}

		card := CardView{
			UserID:       c.UserID,
			Nickname:     c.Nickname,
			Age:          c.Age,
			Gender:       c.Gender,
			HeightCm:     c.HeightCm,
			CityCity:     c.CityCity,
			CityProv:     c.CityProv,
			Occupation:   c.Occupation,
			Education:    c.Education,
			AvatarURL:    c.AvatarURL,
			Hobbies:      c.HobbyNames,
			Completeness: c.Completeness,
			SoftMismatch:  fwdMiss,
			Reasons:       fwdHits,
			SharedHobbies: sharedHobbies(me.HobbyNames, c.HobbyNames),
			AboutMe:       c.AboutMe,
			Score:         score,
		}
		if me.GeoHash != nil && c.GeoHash != nil {
			if km, ok := distanceKm(*me.GeoHash, *c.GeoHash); ok {
				card.DistanceFrom = km
				card.HasDistance = true
			}
		}
		cards = append(cards, card)
	}

	sort.SliceStable(cards, func(i, j int) bool { return cards[i].Score > cards[j].Score })
	return cards
}

// ---------- 打分 ----------

// forwardScore 计算「我的偏好 vs TA 的画像」的匹配度，并返回未满足的软条件名。
// forwardScore 算"这个人多大程度上满足我的伴侣偏好"。
//
// 除了分数和未命中的项，它还回一份**命中的项**（`hits`）。这是给卡片下半部分用的：
// 那一屏最该回答的问题是"为什么给我看这个人"，而这里恰好已经在逐项算了——
// 不把它带出去，前端就只能干巴巴地摆一堆字段。
//
// ⚠️ 两套标签的用途不同、措辞也不同：`miss` 是给"部分条件不符"那行提示用的（列名词），
// `hits` 是给标签胶囊用的（短句）。改的时候别把两边合并成一套。
func forwardScore(me *Candidate, c *Candidate) (score float64, hits []string, miss []string) {
	// 注意：me 的伴侣偏好存在 me 里（fetchCandidates 前已加载）
	var total, hit float64

	add := func(weight float64, ok bool, missLabel, hitLabel string) {
		total += weight
		if ok {
			hit += weight
			if hitLabel != "" {
				hits = append(hits, hitLabel)
			}
		} else if missLabel != "" {
			miss = append(miss, missLabel)
		}
	}

	if me.PrefHeightMax > 0 {
		add(1.0, c.HeightCm >= me.PrefHeightMin && c.HeightCm <= me.PrefHeightMax, "身高", "身高合适")
	}
	if me.PrefEducationMin > 0 {
		add(1.0, c.Education >= me.PrefEducationMin, "学历", "学历达标")
	}
	if me.PrefIncomeMin > 0 || me.PrefIncomeMax > 0 {
		add(1.0, incomeMatches(me.PrefIncomeMin, me.PrefIncomeMax, c.Income), "收入", "收入合适")
	}
	if me.PrefSmoking > 0 {
		ok := me.PrefSmoking == 3 || // 3=无所谓
			(me.PrefSmoking == 2 && c.Smoking == 1) || // 2=不接受，要求对方不抽
			(me.PrefSmoking == 1) // 1=接受，都行
		add(0.8, ok, "抽烟", "抽烟可接受")
	}
	if me.PrefDrinking > 0 {
		ok := me.PrefDrinking == 3 || me.PrefDrinking == 1 ||
			(me.PrefDrinking == 2 && c.Drinking == 1)
		add(0.8, ok, "", "喝酒可接受")
	}
	if len(me.PrefProvinces) > 0 {
		ok := false
		for _, p := range me.PrefProvinces {
			if p == c.HometownProv {
				ok = true
				break
			}
		}
		add(0.6, ok, "家乡", "家乡合适")
	}
	if me.PrefDink > 0 {
		ok := (me.PrefDink == 1 && c.IsDink == 1) || (me.PrefDink == 2 && c.IsDink != 1)
		add(1.2, ok, "丁克", "丁克一致") // 丁克分歧对关系影响大，权重最高
	}
	if me.PrefHouse > 0 {
		ok := me.PrefHouse == 2 || (me.PrefHouse == 1 && c.HasHouse == 2)
		add(0.7, ok, "房产", "有房")
	}
	if me.PrefCar > 0 {
		ok := me.PrefCar == 2 || (me.PrefCar == 1 && c.HasCar)
		add(0.5, ok, "", "有车")
	}

	if total == 0 {
		return 1.0, hits, miss
	}
	return hit / total, hits, miss
}

// sharedHobbies 两个人的共同兴趣。
//
// 为什么值得单独拎出来：偏好是"我要求对方怎样"，兴趣是"我们能聊什么"——
// 后者对"要不要打招呼"的影响更大，但它原先完全没有出现在卡片上。
func sharedHobbies(mine, theirs []string) []string {
	if len(mine) == 0 || len(theirs) == 0 {
		return nil
	}
	set := make(map[string]bool, len(mine))
	for _, h := range mine {
		set[h] = true
	}
	var out []string
	for _, h := range theirs {
		if set[h] {
			out = append(out, h)
		}
	}
	return out
}

// reverseScore 计算「TA 的偏好 vs 我的画像」——双向都合适的人应该排更前面。
func reverseScore(c *Candidate, me *Candidate) (float64, []string) {
	var total, hit float64
	var miss []string

	add := func(weight float64, ok bool) {
		total += weight
		if ok {
			hit += weight
		}
	}

	if c.PrefHeightMax > 0 {
		add(1.0, me.HeightCm >= c.PrefHeightMin && me.HeightCm <= c.PrefHeightMax)
	}
	if c.PrefEducationMin > 0 {
		add(1.0, me.Education >= c.PrefEducationMin)
	}
	if c.PrefIncomeMin > 0 || c.PrefIncomeMax > 0 {
		add(1.0, incomeMatches(c.PrefIncomeMin, c.PrefIncomeMax, me.Income))
	}
	if c.PrefSmoking > 0 {
		add(0.8, c.PrefSmoking == 1 || c.PrefSmoking == 3 || me.Smoking == 1)
	}
	if len(c.PrefProvinces) > 0 {
		ok := false
		for _, p := range c.PrefProvinces {
			if p == me.HometownProv {
				ok = true
				break
			}
		}
		add(0.6, ok)
	}
	if c.PrefDink > 0 {
		add(1.2, (c.PrefDink == 1 && me.IsDink == 1) || (c.PrefDink == 2 && me.IsDink != 1))
	}

	if total == 0 {
		return 1.0, nil
	}
	return hit / total, miss
}

// ---------- 广场检索 ----------

type PlazaFilter struct {
	AgeMin    *int
	AgeMax    *int
	HeightMin *int16
	HeightMax *int16
	// 省份可多选（广场的筛选就是这样用的）：空表示不限
	Provinces  []string
	Education  []int16
	Occupation []string
	// 收入按档位下标过滤（1–6 对应六档）。两个都是独立的，不设就不加这一条 SQL
	IncomeMin *int16
	IncomeMax *int16
	Keyword   *string
	Cursor    int64 // 上一页最后一条的 id（keyset 分页）
}

// Plaza 按条件检索。
//
// 分页用 keyset 游标而不是 OFFSET——深分页时 PG 会扫描并丢弃前 N 行，
// OFFSET 10000 就已经明显变慢（技术方案 9.2）。
func (s *DiscoveryService) Plaza(ctx context.Context, uid int64, f PlazaFilter, limit int) ([]CardView, int64, error) {
	if limit <= 0 || limit > 50 {
		limit = plazaPageSize
	}

	var sb strings.Builder
	args := []any{uid}

	sb.WriteString(`
		SELECT u.id, u.nickname, u.gender,
		       EXTRACT(YEAR FROM age(u.birthday))::int,
		       p.height_cm, p.education, p.income_range, p.smoking, p.drinking,
		       p.has_car, p.has_house, p.is_dink, p.is_only_child,
		       p.city_prov, p.city_city, p.geo_hash, p.hometown_prov,
		       p.occupation, p.mbti, p.completeness,
		       COALESCE(av.url, '') AS avatar_url,
		       0,0,0,0,0,0,0,0,0,0,0,'{}','{}'
		FROM users u
		JOIN user_profiles p ON p.user_id = u.id
		-- 头像＝相册里第一张已过审的照片（用户 2026-10-09 定的口径：只维护一份照片）。
		-- 用 LATERAL 而不是关联子查询，让「取第一张」只算一次；别名仍叫 av，
		-- 所以上面 SELECT 里的 COALESCE(av.url,'') 和后面的扫描代码都不用动。
		LEFT JOIN LATERAL (
		    SELECT ph.url FROM user_photos ph
		     WHERE ph.user_id = u.id AND ph.audit_status = 'approved'
		     ORDER BY ph.sort_order ASC LIMIT 1
		) av ON true
		WHERE u.id <> ?
		  AND u.status = 'active'
		  AND u.onboarded_at IS NOT NULL
		  AND EXISTS (SELECT 1 FROM user_photos ph
		              WHERE ph.user_id = u.id AND ph.audit_status = 'approved')
		  AND NOT EXISTS (SELECT 1 FROM user_actions a
		                  WHERE a.from_user = ? AND a.to_user = u.id)
		  AND NOT EXISTS (SELECT 1 FROM blocks b
		                  WHERE (b.user_id = ? AND b.blocked_user_id = u.id)
		                     OR (b.user_id = u.id AND b.blocked_user_id = ?))
	`)
	args = append(args, uid, uid, uid)

	// ⚠️ 这里必须用 make_interval + 显式 ::int，不能写成 (? || ' years')::interval：
	// 后者会因为 || 把参数推断成 text，而 Go 的 int 编不进 text 参数，
	// 运行时直接报 "unable to encode ... for text" —— 年龄筛选曾经因此整个不可用。
	if f.AgeMin != nil {
		sb.WriteString(" AND u.birthday <= (CURRENT_DATE - make_interval(years => ?::int))")
		args = append(args, *f.AgeMin)
	}
	if f.AgeMax != nil {
		// 生日 <= 今天-年龄 表示「已满 N 岁」，所以要 +1 取到「不超过 N 岁」的边界
		sb.WriteString(" AND u.birthday >= (CURRENT_DATE - make_interval(years => ?::int))")
		args = append(args, *f.AgeMax+1)
	}
	if f.HeightMin != nil {
		sb.WriteString(" AND p.height_cm >= ?")
		args = append(args, *f.HeightMin)
	}
	if f.HeightMax != nil {
		sb.WriteString(" AND p.height_cm <= ?")
		args = append(args, *f.HeightMax)
	}
	if len(f.Provinces) > 0 {
		sb.WriteString(" AND p.city_prov IN (" + placeholders(len(f.Provinces)) + ")")
		for _, p := range f.Provinces {
			args = append(args, p)
		}
	}
	if f.IncomeMin != nil {
		sb.WriteString(" AND p.income_range >= ?")
		args = append(args, *f.IncomeMin)
	}
	if f.IncomeMax != nil {
		sb.WriteString(" AND p.income_range <= ?")
		args = append(args, *f.IncomeMax)
	}
	// 用 IN 子句而不是 ANY(数组)：驱动对 []int16 没有内建支持，
	// 转成 IN (?,?,?) 免去自己实现 Valuer
	if len(f.Education) > 0 {
		sb.WriteString(" AND p.education IN (" + placeholders(len(f.Education)) + ")")
		for _, e := range f.Education {
			args = append(args, e)
		}
	}
	if len(f.Occupation) > 0 {
		sb.WriteString(" AND p.occupation IN (" + placeholders(len(f.Occupation)) + ")")
		for _, o := range f.Occupation {
			args = append(args, o)
		}
	}
	if f.Keyword != nil && *f.Keyword != "" {
		// pg_trgm 支持中文子串匹配；没装扩展时退化为 ILIKE 也不会报错
		sb.WriteString(" AND (u.nickname ILIKE ? OR COALESCE(t.about_me, '') ILIKE ?)")
		kw := "%" + *f.Keyword + "%"
		args = append(args, kw, kw)
	}

	if f.Cursor > 0 {
		sb.WriteString(" AND u.id < ?")
		args = append(args, f.Cursor)
	}

	sb.WriteString(" ORDER BY u.id DESC LIMIT ?")
	args = append(args, limit+1)

	rows, err := s.db.WithContext(ctx).Raw(sb.String(), args...).Rows()
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	cards := make([]CardView, 0)
	var lastID int64
	for rows.Next() {
		var c Candidate
		if err := rows.Scan(
			&c.UserID, &c.Nickname, &c.Gender, &c.Age,
			&c.HeightCm, &c.Education, &c.Income, &c.Smoking, &c.Drinking,
			&c.HasCar, &c.HasHouse, &c.IsDink, &c.OnlyChild,
			&c.CityProv, &c.CityCity, &c.GeoHash, &c.HometownProv,
			&c.Occupation, &c.MBTI, &c.Completeness,
			&c.AvatarURL,
			&c.PrefHeightMin, &c.PrefHeightMax, &c.PrefIncomeMin, &c.PrefIncomeMax,
			&c.PrefEducationMin, &c.PrefSmoking, &c.PrefDrinking,
			&c.PrefOnlyChild, &c.PrefCar, &c.PrefHouse, &c.PrefDink,
			&c.PrefProvinces, &c.PrefTags,
		); err != nil {
			return nil, 0, err
		}
		lastID = c.UserID
		cards = append(cards, CardView{
			UserID:       c.UserID,
			Nickname:     c.Nickname,
			Age:          c.Age,
			Gender:       c.Gender,
			HeightCm:     c.HeightCm,
			CityCity:     c.CityCity,
			CityProv:     c.CityProv,
			Occupation:   c.Occupation,
			Education:    c.Education,
			AvatarURL:    c.AvatarURL,
			Completeness: c.Completeness,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	var nextCursor int64
	if len(cards) > limit {
		cards = cards[:limit]
		nextCursor = lastID
	}
	return cards, nextCursor, nil
}

// ---------- 内部 ----------

func (s *DiscoveryService) loadSelf(ctx context.Context, uid int64) (*Candidate, error) {
	var me Candidate
	err := s.db.WithContext(ctx).Raw(`
		SELECT u.id, u.nickname, u.gender,
		       EXTRACT(YEAR FROM age(u.birthday))::int,
		       p.height_cm, p.education, p.income_range, p.smoking, p.drinking,
		       p.has_car, p.has_house, p.is_dink, p.is_only_child,
		       p.city_prov, p.city_city, p.geo_hash, p.hometown_prov,
		       p.occupation, p.mbti, p.completeness,
		       COALESCE(pref.height_min,0), COALESCE(pref.height_max,0),
		       COALESCE(pref.income_min,0), COALESCE(pref.income_max,0),
		       COALESCE(pref.education_min,0),
		       COALESCE(pref.smoking_accept,0), COALESCE(pref.drinking_accept,0),
		       COALESCE(pref.only_child_accept,0), COALESCE(pref.car_prefer,0),
		       COALESCE(pref.house_prefer,0), COALESCE(pref.dink_accept,0),
		       COALESCE(pref.hometown_provinces,'{}'), COALESCE(pref.tags,'{}'),
		       COALESCE(tx.about_me, '')
		FROM users u
		JOIN user_profiles p ON p.user_id = u.id
		LEFT JOIN partner_preferences pref ON pref.user_id = u.id
		LEFT JOIN user_texts tx ON tx.user_id = u.id
		WHERE u.id = ?
	`, uid).Row().Scan(
		&me.UserID, &me.Nickname, &me.Gender, &me.Age,
		&me.HeightCm, &me.Education, &me.Income, &me.Smoking, &me.Drinking,
		&me.HasCar, &me.HasHouse, &me.IsDink, &me.OnlyChild,
		&me.CityProv, &me.CityCity, &me.GeoHash, &me.HometownProv,
		&me.Occupation, &me.MBTI, &me.Completeness,
		&me.PrefHeightMin, &me.PrefHeightMax,
		&me.PrefIncomeMin, &me.PrefIncomeMax, &me.PrefEducationMin,
		&me.PrefSmoking, &me.PrefDrinking,
		&me.PrefOnlyChild, &me.PrefCar, &me.PrefHouse, &me.PrefDink,
		&me.PrefProvinces, &me.PrefTags, &me.AboutMe,
	)
	if err != nil {
		return nil, err
	}

	// 自己的兴趣：算"共同兴趣"要用（loadSelf 的这条 SQL 已经很宽了，
	// 兴趣是一对多，塞进去会把行乘开，所以单独查）
	rows, err := s.db.WithContext(ctx).
		Raw(`SELECT name FROM user_hobbies WHERE user_id = ? ORDER BY sort_order`, uid).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		me.HobbyNames = append(me.HobbyNames, n)
	}
	return &me, rows.Err()
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// placeholders 生成 "?,?,?" 这样的占位符串。
func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}
