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
│   │   ├── middleware/ 鉴权、限流、Onboarding 守卫
│   │   ├── ws/         WebSocket Hub
│   │   └── infra/      PG / Redis / MinIO
│   └── scripts/e2e.sh  端到端测试（16 个场景 62 项断言）
├── web/                React 前端
│   └── src/
│       ├── pages/      登录 / Onboarding / 发现 / 广场 / 心动 / 聊天 / 我的
│       ├── components/ 卡片栈、配对动画、滚轮选择器、九宫格相册
│       └── lib/api.ts  接口封装
└── deploy/deploy.sh    一键部署（API + 前端 + nginx）
```

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
- [x] **后端实现** —— 全链路跑通，62 项端到端断言 + 5 项并发集成测试全过
- [x] **前端实现** —— 全部页面完成，39 项渲染冒烟检查全过
- [ ] 内容审核接入（当前 dev 环境自动过审，生产必须接真实审核服务）
- [ ] 消息推送（离线触达，需要 APNs / FCM 或厂商推送通道）

## 已知待办

| 项 | 说明 |
|---|---|
| 内容审核 | 后端在 dev 环境自动过审照片，**生产环境必须接入内容安全服务**（PRD 14.1） |
| 拼音索引 | 省市搜索的拼音只覆盖热门城市，生产建议接 `pinyin-pro` 全量生成 |
| 行政区划数据 | 应替换为民政部官方数据或 `china-division` |
| 消息推送 | 目前只有 WebSocket 在线推送，离线触达需要接入厂商推送 |
| 曝光统计 | 表结构已就绪，但推荐排序里的曝光均衡还没接上 |
| 实名认证 | 按决策本期不做（PRD 14.3） |
