package service

import (
	"context"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/davisu-china/mutual-app/server/internal/config"
	"github.com/davisu-china/mutual-app/server/internal/model"
)

// 集成测试：连真实 PostgreSQL 跑。
//
// 为什么必须用真库：本项目唯二会产生脏数据的地方——
// 「双方同时 Like 会不会建出两个会话」和「并发 Like 会不会超额扣额度」——
// 全靠数据库的唯一约束与条件更新保证。用 mock 测这些等于什么都没测。
//
// 跑法：
//   TEST_DSN="host=127.0.0.1 port=5433 user=mutual dbname=mutual sslmode=disable" \
//     go test ./internal/service/ -run Integration -v
//
// 没设 TEST_DSN 时整体跳过，不会污染 CI 或别人的环境。
func testDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("TEST_DSN")
	if dsn == "" {
		t.Skip("未设置 TEST_DSN，跳过集成测试")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("连接测试库失败: %v", err)
	}
	return db
}

func testCfg() *config.Config {
	tz, _ := time.LoadLocation("Asia/Shanghai")
	return &config.Config{
		Env:            "dev",
		DailyLikeLimit: 10,
		TZ:             tz,
	}
}

// seedUser 造一个完成了 Onboarding 的用户。
func seedUser(t *testing.T, db *gorm.DB, phone string, gender int16, height int16) *model.User {
	t.Helper()
	g := gender
	now := time.Now()
	u := &model.User{
		Phone:       phone,
		PasswordHash: "x",
		Nickname:    "测试" + phone[len(phone)-4:],
		Gender:      &g,
		Birthday:    time.Date(1996, 6, 6, 0, 0, 0, 0, time.UTC),
		Status:      model.UserActive,
		OnboardedAt: &now,
	}
	if err := db.Create(u).Error; err != nil {
		t.Fatalf("造用户失败: %v", err)
	}

	p := &model.UserProfile{
		UserID: u.ID, HeightCm: height,
		HometownProv: "浙江省", HometownCity: "杭州市",
		CityProv: "浙江省", CityCity: "杭州市",
		Occupation: "互联网", Smoking: 1, Drinking: 2,
		IncomeRange: 4, Education: 3,
		EldercarePressure: 2, HasHouse: 2, IsDink: 2,
	}
	if err := db.Create(p).Error; err != nil {
		t.Fatalf("造画像失败: %v", err)
	}

	// 卡池要求目标有已过审的照片与头像
	db.Create(&model.UserAvatar{UserID: u.ID, URL: "x", AuditStatus: model.AuditApproved})
	db.Create(&model.UserPhoto{UserID: u.ID, URL: "x", SortOrder: 1, AuditStatus: model.AuditApproved, Visibility: "public"})
	return u
}

func cleanUsers(t *testing.T, db *gorm.DB, ids ...int64) {
	t.Helper()
	t.Cleanup(func() {
		for _, id := range ids {
			db.Exec(`DELETE FROM audit_logs WHERE target_id = ?`, id)
			db.Exec(`DELETE FROM users WHERE id = ?`, id) // 级联删除其余表
		}
	})
}

// ---------------------------------------------------------------------------
// 测试 1：双方并发 Like，只能产生一条配对与一个会话
// ---------------------------------------------------------------------------

func TestIntegrationConcurrentMatchIsIdempotent(t *testing.T) {
	db := testDB(t)
	cfg := testCfg()
	ctx := context.Background()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)
	a := seedUser(t, db, "138"+suffix, model.GenderMale, 178)
	b := seedUser(t, db, "139"+suffix, model.GenderFemale, 165)
	cleanUsers(t, db, a.ID, b.ID)

	svc := NewActionService(db, cfg, nil, NewExposureService(db))

	// 双方同时发起 Like。
	// 没有唯一约束兜底的话，这里会建出两条 match 和两个 conversation。
	var wg sync.WaitGroup
	start := make(chan struct{})
	errs := make([]error, 2)
	wg.Add(2)

	go func() {
		defer wg.Done()
		<-start
		_, errs[0] = svc.Do(ctx, ActionInput{
			FromUser: a.ID, ToUser: b.ID, Action: model.ActionLike, Source: model.SourceCard,
		})
	}()
	go func() {
		defer wg.Done()
		<-start
		_, errs[1] = svc.Do(ctx, ActionInput{
			FromUser: b.ID, ToUser: a.ID, Action: model.ActionLike, Source: model.SourceCard,
		})
	}()
	close(start)
	wg.Wait()

	for i, err := range errs {
		if err != nil && err != ErrQuotaExhausted {
			t.Fatalf("第 %d 个 goroutine 出错: %v", i, err)
		}
	}

	lo, hi := orderPair(a.ID, b.ID)

	var matchCount int64
	db.Model(&model.MatchRecord{}).Where("user_a = ? AND user_b = ?", lo, hi).Count(&matchCount)
	if matchCount != 1 {
		t.Errorf("配对记录应为 1 条，实际 %d 条 —— 唯一约束或判重逻辑失效", matchCount)
	}

	var convCount int64
	db.Model(&model.Conversation{}).
		Where("(user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)", lo, hi, hi, lo).
		Count(&convCount)
	if convCount != 1 {
		t.Errorf("会话应为 1 个，实际 %d 个 —— 并发下重复建会话了", convCount)
	}
}

// ---------------------------------------------------------------------------
// 测试 2：并发 Like 不能超额扣额度
// ---------------------------------------------------------------------------

func TestIntegrationQuotaNotOverConsumed(t *testing.T) {
	db := testDB(t)
	cfg := testCfg()
	cfg.DailyLikeLimit = 5
	ctx := context.Background()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)
	me := seedUser(t, db, "137"+suffix, model.GenderMale, 178)
	cleanUsers(t, db, me.ID)

	targets := make([]*model.User, 0, 12)
	for i := 0; i < 12; i++ {
		g := model.GenderFemale
		ph := fmt.Sprintf("136%02d%s", i, suffix[:6])
		tu := seedUser(t, db, ph, g, 165)
		targets = append(targets, tu)
		cleanUsers(t, db, tu.ID)
	}

	svc := NewActionService(db, cfg, nil, NewExposureService(db))

	// 12 个 goroutine 抢 5 个额度
	var wg sync.WaitGroup
	start := make(chan struct{})
	var okCount, quotaErrCount int
	var mu sync.Mutex

	for _, tu := range targets {
		wg.Add(1)
		go func(toID int64) {
			defer wg.Done()
			<-start
			_, err := svc.Do(ctx, ActionInput{
				FromUser: me.ID, ToUser: toID, Action: model.ActionLike, Source: model.SourceCard,
			})
			mu.Lock()
			defer mu.Unlock()
			switch err {
			case nil:
				okCount++
			case ErrQuotaExhausted:
				quotaErrCount++
			default:
				t.Errorf("非预期错误: %v", err)
			}
		}(tu.ID)
	}
	close(start)
	wg.Wait()

	if okCount != 5 {
		t.Errorf("应恰好成功 5 次，实际 %d 次", okCount)
	}
	if quotaErrCount != 7 {
		t.Errorf("应恰好 7 次额度不足，实际 %d 次", quotaErrCount)
	}

	var q model.DailyQuota
	if err := db.Where("user_id = ? AND quota_date = ?", me.ID, cfg.Today()).First(&q).Error; err != nil {
		t.Fatalf("查额度失败: %v", err)
	}
	if q.UsedLikeCount != 5 {
		t.Errorf("已用额度应为 5，实际 %d —— 并发下超额扣减了", q.UsedLikeCount)
	}

	// 落库的 Like 数也要与额度一致，不能出现「扣了额度但没写动作」
	var actionCount int64
	db.Model(&model.UserAction{}).
		Where("from_user = ? AND action = ?", me.ID, model.ActionLike).Count(&actionCount)
	if actionCount != 5 {
		t.Errorf("Like 动作应为 5 条，实际 %d 条", actionCount)
	}
}

// ---------------------------------------------------------------------------
// 测试 3：重复 Like 幂等且不重复扣额度
// ---------------------------------------------------------------------------

func TestIntegrationDuplicateLikeIsIdempotent(t *testing.T) {
	db := testDB(t)
	cfg := testCfg()
	ctx := context.Background()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)
	a := seedUser(t, db, "135"+suffix, model.GenderMale, 178)
	b := seedUser(t, db, "134"+suffix, model.GenderFemale, 165)
	cleanUsers(t, db, a.ID, b.ID)

	svc := NewActionService(db, cfg, nil, NewExposureService(db))

	r1, err := svc.Do(ctx, ActionInput{FromUser: a.ID, ToUser: b.ID, Action: model.ActionLike, Source: model.SourceCard})
	if err != nil {
		t.Fatalf("首次 Like 失败: %v", err)
	}
	if r1.QuotaRemain != 9 {
		t.Errorf("首次 Like 后额度应为 9，实际 %d", r1.QuotaRemain)
	}

	r2, err := svc.Do(ctx, ActionInput{FromUser: a.ID, ToUser: b.ID, Action: model.ActionLike, Source: model.SourceCard})
	if err != nil {
		t.Fatalf("重复 Like 失败: %v", err)
	}
	if !r2.AlreadyActed {
		t.Error("重复 Like 应标记 AlreadyActed —— 说明 ON CONFLICT 判重没生效")
	}
	if r2.QuotaRemain != 9 {
		t.Errorf("重复 Like 不应扣额度，实际剩余 %d —— 额度被多扣了", r2.QuotaRemain)
	}
}

// ---------------------------------------------------------------------------
// 测试 4：消息幂等（同一 clientMsgId 不产生重复消息）
// ---------------------------------------------------------------------------

func TestIntegrationMessageIdempotent(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)
	a := seedUser(t, db, "133"+suffix, model.GenderMale, 178)
	b := seedUser(t, db, "132"+suffix, model.GenderFemale, 165)
	cleanUsers(t, db, a.ID, b.ID)

	lo, hi := orderPair(a.ID, b.ID)
	m := &model.MatchRecord{UserA: lo, UserB: hi, Status: model.MatchActive}
	if err := db.Create(m).Error; err != nil {
		t.Fatalf("建配对失败: %v", err)
	}
	conv := &model.Conversation{MatchID: m.ID, UserA: lo, UserB: hi, Status: model.ConvActive}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("建会话失败: %v", err)
	}

	svc := NewChatService(db)
	in := SendInput{
		UserID: a.ID, ConversationID: conv.ID,
		MsgType: "text", Content: "你好", ClientMsgID: "cm-1",
	}

	m1, err := svc.Send(ctx, in)
	if err != nil {
		t.Fatalf("首次发送失败: %v", err)
	}
	if m1.ID == 0 {
		t.Fatal("首次发送返回的 id 为 0 —— 插入没有真正落库")
	}

	m2, err := svc.Send(ctx, in)
	if err != nil {
		t.Fatalf("重发失败: %v", err)
	}
	if m2.ID != m1.ID {
		t.Errorf("重复 clientMsgId 应返回同一条消息：首次 id=%d，重发 id=%d", m1.ID, m2.ID)
	}
	if m2.ID == 0 {
		t.Error("重发返回 id=0 —— ON CONFLICT 判重逻辑失效（这正是 RowsAffected 不可信的坑）")
	}

	var count int64
	db.Model(&model.Message{}).Where("conversation_id = ?", conv.ID).Count(&count)
	if count != 1 {
		t.Errorf("应只有 1 条消息，实际 %d 条", count)
	}

	// 重发不应把未读数加两次
	var after model.Conversation
	db.First(&after, conv.ID)
	if after.UnreadB != 1 {
		t.Errorf("对方未读数应为 1，实际 %d —— 重复发送污染了未读计数", after.UnreadB)
	}
}

// ---------------------------------------------------------------------------
// 测试 5：曝光统计真的在写（而不是只被读）
// ---------------------------------------------------------------------------

func TestIntegrationExposureIsRecorded(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)
	viewer := seedUser(t, db, "128"+suffix, model.GenderMale, 178)
	target := seedUser(t, db, "129"+suffix, model.GenderFemale, 165)
	cleanUsers(t, db, viewer.ID, target.ID)

	exp := NewExposureService(db)

	// 同步跑一遍（真实路径是异步的，测试里直接调内部写入逻辑太绕，
	// 这里用「调用后轮询等它落库」的方式，顺便验证了异步不会丢）
	exp.RecordExposures([]int64{target.ID, target.ID, target.ID})
	exp.Bump(target.ID, "like")
	exp.Bump(target.ID, "visit")

	deadline := time.Now().Add(3 * time.Second)
	var exposed, liked, visited int
	for time.Now().Before(deadline) {
		db.Raw(`SELECT exposed_count, liked_count, visited_count FROM exposure_stats
		        WHERE user_id = ? AND stat_date = CURRENT_DATE`, target.ID).
			Row().Scan(&exposed, &liked, &visited)
		if exposed == 3 && liked == 1 && visited == 1 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	if exposed != 3 {
		t.Errorf("曝光次数应为 3，实际 %d —— 统计没落库", exposed)
	}
	if liked != 1 {
		t.Errorf("被喜欢次数应为 1，实际 %d", liked)
	}
	if visited != 1 {
		t.Errorf("被访问次数应为 1，实际 %d", visited)
	}

	// 同一天重复写应该是累加而不是新增行
	var rows int64
	db.Model(&model.ExposureStat{}).Where("user_id = ?", target.ID).Count(&rows)
	if rows != 1 {
		t.Errorf("同一天应只有一行，实际 %d 行 —— ON CONFLICT 没生效", rows)
	}

	_ = ctx
}

// ---------------------------------------------------------------------------
// 测试 6：曝光量真的影响排序
// ---------------------------------------------------------------------------

func TestIntegrationExposureAffectsRanking(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)
	me := seedUser(t, db, "126"+suffix, model.GenderMale, 178)
	cleanUsers(t, db, me.ID)

	// 造两个条件完全相同的候选人，唯一差别是其中一人的历史曝光量
	fresh := seedUser(t, db, "1271"+suffix[:5], model.GenderFemale, 165)
	hot := seedUser(t, db, "1272"+suffix[:5], model.GenderFemale, 165)
	cleanUsers(t, db, fresh.ID, hot.ID)

	// 给 hot 堆上大量曝光（超过 saturation，触发满额降权）
	today := time.Now().Format("2006-01-02")
	if err := db.Exec(`INSERT INTO exposure_stats (user_id, stat_date, exposed_count)
	                   VALUES (?, ?, ?)`, hot.ID, today, exposureSaturation*2).Error; err != nil {
		t.Fatalf("造曝光数据失败: %v", err)
	}

	disc := NewDiscoveryService(db, NewProfileService(db, NewExposureService(db)), NewExposureService(db))
	cards, err := disc.Cards(ctx, me.ID, 10)
	if err != nil {
		t.Fatalf("拉卡片失败: %v", err)
	}

	var freshIdx, hotIdx = -1, -1
	for i, c := range cards {
		if c.UserID == fresh.ID {
			freshIdx = i
		}
		if c.UserID == hot.ID {
			hotIdx = i
		}
	}
	if freshIdx < 0 || hotIdx < 0 {
		t.Fatalf("两个候选人应都出现在卡池里（fresh=%d hot=%d）", freshIdx, hotIdx)
	}
	if freshIdx > hotIdx {
		t.Errorf("曝光少的应排在前面：fresh 在第 %d 位，hot 在第 %d 位 —— 均衡没生效",
			freshIdx, hotIdx)
	}
}

// ---------------------------------------------------------------------------
// 测试 7：解除配对后会话只读
// ---------------------------------------------------------------------------

func TestIntegrationUnmatchFreezesConversation(t *testing.T) {
	db := testDB(t)
	cfg := testCfg()
	ctx := context.Background()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)
	a := seedUser(t, db, "131"+suffix, model.GenderMale, 178)
	b := seedUser(t, db, "130"+suffix, model.GenderFemale, 165)
	cleanUsers(t, db, a.ID, b.ID)

	lo, hi := orderPair(a.ID, b.ID)
	m := &model.MatchRecord{UserA: lo, UserB: hi, Status: model.MatchActive}
	db.Create(m)
	conv := &model.Conversation{MatchID: m.ID, UserA: lo, UserB: hi, Status: model.ConvActive}
	db.Create(conv)

	svc := NewActionService(db, cfg, nil, NewExposureService(db))
	if err := svc.Unmatch(ctx, a.ID, m.ID); err != nil {
		t.Fatalf("解除配对失败: %v", err)
	}

	var got model.Conversation
	db.First(&got, conv.ID)
	if got.Status != model.ConvReadonly {
		t.Errorf("解除后会话应为 readonly，实际 %s", got.Status)
	}

	chat := NewChatService(db)
	if _, err := chat.Send(ctx, SendInput{
		UserID: a.ID, ConversationID: conv.ID, MsgType: "text",
		Content: "还能发吗", ClientMsgID: "x-1",
	}); err != ErrConversationClosed {
		t.Errorf("解除后发消息应被拒，实际错误: %v", err)
	}

	// 历史消息仍可读（只读不等于删除）
	msgs, err := chat.Messages(ctx, a.ID, conv.ID, 0, 30)
	if err != nil {
		t.Errorf("解除后历史消息应仍可读，实际报错: %v", err)
	}
	if msgs == nil {
		t.Error("历史消息返回 nil，应为空数组")
	}
}
