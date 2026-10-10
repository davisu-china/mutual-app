# 相悦 · 原生 App（React Native / Expo）

同一套后端（`../server`）的原生客户端，iOS 与 Android 共用一份代码。

## 怎么在手机上跑起来

```bash
git pull                     # 先拿最新的（比如这份文档的修正）
cd mutual-app/mobile
npm install
npx expo start               # ← 不要加 --tunnel
```

手机上装 **Expo Go**（App Store / 应用商店搜得到），扫终端里出现的二维码。
**手机要和电脑在同一个 Wi-Fi 下**，走局域网直连最快，改代码保存后手机会自动刷新。

> ⚠️ **别加 `--tunnel`**：隧道是给「开发机在云上、手机连不到它」的场景用的，
> 多绕一跳公网，慢且容易断（表现为手机上提示 `Cannot connect to Expo CLI`，
> 因为手机连不上 `*.exp.direct`）。本机开发用局域网直连即可。
> 只有当手机和电脑确实不在同一网络（例如手机用流量）时才需要隧道，
> 且首次会提示安装 `@expo/ngrok`。
>
> 局域网也连不上时按这个顺序查：① 手机与电脑是否同一 Wi-Fi（不是访客网络）；
> ② macOS 防火墙是否拦了 node（系统设置 → 网络 → 防火墙，首次运行会弹窗询问，
> 要点「允许」）；③ 重启 `npx expo start`。

打包上架时再走 EAS（`npx eas build`），那时才需要 Expo 账号与证书。

## 接口地址

默认指向线上：`https://mutual.jianjiange.site/api/v1`（见 `src/lib/api.ts`）。
本地起后端调试时用环境变量覆盖：

```bash
EXPO_PUBLIC_API_BASE=http://<你的局域网IP>:8099/api/v1 npx expo start
```

## 目录

```
app/                    expo-router 的页面（文件即路由）
  _layout.tsx           根：手势根容器 / 安全区 / 会话 / 全局提示
  index.tsx             启动分流（未登录 → 登录；未填资料 → 向导）
  login.tsx             登录 / 注册
  (tabs)/               底部五个 Tab：推荐 / 广场 / 心动 / 消息 / 我的
  chat/[id].tsx         聊天室（WebSocket 实时）
  user/[id].tsx         TA 的主页
  onboarding.tsx        资料向导（五步，已完成）
src/
  theme/                设计令牌（与 web/tailwind.config.ts 同一套色值）
  lib/                  api（自动刷新令牌）/ auth / upload / labels
  ui/                   Button / Sheet / WheelPicker / FieldRow / Choice / 反馈
  components/           整图出血的资料卡片、配对成功页
```

## 与 Web 版的关系

- **同一套设计令牌**：色值、圆角、阴影在 `src/theme/index.ts` 与
  `web/tailwind.config.ts` 里必须一致，改配色两边一起改。
- **同一套交互语言**：点一行 → 底部弹层 → 选完收起；长列表用滚轮而不是输入框。
- **划卡：滑动与按钮并存**。右滑喜欢、左滑跳过，同时保留底部按钮——按钮是
  无障碍的兜底（非顶层卡对屏幕阅读器是隐藏的，只有按钮可用）。两条路径走同一个
  `act()`，不做两套状态机。（早先"只用按钮"的产品约束已被推翻，见 git 历史。）

## 资料向导（五步）

`app/onboarding.tsx` + `src/onboarding/`（纯逻辑）+ `src/components/pickers/`（选择器）。

- **每点一次「下一步」就先存服务端，存成功才翻页**。因此填到一半退出能续上：
  下次进来用 `/users/me` 回填（那一组路由刻意没挂 OnboardGuard）。
  唯一回填不了的是**生日**——后端出于隐私标了 `json:"-"`，只给 age。
- **判定与请求体抽在 `src/onboarding/draft.ts`**：这一屏全是原生选择器（滚轮、
  底部弹层、系统相册），jest 里渲染不出真实交互，逻辑留在页面里等于零覆盖。
- **弹层的拖拽手势只挂在把手和标题栏上**（见 `ui/sheet.tsx`）：挂在整块面板上会
  和里面的滚轮/列表抢纵向手势，RNGH 默认优先级更高，里面就滚不动了。
- 选择器一律**标签网格 + 搜索**，不用长滚动列表；院校有三千多所，以搜索为主入口。
- 与 Web 版的差异：MBTI 用 16 型网格（等价，值域相同，Web 是四维滑杆）；
  「期望身高」用双滚轮（Web 是双滑块，`gap=5` 的语义保留）；院校结果上限 30 条。

## 对某个人的操作（举报 / 拉黑 / 解除配对）

都在**对方主页右上角的「⋯」**里（`src/components/user-actions.tsx`）。放这一页而不是
聊天室，是因为它本来就是"和这个人的关系动作"的唯一去处；聊天室标题栏点一下也能到。

- 三个动作都走原生 `Alert` 二次确认——它们都不好撤回。
- ⚠️ 后端语义（别凭直觉改文案，见 `server/internal/service/action.go`）：
  `Block` 幂等，会让匹配变 blocked、会话变 frozen；`Unmatch` 只把会话转**只读**；
  `Unblock` **只删黑名单行，不恢复匹配和会话**——所以拉黑文案如实写"配对无法恢复"。
- 拉黑是**双向阻断**的：之后自己再点进对方主页也会被挡（`PublicProfile` 里
  `isBlocked` 命中即报错），页面会显示服务端给的原话。
- 解配需要 `matchId`，而对方主页只带回 `relation.matched`，所以点解配时会按需查一次
  `GET /matches` 再按 userId 找回来。

## 服务端错误码的一个约定（踩过）

`handler.mapErr` 只认识**哨兵错误**和 `InvalidInputError`，其余一律兜底成
500「服务暂时不可用」并把原消息丢掉。所以 service 层凡是"写给用户看"的错误，
都必须用哨兵或 `invalidInput(...)`——**裸 `errors.New` 会把确定的状态说成服务故障**。
真实踩过两处：拉黑后看对方资料、被封禁的账号登录。

两道测试钉着它：`server/internal/handler/response_test.go`（映射对不对）和
`server/internal/service/user_actions_test.go`（service 真的返回了哨兵没有）。

## 已做 / 待做

已做：登录注册、**资料向导（五步）**、划卡（**滑动 + 按钮 + 点开看资料**，含乐观更新与
配对动画）、广场（筛选含**省份多选**、游标分页）、心动、消息列表与聊天室、TA 的主页
（按关系渲染操作条，含**举报 / 拉黑 / 解除配对**）、我的（相册支持上传、设封面、**删除**）。

待做（按优先级）：

1. 推送通知（新消息、配对成功）——需要 Expo Notifications + 服务端下发。
2. 聊天室的图片消息、消息已读态。

## 推荐卡上的三种操作

最上面那张卡同时挂 **Pan（左右滑）** 和 **Tap（点开对方主页）**，用 `Gesture.Race`
组合：谁先成立谁生效——手指移动超过阈值时 Pan 先激活（Tap 随之取消），原地抬手
才是 Tap。**不用 `Exclusive`**：它让 Pan 有绝对优先权，而 Pan 在"没移动"时要等
手指抬起才失败，Tap 会白白多等一拍。

⚠️ 点开主页会（由服务端 `PublicProfile` 自动）记一条 `visit` 动作，而卡池的
`NOT EXISTS` **不区分动作类型**——所以**只是看过、没做决定的人，下次重新取卡时也会
消失**。当前会话内不受影响（这一页不用 `useFocusEffect`，回来时不重拉），Web 端行为相同。

## Logo

`logo.svg`（仓库根，浏览器直接打开）+ `assets/` 下 7 个 PNG，**全部由
`scripts/gen-icons/` 生成**：

```bash
cd mobile/scripts/gen-icons
go run . -check                                     # 只做几何自检
go run . -design A -out ../../assets -svg ../../logo.svg -preview /tmp/preview.png
```

设计：**两个相扣的圆环**（两个人扣在一起），金属金描边，深酒红底。
金在深酒红上 = 珠宝感；交集留空（A 案），两环的弧从中间交叉穿过它，
读起来是"扣住"而不是"两个圆叠着"。

**三个方案**（`-design` 切换，`-preview` 会把三案拼在一张对照图上）：

| | 外观 | |
|---|---|---|
| **A 相扣** | 金环，交集留空 | 最克制，默认 |
| B 扣中藏金 | 金环 + 交集填金 | 多一处焦点，更像"有主体" |
| C 象牙双环 | 象牙白环 + 交集填金 | 旧版配色，留作对比 |

几个常数决定了"看起来像什么"，改这几个就够（都在 `main.go` 顶部）：

- `kOverlap`（圆心距/半径）——**这是分水岭**：0.5 左右是维恩图（两个集合），
  0.72 才是链环（相扣）。第一版用的 0.51，所以看着像"两个圆叠着"。
- `wRatio`（环宽/图形宽）0.06——细才显得贵；小尺寸另用 `strokeMul` 加粗，否则会断。
- 底色是 `field()`：brand→brandDark→brandDeep 三段竖向渐变 + 一层很轻的**四角压暗**
  （纯平涂像色块，有暗角才像有厚度的东西）。
- 环用**金属渐变**（goldLine→gold，每个环上亮下深），不是平涂。

⚠️ **为什么是代码不是设计文件**：这台构建机跑不了任何图形软件（内核 3.10 + glibc 2.17，
Chromium / ImageMagick / rsvg / Python 图形库全装不上），但 Go 的 stdlib 能直接写 PNG。
好处是几何确定——改参数重跑即可，不会出现"某个尺寸忘了重新导出"。
`-check` 按解析式断言边界（图形左右外沿、竖直上沿、环宽、交集边界…），
因为这些是在看不到图的情况下唯一能验的东西——**"画对了"和"好不好看"得分开验**，
后者只能靠对照图交给人看。

⚠️ `splash-icon.png` 已生成但**还没接上**：启动画面要 `expo-splash-screen`，
而本项目没装这个依赖（装它需要联网 `npx expo install`）。没接之前它是死文件。

## 广场的分页与筛选

- 查询串交给 `src/lib/plaza.ts` 的 `plazaQuery()`——**数组按逗号拼、空数组整个不传**
  （服务端对空串是不加这条 SQL 的，传 `provinces=` 会让两头理解不一致）。
  这条有单测：拼错参数不会报错，只会安静地少筛一批人。
- 分页是 **keyset 游标**（`nextCursor`，0 = 到底），不是 OFFSET。用「加载更多」
  按钮而不是 `onEndReached`：游标归零时按钮消失，用户能看出没有了；自动续会在
  快速滑动时连着打好几页。
- 筛选弹层里的内容**可滚动**（`maxHeight` 62% 屏高）。
- **省份不在主面板里平铺**：主面板只留一行「地区  不限／浙江、江苏」，点进去换成
  第二屏——搜索框 + **按大区归组**（华北/东北/华东/华中/华南/西南/西北/港澳台）。
  34 个省份平铺要用户从头扫到尾，而且看不出地理结构；分组之后先落到一片、再找省，
  一次扫视就够。两屏是同一个 `Sheet` 换内容，**不是叠两个弹层**——两个 Modal 叠着
  既有遮罩加重的问题，返回也不自然。
- 大区分组是手写的，省份名单是自动生成的：`__tests__/provinces.test.ts` 直接和
  `PROVINCE_NAMES` 对，**不重不漏、顺序也要一致**（写错一个字，筛选就会"生效了但一个人都没有"）。

## 验证手段

- `npm run typecheck` —— 类型检查
- `npm test` —— 渲染冒烟测试（把每个页面真的渲染一遍，抓渲染期崩溃）
- `npx expo export --platform android` —— 真打包，验证能出可上机的 bundle
- `npx expo-doctor` —— 依赖健康（版本是否与 SDK 匹配）
