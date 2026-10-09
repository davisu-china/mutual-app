package service

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	"github.com/davisu-china/mutual-app/server/internal/model"
)

var (
	ErrProfileIncomplete = errors.New("资料不完整")
	ErrTooManyHobbies    = errors.New("兴趣爱好必须恰好 3 个")
	ErrHobbyNeedsText    = errors.New("每个兴趣都需要填写介绍")
)

const (
	MaxPhotosDefault = 9
	aboutMeMin       = 20
	aboutMeMax       = 500
	hobbyTextMin     = 10
	hobbyTextMax     = 200
)

type ProfileService struct {
	db  *gorm.DB
	exp *ExposureService
}

func NewProfileService(db *gorm.DB, exp *ExposureService) *ProfileService {
	return &ProfileService{db: db, exp: exp}
}

// ---------- 输出 DTO ----------

// ProfileView 是「本人画像」的对外结构。
//
// 注意：**同一个用户，自己看和别人看的字段集是不同的**。
// 收入、公司、体重、养老压力有 *_public 开关；手机号永远不出现。
// 序列化时按 viewerID 决定是否填充，而不是全查出来再让前端过滤——
// 那样敏感字段已经在网络上了（技术方案 12.2）。
type ProfileView struct {
	UserID int64 `json:"userId"`

	Nickname string     `json:"nickname"`
	Gender   *int16     `json:"gender"`
	Age      int        `json:"age"`
	Birthday *time.Time `json:"-"`

	HeightCm     int16   `json:"heightCm"`
	WeightKg     *int16  `json:"weightKg,omitempty"`
	HometownProv string  `json:"hometownProvince"`
	HometownCity string  `json:"hometownCity"`
	CityProv     string  `json:"cityProvince"`
	CityCity     string  `json:"city"`
	CityDistrict *string `json:"cityDistrict,omitempty"`
	DistanceKm   *int    `json:"distanceKm,omitempty"`

	Occupation      string  `json:"occupation"`
	OccupationOther *string `json:"occupationOther,omitempty"`
	MBTI            *string `json:"mbti,omitempty"`

	Smoking  int16 `json:"smoking"`
	Drinking int16 `json:"drinking"`
	// 仅在 self=true 时填充；他人查看时保持 nil + IncomeHidden=true
	IncomeRange *int16 `json:"incomeRange,omitempty"`
	Education   int16  `json:"education"`

	School  *string `json:"school,omitempty"`
	Company *string `json:"company,omitempty"`

	IsOnlyChild       bool   `json:"isOnlyChild"`
	EldercarePressure *int16 `json:"eldercarePressure,omitempty"`
	HasCar            bool   `json:"hasCar"`
	HasHouse          int16  `json:"hasHouse"`
	IsDink            int16  `json:"isDink"`

	Completeness int16  `json:"completeness"`
	AvatarURL    string `json:"avatarUrl"`

	// 是否对当前访问者隐藏了某些字段（前端可据此展示「未公开」）
	IncomeHidden  bool `json:"incomeHidden"`
	CompanyHidden bool `json:"companyHidden"`

	Hobbies []HobbyView `json:"hobbies,omitempty"`
	AboutMe *string     `json:"aboutMe,omitempty"`
	Expect  *string     `json:"expectPartner,omitempty"`

	Photos []PhotoView `json:"photos,omitempty"`

	Preference *PreferenceView `json:"preference,omitempty"`

	// 我与 TA 的关系（只在看别人时填充）。
	// 没有这个，前端在他人主页上只能一律显示「喜欢 / 跳过」——已经配对了还能再点
	// 喜欢，看着像没生效（后端是幂等的，但用户不知道）。
	Relation *RelationView `json:"relation,omitempty"`
}

type RelationView struct {
	Liked   bool `json:"liked"`
	Passed  bool `json:"passed"`
	Matched bool `json:"matched"`
}

type HobbyView struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	SortOrder   int16  `json:"sortOrder"`
}

type PhotoView struct {
	ID        int64  `json:"id"`
	URL       string `json:"url"`
	SortOrder int16  `json:"sortOrder"`
}

type PreferenceView struct {
	HeightMin         int16    `json:"heightMin"`
	HeightMax         int16    `json:"heightMax"`
	HometownProvinces []string `json:"hometownProvinces"`
	SmokingAccept     int16    `json:"smokingAccept"`
	DrinkingAccept    int16    `json:"drinkingAccept"`
	IncomeMin         int16    `json:"incomeMin"`
	IncomeMax         int16    `json:"incomeMax"`
	EducationMin      int16    `json:"educationMin"`
	OnlyChildAccept   int16    `json:"onlyChildAccept"`
	CarPrefer         int16    `json:"carPrefer"`
	HousePrefer       int16    `json:"housePrefer"`
	DinkAccept        int16    `json:"dinkAccept"`
	Tags              []string `json:"tags"`
}

// ---------- 读取 ----------

// MyProfile 返回本人的完整资料（不做可见性裁剪）。
func (s *ProfileService) MyProfile(ctx context.Context, uid int64) (*ProfileView, error) {
	return s.build(ctx, uid, uid, true)
}

// PublicProfile 返回他人可见的资料。
//
// 会记录一次 Visit（PRD 11.2：Visit 不通知对方，只静默进「谁看过我」）。
func (s *ProfileService) PublicProfile(ctx context.Context, viewerID, targetID int64) (*ProfileView, error) {
	if viewerID == targetID {
		return s.build(ctx, viewerID, viewerID, true)
	}

	// 拉黑关系双向阻断
	blocked, err := s.isBlocked(ctx, viewerID, targetID)
	if err != nil {
		return nil, err
	}
	if blocked {
		return nil, errors.New("无法查看该用户")
	}

	v, err := s.build(ctx, targetID, viewerID, false)
	if err != nil {
		return nil, err
	}

	// 记录访问：写动作流水（用于「谁看过我」）+ 累加统计（用于曝光均衡）
	_ = s.recordVisit(ctx, viewerID, targetID)
	s.exp.Bump(targetID, "visit")
	return v, nil
}

func (s *ProfileService) build(ctx context.Context, targetID, viewerID int64, self bool) (*ProfileView, error) {
	db := s.db.WithContext(ctx)

	var u model.User
	if err := db.Select("id", "nickname", "gender", "birthday", "status", "onboarded_at").
		First(&u, targetID).Error; err != nil {
		return nil, err
	}
	if !self && (u.Status == model.UserBanned || u.Status == model.UserDeleted) {
		return nil, errors.New("用户不存在")
	}

	var p model.UserProfile
	if err := db.First(&p, targetID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// 还没填画像，返回仅有基础信息的骨架
			return &ProfileView{
				UserID: u.ID, Nickname: u.Nickname, Gender: u.Gender,
				Age: calcAge(u.Birthday, time.Now()),
			}, nil
		}
		return nil, err
	}

	v := &ProfileView{
		UserID:       u.ID,
		Nickname:     u.Nickname,
		Gender:       u.Gender,
		Age:          calcAge(u.Birthday, time.Now()),
		HeightCm:     p.HeightCm,
		HometownProv: p.HometownProv,
		HometownCity: p.HometownCity,
		CityProv:     p.CityProv,
		CityCity:     p.CityCity,
		CityDistrict: p.CityDistrict,

		Occupation:      p.Occupation,
		OccupationOther: p.OccupationOther,
		MBTI:            p.MBTI,
		Smoking:         p.Smoking,
		Drinking:        p.Drinking,
		Education:       p.Education,
		School:          p.School,

		IsOnlyChild:  p.IsOnlyChild,
		HasCar:       p.HasCar,
		HasHouse:     p.HasHouse,
		IsDink:       p.IsDink,
		Completeness: p.Completeness,
	}

	// ---- 可见性裁剪：这几项不是「填了就公开」 ----
	if self || p.WeightPublic {
		v.WeightKg = p.WeightKg
	}
	if self {
		v.IncomeRange = &p.IncomeRange
		v.EldercarePressure = &p.EldercarePressure
	} else {
		v.IncomeHidden = true
	}
	if self || p.CompanyPublic {
		v.Company = p.Company
	} else if p.Company != nil {
		v.CompanyHidden = true
	}

	// 相册：只看已过审的；「仅配对后可见」的照片只有配对用户才返回。
	// **头像就是这里的第一张**（用户 2026-10-09 定的口径：只维护一份照片），
	// 所以顺序要在拿到 photos 之后再取——这样非配对用户看到的「脸」也只会是
	// 「他有权看到的第一张」，不会通过头像字段漏出 match_only 的照片。
	matched := false
	if !self {
		matched, _ = s.isMatched(ctx, viewerID, targetID)
	}

	var photos []model.UserPhoto
	q := db.Where("user_id = ? AND audit_status = ?", targetID, model.AuditApproved)
	if !self {
		if matched {
			q = q.Where("visibility IN ?", []string{"public", "match_only"})
		} else {
			q = q.Where("visibility = ?", "public")
		}
	}
	if err := q.Order("sort_order asc").Limit(9).Find(&photos).Error; err == nil {
		if len(photos) > 0 {
			v.AvatarURL = photos[0].URL
		}
		for _, ph := range photos {
			v.Photos = append(v.Photos, PhotoView{ID: ph.ID, URL: ph.URL, SortOrder: ph.SortOrder})
		}
	}

	// 我与 TA 的关系：前端据此决定底部操作条显示「喜欢 / 跳过」还是「去聊天」
	if !self {
		rel := &RelationView{Matched: matched}
		var acts []string
		db.Model(&model.UserAction{}).
			Where("from_user = ? AND to_user = ?", viewerID, targetID).
			Pluck("action", &acts)
		for _, a := range acts {
			switch a {
			case model.ActionLike:
				rel.Liked = true
			case model.ActionPass:
				rel.Passed = true
			}
		}
		v.Relation = rel
	}

	// 兴趣
	var hobbies []model.UserHobby
	if err := db.Where("user_id = ?", targetID).Order("sort_order asc").Find(&hobbies).Error; err == nil {
		for _, h := range hobbies {
			v.Hobbies = append(v.Hobbies, HobbyView{Name: h.Name, Description: h.Description, SortOrder: h.SortOrder})
		}
	}

	// 两段自述
	var t model.UserText
	if err := db.First(&t, targetID).Error; err == nil {
		v.AboutMe = t.AboutMe
		v.Expect = t.ExpectPartner
	}

	// 伴侣画像：本人可见，他人不可见（避免「你在挑条件」的冒犯感）
	if self {
		var pref model.PartnerPreference
		if err := db.First(&pref, targetID).Error; err == nil {
			v.Preference = &PreferenceView{
				HeightMin:         pref.HeightMin,
				HeightMax:         pref.HeightMax,
				HometownProvinces: []string(pref.HometownProvinces),
				SmokingAccept:     pref.SmokingAccept,
				DrinkingAccept:    pref.DrinkingAccept,
				IncomeMin:         pref.IncomeMin,
				IncomeMax:         pref.IncomeMax,
				EducationMin:      pref.EducationMin,
				OnlyChildAccept:   pref.OnlyChildAccept,
				CarPrefer:         pref.CarPrefer,
				HousePrefer:       pref.HousePrefer,
				DinkAccept:        pref.DinkAccept,
				Tags:              []string(pref.Tags),
			}
		}
	}

	return v, nil
}

// ---------- 写入 ----------

type UpdateProfileInput struct {
	Nickname          *string `json:"nickname"`
	Gender            *int16  `json:"gender"`
	Birthday          *string `json:"birthday"` // YYYY-MM-DD
	HeightCm          *int16  `json:"heightCm"`
	WeightKg          *int16  `json:"weightKg"`
	HometownProv      *string `json:"hometownProvince"`
	HometownCity      *string `json:"hometownCity"`
	CityProv          *string `json:"cityProvince"`
	CityCity          *string `json:"city"`
	CityDistrict      *string `json:"cityDistrict"`
	Occupation        *string `json:"occupation"`
	OccupationOther   *string `json:"occupationOther"`
	MBTI              *string `json:"mbti"`
	Smoking           *int16  `json:"smoking"`
	Drinking          *int16  `json:"drinking"`
	IncomeRange       *int16  `json:"incomeRange"`
	Education         *int16  `json:"education"`
	School            *string `json:"school"`
	Company           *string `json:"company"`
	IsOnlyChild       *bool   `json:"isOnlyChild"`
	EldercarePressure *int16  `json:"eldercarePressure"`
	HasCar            *bool   `json:"hasCar"`
	HasHouse          *int16  `json:"hasHouse"`
	IsDink            *int16  `json:"isDink"`

	WeightPublic  *bool `json:"weightPublic"`
	IncomePublic  *bool `json:"incomePublic"`
	CompanyPublic *bool `json:"companyPublic"`
}

func (s *ProfileService) Update(ctx context.Context, uid int64, in UpdateProfileInput) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 昵称与生日落在 users 表
		if in.Nickname != nil || in.Gender != nil || in.Birthday != nil {
			updates := map[string]any{}
			if in.Nickname != nil {
				if n := len([]rune(*in.Nickname)); n < 2 || n > 12 {
					return invalidInput("昵称需要 2–12 个字")
				}
				updates["nickname"] = *in.Nickname
			}
			if in.Gender != nil {
				if *in.Gender != model.GenderMale && *in.Gender != model.GenderFemale {
					return invalidInput("性别取值不合法")
				}
				// 性别注册后锁定：已有值就不允许改（PRD 5.1）
				var cur model.User
				if err := tx.Select("gender").First(&cur, uid).Error; err != nil {
					return err
				}
				// 性别一经设定就锁定（PRD 5.1）：允许首次设置，之后不可改。
				// 否则用户可以改性别进入异性卡池，造成骚扰与数据污染。
				if cur.Gender != nil && *cur.Gender != *in.Gender {
					return invalidInput("性别不可修改，如需变更请联系客服")
				}
				updates["gender"] = *in.Gender
			}
			if in.Birthday != nil {
				bd, err := time.Parse("2006-01-02", *in.Birthday)
				if err != nil {
					return invalidInput("出生日期格式应为 YYYY-MM-DD")
				}
				if calcAge(bd, time.Now()) < 18 {
					return ErrUnderage
				}
				updates["birthday"] = bd
			}
			if len(updates) > 0 {
				if err := tx.Model(&model.User{}).Where("id = ?", uid).Updates(updates).Error; err != nil {
					return err
				}
			}
		}

		// 画像字段：upsert，逐字段合并
		var p model.UserProfile
		err := tx.First(&p, uid).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			p = model.UserProfile{UserID: uid}
		} else if err != nil {
			return err
		}

		applyProfileUpdates(&p, in)
		p.GeoHash = nil // 由现居地派生，这里留空由外部补

		if p.Completeness == 0 && p.HeightCm == 0 {
			// 首次创建
			if err := tx.Create(&p).Error; err != nil {
				return err
			}
		} else {
			if err := tx.Save(&p).Error; err != nil {
				return err
			}
		}

		return s.recalcCompleteness(tx, uid)
	})
}

func applyProfileUpdates(p *model.UserProfile, in UpdateProfileInput) {
	setInt16 := func(dst *int16, src *int16) {
		if src != nil {
			*dst = *src
		}
	}
	setStr := func(dst *string, src *string) {
		if src != nil {
			*dst = *src
		}
	}
	setOptStr := func(dst **string, src *string) {
		if src != nil {
			*dst = src
		}
	}
	setOptInt16 := func(dst **int16, src *int16) {
		if src != nil {
			*dst = src
		}
	}
	setBool := func(dst *bool, src *bool) {
		if src != nil {
			*dst = *src
		}
	}

	setInt16(&p.HeightCm, in.HeightCm)
	setOptInt16(&p.WeightKg, in.WeightKg)
	setStr(&p.HometownProv, in.HometownProv)
	setStr(&p.HometownCity, in.HometownCity)
	setStr(&p.CityProv, in.CityProv)
	setStr(&p.CityCity, in.CityCity)
	setOptStr(&p.CityDistrict, in.CityDistrict)
	setStr(&p.Occupation, in.Occupation)
	setOptStr(&p.OccupationOther, in.OccupationOther)
	setOptStr(&p.MBTI, in.MBTI)
	setInt16(&p.Smoking, in.Smoking)
	setInt16(&p.Drinking, in.Drinking)
	setInt16(&p.IncomeRange, in.IncomeRange)
	setInt16(&p.Education, in.Education)
	setOptStr(&p.School, in.School)
	setOptStr(&p.Company, in.Company)
	setBool(&p.IsOnlyChild, in.IsOnlyChild)
	setInt16(&p.EldercarePressure, in.EldercarePressure)
	setBool(&p.HasCar, in.HasCar)
	setInt16(&p.HasHouse, in.HasHouse)
	setInt16(&p.IsDink, in.IsDink)

	setBool(&p.WeightPublic, in.WeightPublic)
	setBool(&p.IncomePublic, in.IncomePublic)
	setBool(&p.CompanyPublic, in.CompanyPublic)
}

// SetHobbies 整体替换三个兴趣（数量与文字都强制校验）。
func (s *ProfileService) SetHobbies(ctx context.Context, uid int64, hobbies []HobbyView) error {
	if len(hobbies) != 3 {
		return ErrTooManyHobbies
	}
	seen := map[string]bool{}
	for _, h := range hobbies {
		if seen[h.Name] {
			return invalidInput("兴趣不能重复")
		}
		seen[h.Name] = true
		n := len([]rune(h.Description))
		if n < hobbyTextMin || n > hobbyTextMax {
			return invalidInput("「%s」的介绍需要 %d–%d 字", h.Name, hobbyTextMin, hobbyTextMax)
		}
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", uid).Delete(&model.UserHobby{}).Error; err != nil {
			return err
		}
		for i, h := range hobbies {
			row := model.UserHobby{
				UserID:      uid,
				Name:        h.Name,
				Description: h.Description,
				SortOrder:   int16(i + 1),
			}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
		}
		return s.recalcCompleteness(tx, uid)
	})
}

func (s *ProfileService) SetTexts(ctx context.Context, uid int64, aboutMe, expect *string) error {
	if aboutMe != nil {
		n := len([]rune(*aboutMe))
		if n < aboutMeMin || n > aboutMeMax {
			return invalidInput("「关于我」需要 %d–%d 字", aboutMeMin, aboutMeMax)
		}
	}
	if expect != nil {
		n := len([]rune(*expect))
		if n < aboutMeMin || n > aboutMeMax {
			return invalidInput("「期待的那个他/她」需要 %d–%d 字", aboutMeMin, aboutMeMax)
		}
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var t model.UserText
		err := tx.First(&t, uid).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			t = model.UserText{UserID: uid}
		} else if err != nil {
			return err
		}
		if aboutMe != nil {
			t.AboutMe = aboutMe
		}
		if expect != nil {
			t.ExpectPartner = expect
		}
		if err := tx.Save(&t).Error; err != nil {
			return err
		}
		return s.recalcCompleteness(tx, uid)
	})
}

func (s *ProfileService) SetPreference(ctx context.Context, uid int64, v PreferenceView) error {
	if v.HeightMin < 130 || v.HeightMax > 230 || v.HeightMin > v.HeightMax {
		return invalidInput("期望身高范围不合法")
	}
	if v.IncomeMin < 0 || v.IncomeMax > 7 || v.IncomeMin > v.IncomeMax {
		return invalidInput("期望收入范围不合法")
	}

	p := model.PartnerPreference{
		UserID:            uid,
		HeightMin:         v.HeightMin,
		HeightMax:         v.HeightMax,
		HometownProvinces: model.StringArray(v.HometownProvinces),
		SmokingAccept:     v.SmokingAccept,
		DrinkingAccept:    v.DrinkingAccept,
		IncomeMin:         v.IncomeMin,
		IncomeMax:         v.IncomeMax,
		EducationMin:      v.EducationMin,
		OnlyChildAccept:   v.OnlyChildAccept,
		CarPrefer:         v.CarPrefer,
		HousePrefer:       v.HousePrefer,
		DinkAccept:        v.DinkAccept,
		Tags:              model.StringArray(v.Tags),
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing model.PartnerPreference
		err := tx.First(&existing, uid).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if err := tx.Create(&p).Error; err != nil {
				return err
			}
		} else if err != nil {
			return err
		} else {
			if err := tx.Save(&p).Error; err != nil {
				return err
			}
		}
		return s.recalcCompleteness(tx, uid)
	})
}

// CompleteOnboarding 收口：校验门槛，通过后写 onboarded_at。
//
// 「通行门槛」与「资料完整度」是两个不同的东西（PRD 5.2）：
// 门槛是二值的、通了才能用功能；完整度只影响曝光权重。
func (s *ProfileService) CompleteOnboarding(ctx context.Context, uid int64) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var u model.User
		if err := tx.First(&u, uid).Error; err != nil {
			return err
		}
		if u.Gender == nil {
			return invalidInput("请先填写性别")
		}
		if calcAge(u.Birthday, time.Now()) < 18 {
			return ErrUnderage
		}

		var p model.UserProfile
		if err := tx.First(&p, uid).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return invalidInput("请先填写本人画像")
			}
			return err
		}
		if missing := missingProfileFields(&p); len(missing) > 0 {
			return invalidInput("还有未填写的必填项：%v", missing)
		}

		var hobbies []model.UserHobby
		tx.Where("user_id = ?", uid).Find(&hobbies)
		if len(hobbies) != 3 {
			return invalidInput("请填写恰好 3 个兴趣爱好")
		}
		for _, h := range hobbies {
			if len([]rune(h.Description)) < hobbyTextMin {
				return invalidInput("「%s」的介绍太短", h.Name)
			}
		}

		var t model.UserText
		if err := tx.First(&t, uid).Error; err != nil || t.AboutMe == nil ||
			len([]rune(*t.AboutMe)) < aboutMeMin {
			return invalidInput("请填写「关于我」")
		}
		if t.ExpectPartner == nil || len([]rune(*t.ExpectPartner)) < aboutMeMin {
			return invalidInput("请填写「期待的那个他/她」")
		}

		var prefCount int64
		tx.Model(&model.PartnerPreference{}).Where("user_id = ?", uid).Count(&prefCount)
		if prefCount == 0 {
			return invalidInput("请填写伴侣画像")
		}

		// 头像就是相册第一张，所以这里要求的是「至少一张已过审照片」
		var photoCount int64
		tx.Model(&model.UserPhoto{}).
			Where("user_id = ? AND audit_status = ?", uid, model.AuditApproved).
			Count(&photoCount)
		if photoCount == 0 {
			return invalidInput("请至少上传一张照片")
		}

		now := time.Now()
		if err := tx.Model(&model.User{}).Where("id = ?", uid).Updates(map[string]any{
			"onboarded_at": now,
			"status":       model.UserActive,
		}).Error; err != nil {
			return err
		}
		return s.recalcCompleteness(tx, uid)
	})
}

// ---------- 内部工具 ----------

func missingProfileFields(p *model.UserProfile) []string {
	var m []string
	if p.HeightCm == 0 {
		m = append(m, "身高")
	}
	if p.WeightKg == nil {
		m = append(m, "体重")
	}
	if p.HometownProv == "" {
		m = append(m, "家乡")
	}
	if p.CityCity == "" {
		m = append(m, "现居地")
	}
	if p.Occupation == "" {
		m = append(m, "职业")
	}
	if p.MBTI == nil {
		m = append(m, "MBTI")
	}
	if p.Smoking == 0 {
		m = append(m, "抽烟")
	}
	if p.Drinking == 0 {
		m = append(m, "喝酒")
	}
	if p.IncomeRange == 0 {
		m = append(m, "年收入")
	}
	if p.Education == 0 {
		m = append(m, "学历")
	}
	if p.School == nil || *p.School == "" {
		m = append(m, "学校")
	}
	if p.Company == nil || *p.Company == "" {
		m = append(m, "公司")
	}
	if p.EldercarePressure == 0 {
		m = append(m, "养老压力")
	}
	if p.HasHouse == 0 {
		m = append(m, "是否有房")
	}
	if p.IsDink == 0 {
		m = append(m, "是否丁克")
	}
	return m
}

// recalcCompleteness 重算完整度。
//
// 走完五步必得 85 分（人人相同），真正拉开差距的是选填项与相册（PRD 5.2）。
func (s *ProfileService) recalcCompleteness(tx *gorm.DB, uid int64) error {
	score := 0

	var p model.UserProfile
	if err := tx.First(&p, uid).Error; err == nil {
		if len(missingProfileFields(&p)) == 0 {
			score += 50
		}
		if p.School != nil {
			score += 3
		}
		if p.Company != nil {
			score += 2
		}
	}

	var hobbyCount int64
	tx.Model(&model.UserHobby{}).Where("user_id = ?", uid).Count(&hobbyCount)
	if hobbyCount == 3 {
		score += 15
	}

	var t model.UserText
	if err := tx.First(&t, uid).Error; err == nil {
		if t.AboutMe != nil && len([]rune(*t.AboutMe)) >= aboutMeMin {
			score += 10
		}
		if t.ExpectPartner != nil && len([]rune(*t.ExpectPartner)) >= aboutMeMin {
			score += 10
		}
	}

	var photoCount int64
	tx.Model(&model.UserPhoto{}).Where("user_id = ?", uid).Count(&photoCount)
	switch {
	case photoCount >= 3:
		score += 10
	case photoCount > 0:
		score += int(photoCount) * 3
	}

	if score > 100 {
		score = 100
	}
	return tx.Model(&model.UserProfile{}).Where("user_id = ?", uid).
		Update("completeness", score).Error
}

func (s *ProfileService) isBlocked(ctx context.Context, a, b int64) (bool, error) {
	var n int64
	err := s.db.WithContext(ctx).Model(&model.Block{}).
		Where("(user_id = ? AND blocked_user_id = ?) OR (user_id = ? AND blocked_user_id = ?)",
			a, b, b, a).
		Count(&n).Error
	return n > 0, err
}

func (s *ProfileService) isMatched(ctx context.Context, a, b int64) (bool, error) {
	if a == b {
		return false, nil
	}
	lo, hi := orderPair(a, b)
	var n int64
	err := s.db.WithContext(ctx).Model(&model.MatchRecord{}).
		Where("user_a = ? AND user_b = ? AND status = ?", lo, hi, model.MatchActive).
		Count(&n).Error
	return n > 0, err
}

func (s *ProfileService) recordVisit(ctx context.Context, from, to int64) error {
	if from == 0 || from == to {
		return nil
	}
	// Visit 用 upsert：同一人反复访问只更新时间，不占多行（PRD 11.2）
	return s.db.WithContext(ctx).Exec(`
		INSERT INTO user_actions (from_user, to_user, action, source, created_at, updated_at)
		VALUES (?, ?, 'visit', 'card', now(), now())
		ON CONFLICT (from_user, to_user, action)
		DO UPDATE SET updated_at = now()
	`, from, to).Error
}

// orderPair 规范化配对的两方（user_a < user_b），保证全局唯一一条记录。
func orderPair(a, b int64) (int64, int64) {
	if a < b {
		return a, b
	}
	return b, a
}

func calcAge(birthday time.Time, now time.Time) int {
	age := now.Year() - birthday.Year()
	if now.Month() < birthday.Month() ||
		(now.Month() == birthday.Month() && now.Day() < birthday.Day()) {
		age--
	}
	return age
}
