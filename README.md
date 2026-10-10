# 相悦 Mutual

恋爱交友 App —— 以「**双向意愿**」为核心机制：先把自己的画像和择偶偏好讲清楚，系统按偏好推荐，只有**双方都 Like** 才建立会话。

## 命名

- **相悦** —— 出自「两情相悦」，中文里形容「双方互相喜欢」最准确的一个词，正对应产品「双向 Like 才配对」的核心机制
- **Mutual** —— 语义与「相悦」完全对应

## 文档

| 文件 | 内容 |
|---|---|
| [index.html](index.html) | **产品需求文档 PRD v1.5** —— 21 章，含字段级规格、安全合规、可见性矩阵、数据模型、26 条边界场景、9 项决策记录 |
| [tech-design.html](tech-design.html) | **技术方案与 UI 设计 v1.0** —— 技术选型、架构、设计系统、**五种核心界面的真实 CSS 原型**、动效规范、关键流程设计 |
| [schema.sql](schema.sql) | **数据模型 DDL** —— PostgreSQL，16 张表 / 25 个索引 / 40 个 CHECK 约束 |

> PRD 可直接用浏览器打开，无外部依赖。若要挂成网址，见下方「GitHub Pages」。

## 产品概要

```
手机号 + 密码注册
   → Onboarding 五步（本人画像 / 三个兴趣+文字 / 关于我 / 伴侣画像 / 期待的他）
   → 划卡 + 恋爱广场
   → 双向 Like → 配对 → 聊天
```

旁路功能：**Like & Visit**（谁喜欢我 / 谁看过我）、**个人中心**（改资料 + 九宫格相册拖拽排序）。

## 已确认的核心规则

| 规则 | 取值 |
|---|---|
| 每日 Like 额度 | **10 次**，划卡 / 广场 / 回 Like 共用同一份额度池 |
| 额度计数口径 | 按 **Like 次数**扣，**Pass 与浏览不消耗** |
| 额度重置 | 每日 00:00，**北京时间（UTC+8）** |
| 配对条件 | **双向 Like**（单向 Like 不通知对方，静默进「谁喜欢我」） |
| 匹配范围 | **仅异性**，性别注册后锁定 |
| 解除配对 | **允许**，会话转只读、历史消息保留 |
| 联系方式 | 私聊**不拦截**（仅提示一次）；**公开资料中拦截** |
| 年龄造假 | 本期不做实名核验，仅举报兜底 |
| 「谁喜欢我」 | **免费可见**，不做付费墙 |

## 代码结构

```
mutual-app/
├── index.html          产品需求文档（PRD）
├── tech-design.html    技术方案与 UI 设计
├── schema.sql          PostgreSQL 数据模型 DDL
├── server/             Go 后端
│   ├── cmd/api/        入口
│   ├── internal/
│   │   ├── handler/    HTTP 接入层（参数绑定、错误码映射）
│   │   ├── service/    业务规则 + 事务边界
│   │   ├── model/      GORM 模型
│   │   ├── middleware/ 鉴权、限流、Onboarding 守卫、后台守卫（AdminGuard）
│   │   ├── ws/         WebSocket Hub
│   │   └── infra/      PG / Redis / MinIO
│   └── scripts/e2e.sh  端到端测试（16 个场景 62 项断言）
├── web/                React 前端
│   └── src/
│       ├── pages/      登录 / Onboarding / 发现 / 广场 / 心动 / 聊天 / 我的
│       ├── admin/      后台（/admin）：概览 / 用户 / 会话
│       ├── components/ 卡片栈、配对动画、滚轮选择器、九宫格相册
│       └── lib/api.ts  接口封装
└── deploy/deploy.sh    一键部署（API + 前端 + nginx）
```

## 后台（管理端）

访问 `https://<域名>/admin`。用你自己的账号登录——**没有另做一套账号体系**，
权限由数据库里的 `users.is_admin` 决定：

```sql
UPDATE users SET is_admin = true WHERE phone = '你的手机号';
```

这样做的理由：不给部署再加一个要人工同步的秘密（环境变量、独立的 admin 表都会）。
代价是"谁能进后台"要改库——对一个内部工具来说这正好。接口全部只读
（封禁/删号这类留给运维直接改库，免得再引入一套"后台能改什么"的权限模型）。

| 页面 | 看得到什么 |
|---|---|
| 概览 | 用户/划卡/配对/消息的当日与累计数、四个关键比率（右滑率、**回喜率**、会话开口率、曝光转化）、近 14 天趋势 |
| 用户 | 分页 + 昵称/手机号搜索 + 性别/状态筛选；点进去是这个人完整的资料、相册、兴趣、伴侣偏好 |
| 用户详情 | **TA 划别人**和**别人划 TA** 两个方向的记录（可按喜欢/跳过/看过筛），以及 TA 名下的会话 |
| 会话 | 全部会话列表；点进去是完整聊天记录（左右分栏，按 id 小的一方在左） |

接口在 `/api/v1/admin/*`，全部 GET，挂在 `AdminGuard` 后面。趋势图是纯 SVG
（没有图表库），配色**用脚本验过色盲分离度**——详见 `web/src/admin/charts.tsx` 顶部。

⚠️ `users.is_admin` 这一列是后来加的：生产库是手动 `ALTER TABLE` 加的，
新装环境用 `schema.sql`（里面已经有）。所以**升级已有环境时要补这一步**。

## 本地开发

```bash
# 1) 起 PostgreSQL，建库并导入表结构
createdb mutual && psql mutual -f schema.sql

# 2) 起后端
cd server
go build -o /tmp/mutual-api ./cmd/api
APP_ENV=dev PORT=8080 \
DATABASE_DSN="host=127.0.0.1 port=5432 user=mutual dbname=mutual sslmode=disable" \
JWT_SECRET="dev-secret-at-least-32-characters-long" \
/tmp/mutual-api

# 3) 起前端（已配好 /api 代理，无需改代码）
cd web
npm install --include=dev     # 注意本机 NODE_ENV=production 会跳过 devDependencies
npm run dev                   # http://localhost:5173
```

### 测试

```bash
# 后端集成测试（连真库，会跳过未设置 TEST_DSN 的情况）
cd server
TEST_DSN="host=127.0.0.1 port=5432 user=mutual dbname=mutual sslmode=disable" \
  go test ./internal/service/ -run Integration -v

# 后端端到端
API=http://127.0.0.1:8080 bash server/scripts/e2e.sh

# 前端渲染冒烟
cd web && npm run smoke
```

## 部署

```bash
sudo ./deploy/deploy.sh
```

部署到 `https://jianjiange.site/mutual/`（复用主站证书）。脚本会：构建 → 装 systemd 服务 →
生成 `api.env` → 应用 schema → 合并 nginx 配置 → 验收。首次运行后需要把 `api.env`
里的 `CHANGE_ME`（数据库密码、MinIO 密钥）换成真实值再重启。

## 技术选型

| 层 | 选型 |
|---|---|
| 前端 | React 18 + TypeScript + Vite |
| UI | shadcn/ui（Radix UI + Tailwind CSS） |
| 动效 | Motion（原 Framer Motion）—— 「丝滑」的主要来源 |
| 数据请求 | TanStack Query（乐观更新 + 缓存 + 无限滚动） |
| 后端 | Go 1.22+ / Gin |
| 数据访问 | **GORM**（复杂查询用 `Raw()` 手写 SQL 兜底，见技术方案 9.1 的七条红线） |
| 存储 | PostgreSQL 12+ / Redis 7 / MinIO |
| 检索 | **PostgreSQL 原生**（不引入 ES；单列索引 + BitmapAnd + keyset 分页，见技术方案 9.2） |

详细方案见 [tech-design.html](tech-design.html)。

### 两个约定

- **划卡用按钮点击，不做左右滑动。** 这是有明确理由的产品决策（桌面端可用、误触率低、可访问、易测试），完整论证见技术方案第 7 章。实现时**不要再把滑动手势作为隐藏功能加回来**。
- **DDL 已用 `sqlglot` 的 PostgreSQL 方言实测解析通过**（51 条语句），不是只做了括号配平。

## GitHub Pages

首次启用需人工操作：仓库 **Settings → Pages → Source 选 `Deploy from a branch` → main → `/ (root)`**。
启用后访问 `https://davisu-china.github.io/mutual-app/`。更新 PRD 只需覆盖 `index.html` 后推送到 `main`。

## 开发状态

- [x] 产品需求文档（PRD v1.5）
- [x] 数据模型 DDL
- [x] 技术方案与 UI 设计（v1.0）
- [x] **后端实现** —— 全链路跑通，62 项端到端断言 + 7 项集成测试全过
- [x] **前端实现** —— 全部页面完成，45 项渲染冒烟检查全过
- [x] **曝光均衡** —— 读写两侧都已接上（此前只有 SQL 读、无人写）
- [x] **官方行政区划数据** —— 国家统计局口径，34 省 / 366 市 / 3439 区县
- [x] **全量拼音索引** —— 覆盖全部城市与区县，构建期生成、运行时零依赖
- [ ] 内容审核接入（当前 dev 环境自动过审，生产必须接真实审核服务）
- [ ] 消息推送（离线触达，需要 APNs / FCM 或厂商推送通道）

## 行政区划数据

数据来源 **国家统计局《统计用区划和城乡划分代码》**——行政区划代码的权威出处
（民政部公布的是区划调整公告，不含完整代码表）。

| 层级 | 数量 |
|---|---|
| 省级 | 34（含港澳台） |
| 市级 | 366 |
| 区县级 | 3439 |

**拼音索引在构建期生成**（`scripts/gen-regions.mjs` 用 `pinyin-pro` 一次性算好写死），
所以运行时不需要拼音库，用户的手机也不用现算 3439 条数据的拼音。

**数据包是懒加载的**：完整树 215KB，只在用户打开地区选择器时才拉；
省级名单（0.8KB）单独静态引入给伴侣画像用。主包里 0 处区县名。

更新数据：

```bash
cd web
npm pack china-division && tar xzf china-division-*.tgz
cp package/dist/pca-code.json package/dist/HK-MO-TW.json data-src/
node scripts/gen-regions.mjs
```

## 曝光均衡

推荐排序里的公平性调控，防的是**马太效应**：完全按匹配分排，少数高吸引力用户
会吃掉绝大部分曝光，其余人长期零配对后流失，卡池随之萎缩。

实现是**两层**的：

1. **SQL 层选候选池** —— 按近 7 天曝光量从少到多取前 300 人
   （匹配分算不出来要读对方偏好表，所以只能在应用层算）
2. **应用层算分排序** —— 在池内按匹配度排，同时扣减曝光惩罚、给新用户加权

| 参数 | 值 | 说明 |
|---|---|---|
| 统计窗口 | 7 天 | `exposure_stats` 按天累加 |
| 降权上限 | −0.18 | 刻意压得比新用户加权小——均衡是纠偏，不该盖过匹配度 |
| 新用户加权 | +0.15 | 注册 72 小时内，否则新人拿不到 Like 就流失 |

两条写入路径都是**异步尽力而为**：统计丢了大不了均衡钝一点，不该拖慢划卡。

## 已知待办

| 项 | 说明 |
|---|---|
| 内容审核 | 后端在 dev 环境自动过审照片，**生产环境必须接入内容安全服务**（PRD 14.1） |
| 消息推送 | 目前只有 WebSocket 在线推送，离线触达需要接入厂商推送 |
| 实名认证 | 按决策本期不做（PRD 14.3） |
| 离线曝光落库 | 曝光统计目前直接写库；量大后可改为先写 Redis 计数再定时批量落库 |
