-- ============================================================================
-- 相悦 Mutual · 数据模型 DDL
-- 对应 PRD：index.html（相悦 Mutual 产品需求文档 v1.5）
-- 生成日期：2026-10-09
-- 目标数据库：PostgreSQL 12+
--
-- 重要约定（实现时请遵守，否则会出现 PRD 里没有的 bug）：
--
--   1. 表名用复数 users 而非 user —— USER 是 PostgreSQL 保留字，
--      建表时若不加引号会直接语法错误；加引号又会让后续每个查询都要
--      写 "user"，非常痛苦。
--
--   2. 枚举一律用 VARCHAR + CHECK 约束，不用 PG 原生 ENUM。
--      原生 ENUM 增删值要 ALTER TYPE，迁移和回滚都很麻烦；
--      CHECK 约束改起来只是 drop/add constraint。
--      需要"有序"的字段（学历、收入档位）用 SMALLINT，便于范围比较。
--
--   3. 位置只存 geohash，不存经纬度。见 user_profiles.geo_hash 的注释。
--
--   4. 额度是"单一池"：划卡 / 广场 / 回 Like 共用一份计数。
--      见 daily_quotas。
--
--   5. 配对记录做规范化存储（user_a < user_b），保证同一对用户
--      全局只有一条记录。见 match_records。
--
--   6. 时间统一 TIMESTAMPTZ，服务端存 UTC；"哪一天"的判定由应用层按
--      北京时间（UTC+8）计算后写入 daily_quotas.quota_date。
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. 账号
-- ---------------------------------------------------------------------------

CREATE TABLE users (
    id              BIGSERIAL     PRIMARY KEY,
    phone           VARCHAR(11)   NOT NULL,
    password_hash   VARCHAR(255)  NOT NULL,          -- bcrypt/argon2，绝不明文
    nickname        VARCHAR(32)   NOT NULL,
    gender          SMALLINT      NOT NULL,          -- 1=男 2=女，注册后锁定
    birthday        DATE          NOT NULL,          -- 对外只展示年龄
    status          VARCHAR(16)   NOT NULL DEFAULT 'registered',
    device_id       VARCHAR(128),
    register_ip     INET,
    last_login_at   TIMESTAMPTZ,
    onboarded_at    TIMESTAMPTZ,                     -- 走完五步的时间，NULL=未完成
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT uq_users_phone   UNIQUE (phone),
    CONSTRAINT ck_users_gender  CHECK (gender IN (1, 2)),
    CONSTRAINT ck_users_status  CHECK (
        status IN ('registered', 'active', 'frozen', 'banned', 'deleted')
    )
);

COMMENT ON COLUMN users.status IS
    'registered=已注册未完成Onboarding; active=正常; frozen=举报待审冻结; banned=封禁; deleted=已注销';
-- PRD 3.3：五步全部不可跳过。此字段为 NULL 时，
-- 接口层必须拦截划卡 / 广场 / 聊天，只放行"继续填写"。
COMMENT ON COLUMN users.onboarded_at IS '完成 Onboarding 五步的时间；NULL=未完成';

-- 登录与风控
CREATE INDEX idx_users_status      ON users (status) WHERE status <> 'deleted';
CREATE INDEX idx_users_device      ON users (device_id) WHERE device_id IS NOT NULL;
CREATE INDEX idx_users_created     ON users (created_at DESC);


-- ---------------------------------------------------------------------------
-- 2. 本人画像
-- ---------------------------------------------------------------------------

CREATE TABLE user_profiles (
    user_id             BIGINT       PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

    height_cm           SMALLINT     NOT NULL,
    weight_kg           SMALLINT,
    hometown_prov       VARCHAR(16)  NOT NULL,       -- 家乡（省）
    hometown_city       VARCHAR(32)  NOT NULL,
    city_prov           VARCHAR(16)  NOT NULL,       -- 现居地
    city_city           VARCHAR(32)  NOT NULL,
    city_district       VARCHAR(32),

    -- 位置：只存粗粒度 geohash，不存经纬度。
    -- 5 位 geohash ≈ 4.9km × 4.9km，够算"约几公里"，又无法反推具体住址。
    -- 距离由 geohash 中心点估算，并以区间形式展示（如「3–5 km」）。
    -- 若将来需要库内做地理检索，再考虑引入 PostGIS；当前用不上。
    geo_hash            VARCHAR(8),

    occupation          VARCHAR(24)  NOT NULL,
    occupation_other    VARCHAR(64),                 -- 职业选"其他"时的补充
    mbti                VARCHAR(4),                  -- NULL=未填；'NONE'=选了"不知道"（避免 CHAR 补空格）
    smoking             SMALLINT     NOT NULL,       -- 1=不抽 2=偶尔 3=经常
    drinking            SMALLINT     NOT NULL,       -- 1=不喝 2=偶尔 3=经常
    income_range        SMALLINT     NOT NULL,       -- 见下方 CHECK
    education           SMALLINT     NOT NULL,       -- 1=高中及以下 … 5=博士
    school              VARCHAR(64),                 -- 选填
    company             VARCHAR(64),                 -- 选填
    is_only_child       BOOLEAN      NOT NULL,       -- 是否独生
    eldercare_pressure  SMALLINT     NOT NULL,       -- 1=有 2=无 3=暂无考虑
    has_car             BOOLEAN      NOT NULL,
    has_house           SMALLINT     NOT NULL,       -- 1=无 2=有 3=有贷款
    is_dink             SMALLINT     NOT NULL,       -- 1=是 2=否 3=暂不考虑

    -- 可见性开关（PRD 第 15 章：填了 ≠ 公开）
    weight_public       BOOLEAN      NOT NULL DEFAULT FALSE,
    income_public       BOOLEAN      NOT NULL DEFAULT FALSE,
    company_public      BOOLEAN      NOT NULL DEFAULT FALSE,

    completeness        SMALLINT     NOT NULL DEFAULT 0,  -- 0-100，走完五步=85
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_prof_height   CHECK (height_cm BETWEEN 130 AND 230),
    CONSTRAINT ck_prof_weight   CHECK (weight_kg IS NULL OR weight_kg BETWEEN 30 AND 200),
    CONSTRAINT ck_prof_smoking  CHECK (smoking  IN (1, 2, 3)),
    CONSTRAINT ck_prof_drinking CHECK (drinking IN (1, 2, 3)),
    CONSTRAINT ck_prof_income   CHECK (income_range IN (1,2,3,4,5,6,7)),
    CONSTRAINT ck_prof_edu      CHECK (education IN (1, 2, 3, 4, 5)),
    CONSTRAINT ck_prof_elder    CHECK (eldercare_pressure IN (1, 2, 3)),
    CONSTRAINT ck_prof_house    CHECK (has_house IN (1, 2, 3)),
    CONSTRAINT ck_prof_dink     CHECK (is_dink IN (1, 2, 3)),
    CONSTRAINT ck_prof_complete CHECK (completeness BETWEEN 0 AND 100)
);

COMMENT ON COLUMN user_profiles.income_range IS
    '1=10万以下 2=10-20 3=20-30 4=30-50 5=50-100 6=100万以上 7=不便透露';
COMMENT ON COLUMN user_profiles.education IS
    '1=高中及以下 2=大专 3=本科 4=硕士 5=博士';

-- 广场检索索引：给每个可筛选字段建【单列】索引，由 PG 的 BitmapAnd 组合。
-- 详见文件末尾「检索方案」说明。
CREATE INDEX idx_prof_city      ON user_profiles (city_prov, city_city);
CREATE INDEX idx_prof_height    ON user_profiles (height_cm);
CREATE INDEX idx_prof_edu       ON user_profiles (education);
CREATE INDEX idx_prof_income    ON user_profiles (income_range);
CREATE INDEX idx_prof_geo       ON user_profiles (geo_hash);


-- ---------------------------------------------------------------------------
-- 3. 兴趣（每用户恰好 3 条，且每条必须有文字介绍）
-- ---------------------------------------------------------------------------

CREATE TABLE user_hobbies (
    id          BIGSERIAL    PRIMARY KEY,
    user_id     BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(32)  NOT NULL,
    description VARCHAR(500) NOT NULL,               -- 10-200 字，必填
    sort_order  SMALLINT     NOT NULL,               -- 1/2/3

    CONSTRAINT uq_hobby_order UNIQUE (user_id, sort_order),
    CONSTRAINT ck_hobby_order CHECK (sort_order BETWEEN 1 AND 3)
);
CREATE INDEX idx_hobby_user ON user_hobbies (user_id);


-- ---------------------------------------------------------------------------
-- 4. 两段自述文字
-- ---------------------------------------------------------------------------

CREATE TABLE user_texts (
    user_id       BIGINT       PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    about_me      VARCHAR(1000),                     -- 关于我，20-500 字，必填
    expect_partner VARCHAR(1000),                    -- 期待的那个他/她，20-500 字，必填
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------------
-- 5. 相册（≤9 张，可拖拽排序，第 1 张为主图）
-- ---------------------------------------------------------------------------

CREATE TABLE user_photos (
    id            BIGSERIAL    PRIMARY KEY,
    user_id       BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url           VARCHAR(512) NOT NULL,
    sort_order    SMALLINT     NOT NULL,             -- 1=主图
    audit_status  VARCHAR(16)  NOT NULL DEFAULT 'pending',
    visibility    VARCHAR(16)  NOT NULL DEFAULT 'public',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_photo_audit  CHECK (audit_status IN ('pending','approved','rejected')),
    CONSTRAINT ck_photo_vis    CHECK (visibility IN ('public','match_only')),
    CONSTRAINT ck_photo_order  CHECK (sort_order BETWEEN 1 AND 9),
    -- 同一用户的顺序号唯一，拖拽换序时先置临时值再更新，或用延迟约束
    CONSTRAINT uq_photo_order  UNIQUE (user_id, sort_order) DEFERRABLE INITIALLY DEFERRED
);

-- 注意：未过审的照片不外显，由查询层的 WHERE audit_status='approved' 保证，
-- 不用 CHECK 约束表达（约束写不出"仅对他人隐藏、自己仍可见"这种语义）。

-- PRD 13.2：最多 9 张，长按拖拽改顺序，第 1 张为主图并用于卡片封面。
-- 拖拽换序建议：先把整组 sort_order 置为负数区间，再一次性写回，
-- 否则实时改序会撞 uq_photo_order 唯一约束。
COMMENT ON TABLE user_photos IS '相册，最多 9 张，第 1 张为主图';
CREATE INDEX idx_photo_user ON user_photos (user_id, sort_order);


-- ---------------------------------------------------------------------------
-- 6. 头像（与相册分离：头像要方图裁切，相册保留原比例）
-- ---------------------------------------------------------------------------

CREATE TABLE user_avatars (
    user_id       BIGINT       PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    url           VARCHAR(512) NOT NULL,
    audit_status  VARCHAR(16)  NOT NULL DEFAULT 'pending',
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_avatar_audit CHECK (audit_status IN ('pending','approved','rejected'))
);


-- ---------------------------------------------------------------------------
-- 7. 伴侣画像（"我要谁"）
-- ---------------------------------------------------------------------------

CREATE TABLE partner_preferences (
    user_id             BIGINT       PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

    height_min          SMALLINT     NOT NULL,
    height_max          SMALLINT     NOT NULL,
    hometown_provinces  TEXT[],                      -- 多选省级行政区；NULL/空=不限
    smoking_accept      SMALLINT     NOT NULL,       -- 1=接受 2=不接受 3=无所谓
    drinking_accept     SMALLINT     NOT NULL,
    income_min          SMALLINT     NOT NULL,       -- 0=不限，其余同 income_range 档位
    income_max          SMALLINT     NOT NULL,
    education_min       SMALLINT     NOT NULL,       -- 0=无要求 1..5
    only_child_accept   SMALLINT     NOT NULL,       -- 1=接受 2=不接受 3=无所谓
    car_prefer          SMALLINT     NOT NULL,       -- 1=希望有 2=无所谓
    house_prefer        SMALLINT     NOT NULL,       -- 1=希望有房 2=无所谓
    dink_accept         SMALLINT     NOT NULL,       -- 1=接受 2=不接受（无"无所谓"）
    tags                TEXT[],                      -- 颜控/智性恋/身材控/财迷/幽默灵魂
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_pref_height   CHECK (height_min BETWEEN 130 AND 230
                                       AND height_max BETWEEN 130 AND 230
                                       AND height_min <= height_max),
    CONSTRAINT ck_pref_smoking  CHECK (smoking_accept  IN (1, 2, 3)),
    CONSTRAINT ck_pref_drinking CHECK (drinking_accept IN (1, 2, 3)),
    CONSTRAINT ck_pref_income   CHECK (income_min >= 0 AND income_max <= 7
                                       AND income_min <= income_max),
    CONSTRAINT ck_pref_edu      CHECK (education_min BETWEEN 0 AND 5),
    CONSTRAINT ck_pref_only     CHECK (only_child_accept IN (1, 2, 3)),
    CONSTRAINT ck_pref_car      CHECK (car_prefer   IN (1, 2)),
    CONSTRAINT ck_pref_house    CHECK (house_prefer IN (1, 2)),
    CONSTRAINT ck_pref_dink     CHECK (dink_accept  IN (1, 2))
);

-- PRD 7.2：这些偏好是【软加权】而非硬过滤。只有性别、年龄、距离、账号状态
-- 是硬过滤；其余不满足仅降权，仍可能出现在卡池中——否则早期用户池会直接归零。
COMMENT ON TABLE partner_preferences IS '伴侣画像，全部为软加权条件';


-- ---------------------------------------------------------------------------
-- 8. 动作流水（Like / Pass / Visit）
-- ---------------------------------------------------------------------------

CREATE TABLE user_actions (
    id          BIGSERIAL    PRIMARY KEY,
    from_user   BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user     BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action      VARCHAR(8)   NOT NULL,               -- like / pass / visit
    source      VARCHAR(16)  NOT NULL,               -- card / plaza / likes_me
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_act_action CHECK (action IN ('like', 'pass', 'visit')),
    CONSTRAINT ck_act_source CHECK (source IN ('card', 'plaza', 'likes_me')),
    CONSTRAINT ck_act_notself CHECK (from_user <> to_user),
    -- 幂等：同一个人对同一个人的同一种动作只有一条
    CONSTRAINT uq_act UNIQUE (from_user, to_user, action)
);

-- Visit 记录用 UPSERT（命中唯一键只更新 updated_at），因此"谁看过我"里
-- 同一人只占一行，不会因为反复访问而刷屏。
COMMENT ON TABLE user_actions IS '动作流水：like / pass / visit';

-- 支撑「谁喜欢我」「谁看过我」的倒序查询
CREATE INDEX idx_act_to_like  ON user_actions (to_user, created_at DESC) WHERE action = 'like';
CREATE INDEX idx_act_to_visit ON user_actions (to_user, updated_at DESC) WHERE action = 'visit';
CREATE INDEX idx_act_from     ON user_actions (from_user, action);


-- ---------------------------------------------------------------------------
-- 9. 配对（规范化：user_a < user_b，保证全局唯一）
-- ---------------------------------------------------------------------------

CREATE TABLE match_records (
    id          BIGSERIAL    PRIMARY KEY,
    user_a      BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 较小的 id
    user_b      BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 较大的 id
    status      VARCHAR(16)  NOT NULL DEFAULT 'active',
    matched_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    unmatched_at TIMESTAMPTZ,
    unmatched_by BIGINT,                             -- 谁发起的解除

    CONSTRAINT uq_match     UNIQUE (user_a, user_b),
    CONSTRAINT ck_match_ord CHECK (user_a < user_b),
    CONSTRAINT ck_match_st  CHECK (status IN ('active', 'unmatched', 'blocked'))
);

-- PRD 9.2：双方同时 Like 时，靠 (user_a,user_b) 唯一约束保证只产生一条记录。
-- 写入用 INSERT ... ON CONFLICT (user_a,user_b) DO NOTHING，并以返回行数
-- 判断"本次是否真正配对成功"，避免并发下重复建会话。
COMMENT ON TABLE match_records IS '配对记录，user_a < user_b 规范化存储';
CREATE INDEX idx_match_a ON match_records (user_a, status);
CREATE INDEX idx_match_b ON match_records (user_b, status);


-- ---------------------------------------------------------------------------
-- 10. 会话与消息
-- ---------------------------------------------------------------------------

CREATE TABLE conversations (
    id              BIGSERIAL    PRIMARY KEY,
    match_id        BIGINT       NOT NULL REFERENCES match_records(id) ON DELETE CASCADE,
    user_a          BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b          BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_message_id BIGINT,
    last_message_at TIMESTAMPTZ,
    unread_a        INTEGER      NOT NULL DEFAULT 0,
    unread_b        INTEGER      NOT NULL DEFAULT 0,
    status          VARCHAR(16)  NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_conv_match UNIQUE (match_id),
    CONSTRAINT ck_conv_st    CHECK (status IN ('active', 'readonly', 'frozen'))
);

-- PRD 12.1：解除配对后置 readonly（历史可查、不可再发）；拉黑后置 frozen。
COMMENT ON COLUMN conversations.status IS 'active / readonly(解除配对) / frozen(拉黑)';


CREATE TABLE messages (
    id              BIGSERIAL    PRIMARY KEY,
    conversation_id BIGINT       NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    from_user       BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    msg_type        VARCHAR(8)   NOT NULL,           -- text / image / system
    content         TEXT,
    client_msg_id   VARCHAR(64),                     -- 客户端幂等键
    seq             BIGINT       NOT NULL,           -- 会话内单调递增，保证顺序
    status          VARCHAR(16)  NOT NULL DEFAULT 'sent',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_msg_type   CHECK (msg_type IN ('text', 'image', 'system')),
    CONSTRAINT ck_msg_status CHECK (status IN ('sent', 'delivered', 'read')),
    CONSTRAINT uq_msg_seq    UNIQUE (conversation_id, seq),
    CONSTRAINT uq_msg_client UNIQUE (conversation_id, client_msg_id)
);

-- PRD 12.4：client_msg_id 保证重发不产生重复消息；seq 由服务端统一分配，
-- 客户端按 seq 排序展示，避免网络乱序。
COMMENT ON TABLE messages IS '会话消息，客户端幂等 + 服务端定序';
CREATE INDEX idx_msg_conv ON messages (conversation_id, seq DESC);


-- ---------------------------------------------------------------------------
-- 11. 每日额度（单一池）
-- ---------------------------------------------------------------------------

CREATE TABLE daily_quotas (
    id              BIGSERIAL    PRIMARY KEY,
    user_id         BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quota_date      DATE         NOT NULL,           -- 按【北京时间】计算出的日期
    used_like_count SMALLINT     NOT NULL DEFAULT 0,
    limit_count     SMALLINT     NOT NULL DEFAULT 10,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_quota      UNIQUE (user_id, quota_date),
    CONSTRAINT ck_quota_used CHECK (used_like_count >= 0 AND used_like_count <= limit_count)
);

-- PRD 8.1 / 10.3：划卡、广场、回 Like 三者的 Like 共用这一份计数（单一池）。
--
-- 关键实现点：
--   ① quota_date 必须由应用层按北京时间（UTC+8）计算，不能直接用 CURRENT_DATE
--      （服务器若为 UTC，会在北京时间早上 8 点前后算错一天）；
--   ② 扣减必须与 Like 写入在同一事务，并用条件更新防并发超额：
--        UPDATE daily_quotas SET used_like_count = used_like_count + 1
--        WHERE user_id = $1 AND quota_date = $2 AND used_like_count < limit_count
--      受影响行数为 0 即表示额度已用完，回滚事务并返回"今日额度已满"。
COMMENT ON TABLE daily_quotas IS '每日 Like 额度，划卡/广场/回Like 共用的单一池';
CREATE INDEX idx_quota_user ON daily_quotas (user_id, quota_date);


-- ---------------------------------------------------------------------------
-- 12. 曝光统计（用于推荐公平性调控，PRD 8.4）
-- ---------------------------------------------------------------------------

CREATE TABLE exposure_stats (
    id            BIGSERIAL  PRIMARY KEY,
    user_id       BIGINT     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stat_date     DATE       NOT NULL,
    exposed_count INTEGER    NOT NULL DEFAULT 0,     -- 被展示在别人卡池的次数
    liked_count   INTEGER    NOT NULL DEFAULT 0,     -- 被 Like 次数
    visited_count INTEGER    NOT NULL DEFAULT 0,     -- 被访问主页次数

    CONSTRAINT uq_expo UNIQUE (user_id, stat_date)
);
CREATE INDEX idx_expo_date ON exposure_stats (stat_date, exposed_count);


-- ---------------------------------------------------------------------------
-- 13. 举报与拉黑
-- ---------------------------------------------------------------------------

CREATE TABLE reports (
    id           BIGSERIAL    PRIMARY KEY,
    reporter_id  BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_user  BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type  VARCHAR(16)  NOT NULL,              -- user / photo / message
    target_id    BIGINT,                             -- photo_id 或 message_id
    reason       VARCHAR(32)  NOT NULL,
    detail       VARCHAR(500),
    evidence     TEXT[],                             -- 截图 url 列表
    status       VARCHAR(16)  NOT NULL DEFAULT 'pending',
    handled_by   BIGINT,
    handled_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_rep_type   CHECK (target_type IN ('user', 'photo', 'message')),
    CONSTRAINT ck_rep_reason CHECK (reason IN (
        'porn', 'fraud', 'harassment', 'fake_info', 'ad', 'minor', 'other'
    )),
    CONSTRAINT ck_rep_status CHECK (status IN ('pending', 'processing', 'resolved', 'rejected'))
);
CREATE INDEX idx_rep_pending ON reports (status, created_at) WHERE status = 'pending';
CREATE INDEX idx_rep_target  ON reports (target_user);


CREATE TABLE blocks (
    id              BIGSERIAL    PRIMARY KEY,
    user_id         BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_block     UNIQUE (user_id, blocked_user_id),
    CONSTRAINT ck_block_self CHECK (user_id <> blocked_user_id)
);
-- 查"我拉黑了谁"和"谁拉黑了我"都要快：卡池过滤时会双向查
CREATE INDEX idx_block_user    ON blocks (user_id);
CREATE INDEX idx_block_blocked ON blocks (blocked_user_id);


-- ---------------------------------------------------------------------------
-- 14. 审核与风控留痕
-- ---------------------------------------------------------------------------

CREATE TABLE audit_logs (
    id          BIGSERIAL    PRIMARY KEY,
    target_type VARCHAR(16)  NOT NULL,               -- user / photo / message / report
    target_id   BIGINT       NOT NULL,
    action      VARCHAR(32)  NOT NULL,               -- approve / reject / freeze / ban ...
    reason      VARCHAR(255),
    operator    VARCHAR(64),                         -- 审核员标识或 system
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_target ON audit_logs (target_type, target_id, created_at DESC);


-- ============================================================================
-- 关键查询的索引覆盖说明
--
-- 【划卡候选池】
--   过滤链：异性 -> 排除自己 -> 排除已 like/pass -> 排除已配对 ->
--           排除拉黑（双向）-> 排除未过审/封禁 -> 距离半径
--   做法：可索引的条件（城市/性别/年龄）先把候选集压到几百人以内，
--        再在应用层按匹配分排序（匹配分是算出来的，走不了索引）。db 侧至少需要：
--        idx_act_from（判断是否已操作）、idx_block_user / idx_block_blocked、
--        idx_prof_geo（距离）。
--
-- 【谁喜欢我】  idx_act_to_like 已覆盖（to_user + created_at DESC，部分索引）
-- 【谁看过我】  idx_act_to_visit 已覆盖
-- 【会话列表】  建议补一条：
--        CREATE INDEX idx_conv_a ON conversations (user_a, last_message_at DESC);
--        CREATE INDEX idx_conv_b ON conversations (user_b, last_message_at DESC);
--      （需要按两个方向分别查，再合并排序；或改为 conversation_members 表）
--
-- 【每日额度】  高频读写，uq_quota 已覆盖点查
-- ============================================================================


-- ============================================================================
-- 可以优化、但当前先不做的地方（避免过度设计）
--
--   1. user_avatars 与 user_profiles 是 1:1 表。从纯性能看，头像可以
--      直接作为 users 的列，省一次 join。分开的好处是审核状态与历史可
--      独立管理。数据量上来后可考虑合并。
--
--   2. conversations 用 user_a/user_b 两列表示参与者，导致"我的会话列表"
--      要 UNION 两个方向。更规范的做法是 conversation_members 关联表，
--      但当前是一对一会话，两列的写法更简单直接。
--
--   3. 广场的检索【全部在 PostgreSQL 内实现，不引入 ES】。做法见下节「检索方案」。
-- ============================================================================


-- ============================================================================
-- 检索方案：广场的多条件检索在 PostgreSQL 内实现（不引入 Elasticsearch）
--
-- 广场有十几个可选筛选维度，看似必须上搜索引擎。但每个维度的取值都是
-- 【低势基数】——性别 2 种、学历 5 档、收入 7 档、省份 34 个、MBTI 17 种。
-- 这类条件恰好是 PostgreSQL BitmapAnd 的强项。
--
-- 【一】索引策略：单列索引 + BitmapAnd
--   给每个高频筛选字段建【单列】B-tree 索引（见上文 idx_prof_*）。
--   查询命中多个条件时，优化器自动把多个索引的位图求交集，
--   比堆复合索引灵活——筛选组合是任意的，复合索引只覆盖固定顺序。
--
--   若发现某些组合特别高频，再补【部分索引】缩小体积：
--     CREATE INDEX idx_search_active ON user_profiles (city_prov, education)
--       WHERE ...;   -- 例如只索引活跃且已过审的用户
--
-- 【二】分页：必须用 keyset 游标，禁用 OFFSET
--   深分页时 PG 会扫描并丢弃前 N 行，OFFSET 10000 就已明显变慢。
--     WHERE (score, id) < (?, ?) ORDER BY score DESC, id DESC LIMIT 20
--
-- 【三】模糊搜索：pg_trgm + GIN（支持中文子串）
--     CREATE EXTENSION IF NOT EXISTS pg_trgm;
--     CREATE INDEX idx_search_kw   ON user_profiles USING gin (about_me gin_trgm_ops);
--     CREATE INDEX idx_search_nick ON users         USING gin (nickname gin_trgm_ops);
--
-- 【四】计数：返回估算值或缓存，不做精确 COUNT(*)
--   「找到 328 人」读 EXPLAIN 的行数估算即可，用户不需要精确数字。
--
-- 【五】⚠️ 最大的一个坑：按「匹配分」排序走不了索引
--   匹配分 = 正向偏好 + 反向偏好 + 活跃度，是算出来的，索引里没有。
--   解法是【先把候选集压小】：用可索引的条件（城市/性别/年龄区间）把候选
--   集限制到几百人以内，再在应用层算分排序。若条件给得太宽导致候选集上万，
--   必须在接口层限制「至少选一个高选择性维度」，或对结果集设硬上限。
--   这个约束要写进接口设计，不能等线上慢了才发现。
--
-- 【六】什么时候该重新评估
--   判断标准是实测指标，不是「维度多不多」：用户量过百万、且广场检索
--   P95 持续 > 1s 时再考虑升级。优先顺序：
--     ① 物化只含可筛选字段的宽表并分区
--     ② 把匹配分预计算进宽表（顺带解决【五】的排序问题）
--     ③ 仍然不够，才引入 ES
--   直接跳到 ③ 是过度设计——多一套中间件就多一套同步、一致性、运维成本。
-- ============================================================================
