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
  (tabs)/               底部五个 Tab：发现 / 广场 / 心动 / 消息 / 我的
  chat/[id].tsx         聊天室（WebSocket 实时）
  user/[id].tsx         TA 的主页
  onboarding.tsx        资料向导（占位，见下）
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
- **不用滑动手势划卡**：这是产品早先定下的（桌面可用、误触率低、可访问），
  App 端同样只用按钮，把"丝滑"做在按压反馈、卡片飞出动画和触觉反馈上。

## 已做 / 待做

已做：登录注册、划卡（含乐观更新与配对动画）、广场（含筛选弹层）、
心动、消息列表与聊天室、TA 的主页（按关系渲染操作条）、我的（含相册与上传）。

待做（按优先级）：

1. **资料向导**（`app/onboarding.tsx` 目前是占位页）——目前引导到网页版填写。
   含：生日/身高/体重滚轮、家乡与现居地两级选择、职业（行业·岗位）、
   MBTI 四维滑杆、伴侣画像的区间滑块与省份多选。
2. 推送通知（新消息、配对成功）——需要 Expo Notifications + 服务端下发。
3. 聊天室的图片消息、消息已读态。
4. 广场的省份多选筛选。

## 验证手段

- `npm run typecheck` —— 类型检查
- `npm test` —— 渲染冒烟测试（把每个页面真的渲染一遍，抓渲染期崩溃）
- `npx expo export --platform android` —— 真打包，验证能出可上机的 bundle
- `npx expo-doctor` —— 依赖健康（版本是否与 SDK 匹配）
