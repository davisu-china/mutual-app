// Package model 定义 GORM 模型。
//
// 权威表结构是仓库根目录的 db/schema.sql，本文件是它的 Go 映射。
// 方向是「模型跟随 DDL」，**禁止用 AutoMigrate 反向改库**（见技术方案 9.1）。
package model

import "time"

// ---------- 枚举：用 SMALLINT 存有序档位，VARCHAR 存状态 ----------

const (
	GenderMale   int16 = 1
	GenderFemale int16 = 2
)

const (
	UserRegistered = "registered"
	UserActive     = "active"
	UserFrozen     = "frozen"
	UserBanned     = "banned"
	UserDeleted    = "deleted"
)

const (
	ActionLike  = "like"
	ActionPass  = "pass"
	ActionVisit = "visit"
)

const (
	SourceCard    = "card"
	SourcePlaza   = "plaza"
	SourceLikesMe = "likes_me"
)

const (
	AuditPending  = "pending"
	AuditApproved = "approved"
	AuditRejected = "rejected"
)

const (
	MatchActive    = "active"
	MatchUnmatched = "unmatched"
	MatchBlocked   = "blocked"
)

const (
	ConvActive   = "active"
	ConvReadonly = "readonly"
	ConvFrozen   = "frozen"
)

// ---------- 账号 ----------

type User struct {
	ID           int64      `gorm:"primaryKey" json:"id"`
	Phone        string     `gorm:"size:11;uniqueIndex;not null" json:"-"`
	PasswordHash string     `gorm:"size:255;not null" json:"-"`
	Nickname     string     `gorm:"size:32;not null" json:"nickname"`
	Gender       *int16     `json:"gender"` // nil = 尚未填写
	Birthday     time.Time  `gorm:"type:date;not null" json:"-"`
	Status       string     `gorm:"size:16;not null;default:registered" json:"status"`
	DeviceID     *string    `gorm:"size:128" json:"-"`
	RegisterIP   *string    `gorm:"type:inet" json:"-"`
	LastLoginAt  *time.Time `json:"lastLoginAt"`
	OnboardedAt  *time.Time `json:"onboardedAt"`
	// 后台管理员。不对外下发（json:"-"）——它是权限位，不该出现在任何用户可见的响应里
	IsAdmin   bool      `gorm:"not null;default:false" json:"-"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

func (User) TableName() string { return "users" }

// ---------- 本人画像 ----------

type UserProfile struct {
	UserID int64 `gorm:"primaryKey" json:"-"`

	HeightCm     int16  `gorm:"not null" json:"heightCm"`
	WeightKg     *int16 `json:"weightKg"`
	HometownProv string `gorm:"size:16;not null" json:"hometownProvince"`
	HometownCity string `gorm:"size:32;not null" json:"hometownCity"`
	CityProv     string `gorm:"size:16;not null" json:"cityProvince"`
	CityCity     string `gorm:"size:32;not null" json:"city"`
	CityDistrict *string `gorm:"size:32" json:"cityDistrict"`
	GeoHash      *string `gorm:"size:8" json:"-"`

	Occupation      string  `gorm:"size:24;not null" json:"occupation"`
	OccupationOther *string `gorm:"size:64" json:"occupationOther"`
	MBTI            *string `gorm:"size:4" json:"mbti"`

	Smoking    int16 `gorm:"not null" json:"smoking"`
	Drinking   int16 `gorm:"not null" json:"drinking"`
	IncomeRange int16 `gorm:"not null" json:"-"`
	Education  int16 `gorm:"not null" json:"education"`

	School  *string `gorm:"size:64" json:"school"`
	Company *string `gorm:"size:64" json:"company"`

	IsOnlyChild       bool  `gorm:"not null" json:"isOnlyChild"`
	EldercarePressure int16 `gorm:"not null" json:"-"`
	HasCar            bool  `gorm:"not null" json:"hasCar"`
	HasHouse          int16 `gorm:"not null" json:"hasHouse"`
	IsDink            int16 `gorm:"not null" json:"isDink"`

	// 可见性开关：填了 ≠ 公开（PRD 第 15 章）
	WeightPublic  bool `gorm:"not null;default:false" json:"weightPublic"`
	IncomePublic  bool `gorm:"not null;default:false" json:"incomePublic"`
	CompanyPublic bool `gorm:"not null;default:false" json:"companyPublic"`

	Completeness int16     `gorm:"not null;default:0" json:"completeness"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

func (UserProfile) TableName() string { return "user_profiles" }

type UserHobby struct {
	ID          int64  `gorm:"primaryKey" json:"id"`
	UserID      int64  `gorm:"index;not null" json:"-"`
	Name        string `gorm:"size:32;not null" json:"name"`
	Description string `gorm:"size:500;not null" json:"description"`
	SortOrder   int16  `gorm:"not null" json:"sortOrder"`
}

func (UserHobby) TableName() string { return "user_hobbies" }

type UserText struct {
	UserID        int64     `gorm:"primaryKey" json:"-"`
	AboutMe       *string   `gorm:"size:1000" json:"aboutMe"`
	ExpectPartner *string   `gorm:"size:1000" json:"expectPartner"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

func (UserText) TableName() string { return "user_texts" }

// ---------- 相册与头像 ----------

type UserPhoto struct {
	ID          int64     `gorm:"primaryKey" json:"id"`
	UserID      int64     `gorm:"index;not null" json:"-"`
	URL         string    `gorm:"size:512;not null" json:"url"`
	SortOrder   int16     `gorm:"not null" json:"sortOrder"`
	AuditStatus string    `gorm:"size:16;not null;default:pending" json:"auditStatus"`
	Visibility  string    `gorm:"size:16;not null;default:public" json:"visibility"`
	CreatedAt   time.Time `json:"createdAt"`
}

func (UserPhoto) TableName() string { return "user_photos" }

type UserAvatar struct {
	UserID      int64     `gorm:"primaryKey" json:"-"`
	URL         string    `gorm:"size:512;not null" json:"url"`
	AuditStatus string    `gorm:"size:16;not null;default:pending" json:"auditStatus"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

func (UserAvatar) TableName() string { return "user_avatars" }

// ---------- 伴侣画像 ----------

// ProvinceList 与 TagList 用 Postgres 的 text[] 存，这里用 pq 风格的字符串切片。
type PartnerPreference struct {
	UserID int64 `gorm:"primaryKey" json:"-"`

	HeightMin int16 `gorm:"not null" json:"heightMin"`
	HeightMax int16 `gorm:"not null" json:"heightMax"`

	// 用 text[] 存储，GORM 通过 serializer 处理
	HometownProvinces StringArray `gorm:"type:text[]" json:"hometownProvinces"`

	SmokingAccept  int16 `gorm:"not null" json:"smokingAccept"`
	DrinkingAccept int16 `gorm:"not null" json:"drinkingAccept"`

	IncomeMin int16 `gorm:"not null" json:"incomeMin"`
	IncomeMax int16 `gorm:"not null" json:"incomeMax"`

	EducationMin int16 `gorm:"not null" json:"educationMin"`

	OnlyChildAccept int16 `gorm:"not null" json:"onlyChildAccept"`
	CarPrefer       int16 `gorm:"not null" json:"carPrefer"`
	HousePrefer     int16 `gorm:"not null" json:"housePrefer"`
	DinkAccept      int16 `gorm:"not null" json:"dinkAccept"`

	Tags      StringArray `gorm:"type:text[]" json:"tags"`
	UpdatedAt time.Time   `json:"updatedAt"`
}

func (PartnerPreference) TableName() string { return "partner_preferences" }

// ---------- 动作与配对 ----------

type UserAction struct {
	ID        int64     `gorm:"primaryKey" json:"id"`
	FromUser  int64     `gorm:"not null" json:"fromUser"`
	ToUser    int64     `gorm:"not null" json:"toUser"`
	Action    string    `gorm:"size:8;not null" json:"action"`
	Source    string    `gorm:"size:16;not null" json:"source"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (UserAction) TableName() string { return "user_actions" }

type MatchRecord struct {
	ID          int64      `gorm:"primaryKey" json:"id"`
	UserA       int64      `gorm:"not null" json:"userA"`
	UserB       int64      `gorm:"not null" json:"userB"`
	Status      string     `gorm:"size:16;not null;default:active" json:"status"`
	MatchedAt   time.Time  `json:"matchedAt"`
	UnmatchedAt *time.Time `json:"unmatchedAt"`
	UnmatchedBy *int64     `json:"unmatchedBy"`
}

func (MatchRecord) TableName() string { return "match_records" }

// ---------- 会话与消息 ----------

type Conversation struct {
	ID            int64      `gorm:"primaryKey" json:"id"`
	MatchID       int64      `gorm:"not null" json:"matchId"`
	UserA         int64      `gorm:"not null" json:"userA"`
	UserB         int64      `gorm:"not null" json:"userB"`
	LastMessageID *int64     `json:"lastMessageId"`
	LastMessageAt *time.Time `json:"lastMessageAt"`
	UnreadA       int32      `gorm:"not null;default:0" json:"unreadA"`
	UnreadB       int32      `gorm:"not null;default:0" json:"unreadB"`
	Status        string     `gorm:"size:16;not null;default:active" json:"status"`
	CreatedAt     time.Time  `json:"createdAt"`
}

func (Conversation) TableName() string { return "conversations" }

type Message struct {
	ID             int64     `gorm:"primaryKey" json:"id"`
	ConversationID int64     `gorm:"not null" json:"conversationId"`
	FromUser       int64     `gorm:"not null" json:"fromUser"`
	MsgType        string    `gorm:"size:8;not null" json:"msgType"`
	Content        *string   `json:"content"`
	ClientMsgID    *string   `gorm:"size:64" json:"clientMsgId"`
	Seq            int64     `gorm:"not null" json:"seq"`
	Status         string    `gorm:"size:16;not null;default:sent" json:"status"`
	CreatedAt      time.Time `json:"createdAt"`
}

func (Message) TableName() string { return "messages" }

// ---------- 额度 ----------

type DailyQuota struct {
	ID            int64     `gorm:"primaryKey" json:"-"`
	UserID        int64     `gorm:"not null" json:"-"`
	QuotaDate     string    `gorm:"type:date;not null" json:"quotaDate"`
	UsedLikeCount int16     `gorm:"not null;default:0" json:"usedLikeCount"`
	LimitCount    int16     `gorm:"not null;default:10" json:"limitCount"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

func (DailyQuota) TableName() string { return "daily_quotas" }

// ---------- 曝光统计 ----------

type ExposureStat struct {
	ID           int64  `gorm:"primaryKey" json:"-"`
	UserID       int64  `gorm:"not null" json:"-"`
	StatDate     string `gorm:"type:date;not null" json:"statDate"`
	ExposedCount int32  `gorm:"not null;default:0" json:"exposedCount"`
	LikedCount   int32  `gorm:"not null;default:0" json:"likedCount"`
	VisitedCount int32  `gorm:"not null;default:0" json:"visitedCount"`
}

func (ExposureStat) TableName() string { return "exposure_stats" }

// ---------- 举报与拉黑 ----------

type Report struct {
	ID         int64      `gorm:"primaryKey" json:"id"`
	ReporterID int64      `gorm:"not null" json:"reporterId"`
	TargetUser int64      `gorm:"not null" json:"targetUser"`
	TargetType string     `gorm:"size:16;not null" json:"targetType"`
	TargetID   *int64     `json:"targetId"`
	Reason     string     `gorm:"size:32;not null" json:"reason"`
	Detail     *string    `gorm:"size:500" json:"detail"`
	Evidence   StringArray `gorm:"type:text[]" json:"evidence"`
	Status     string     `gorm:"size:16;not null;default:pending" json:"status"`
	HandledBy  *int64     `json:"handledBy"`
	HandledAt  *time.Time `json:"handledAt"`
	CreatedAt  time.Time  `json:"createdAt"`
}

func (Report) TableName() string { return "reports" }

type Block struct {
	ID            int64     `gorm:"primaryKey" json:"id"`
	UserID        int64     `gorm:"not null" json:"userId"`
	BlockedUserID int64     `gorm:"not null" json:"blockedUserId"`
	CreatedAt     time.Time `json:"createdAt"`
}

func (Block) TableName() string { return "blocks" }

type AuditLog struct {
	ID         int64     `gorm:"primaryKey" json:"id"`
	TargetType string    `gorm:"size:16;not null" json:"targetType"`
	TargetID   int64     `gorm:"not null" json:"targetId"`
	Action     string    `gorm:"size:32;not null" json:"action"`
	Reason     *string   `gorm:"size:255" json:"reason"`
	Operator   *string   `gorm:"size:64" json:"operator"`
	CreatedAt  time.Time `json:"createdAt"`
}

func (AuditLog) TableName() string { return "audit_logs" }
