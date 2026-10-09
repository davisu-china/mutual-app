package service

import (
	"context"
	"log"
	"strings"
	"time"

	"gorm.io/gorm"
)

// ExposureService 维护曝光与互动统计。
//
// 它是推荐公平性调控的数据来源（PRD 8.4）：没有这些计数，
// 「均衡曝光」就只是 SQL 里一句读空气的 ORDER BY。
//
// 所有写入都是**异步且尽力而为**的：统计丢了顶多让均衡钝一点，
// 不影响任何业务正确性，所以绝不该让它拖慢主流程或让请求失败。
type ExposureService struct {
	db *gorm.DB
}

func NewExposureService(db *gorm.DB) *ExposureService {
	return &ExposureService{db: db}
}

// RecordExposures 记录这批用户被展示过。
//
// 一批用一条 INSERT ... ON CONFLICT 写进去，而不是每人一条 UPDATE——
// 划卡每次要记 10 个人，逐条写就是 10 次往返。
func (s *ExposureService) RecordExposures(userIDs []int64) {
	if len(userIDs) == 0 {
		return
	}

	// **必须先按 user_id 合并**。
	// PostgreSQL 不允许一条 INSERT ... ON CONFLICT DO UPDATE 里两次命中同一行
	// （报 21000 cannot affect row a second time），同一个人在一批里出现两次
	// 会让**整批**曝光统计全部失败，而不是只丢那一条。
	// 正常路径上卡池不会出现重复用户，但依赖「上游不会重复」是危险的假设。
	counts := make(map[int64]int, len(userIDs))
	order := make([]int64, 0, len(userIDs))
	for _, id := range userIDs {
		if _, ok := counts[id]; !ok {
			order = append(order, id)
		}
		counts[id]++
	}

	vals := make([]string, 0, len(order))
	args := make([]any, 0, len(order)*3)
	today := time.Now().Format("2006-01-02")
	for _, id := range order {
		vals = append(vals, "(?,?,?,0,0)")
		args = append(args, id, today, counts[id])
	}
	sql := `
		INSERT INTO exposure_stats (user_id, stat_date, exposed_count, liked_count, visited_count)
		VALUES ` + strings.Join(vals, ",") + `
		ON CONFLICT (user_id, stat_date)
		DO UPDATE SET exposed_count = exposure_stats.exposed_count + EXCLUDED.exposed_count
	`
	s.run(sql, args...)
}

// Bump 累加某人的「被喜欢」或「被访问」计数。
func (s *ExposureService) Bump(userID int64, kind string) {
	col := "visited_count"
	liked, visited := 0, 1
	if kind == "like" {
		col, liked, visited = "liked_count", 1, 0
	}

	sql := `
		INSERT INTO exposure_stats (user_id, stat_date, exposed_count, liked_count, visited_count)
		VALUES (?, ?, 0, ?, ?)
		ON CONFLICT (user_id, stat_date)
		DO UPDATE SET ` + col + ` = exposure_stats.` + col + ` + 1
	`
	s.run(sql, userID, time.Now().Format("2006-01-02"), liked, visited)
}

func (s *ExposureService) run(sql string, args ...any) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := s.db.WithContext(ctx).Exec(sql, args...).Error; err != nil {
			log.Printf("[warn] 曝光统计写入失败（不影响主流程）: %v", err)
		}
	}()
}
