# 相悦 Mutual · 前端

React 18 + TypeScript + Vite + Tailwind CSS。

## 快速开始

```bash
npm install                 # 注意：本机环境变量里有 NODE_ENV=production，会跳过 devDependencies
npm run dev                 # 开发服务器 http://localhost:5173
npm run build               # 类型检查 + 生产构建
npm run typecheck           # 只做类型检查
npm run smoke               # 渲染冒烟测试（把组件树真的渲染一遍）
```

> ⚠️ 如果 `npm install` 之后 `node_modules` 里没有 vite/react，说明环境变量
> `NODE_ENV=production` 生效了，npm 会跳过所有 devDependencies。
> 用 `NODE_ENV=development npm install --include=dev` 重新安装。

## 目录

```
src/
├── App.tsx                      # Onboarding 第 1 步演示页
├── components/
│   ├── ui/
│   │   ├── sheet.tsx            # 底部弹层
│   │   └── field-row.tsx        # 表单字段触发行（三个选择器共用）
│   └── picker/
│       ├── wheel-picker.tsx     # 滚轮选择器（核心基础组件）
│       ├── height-field.tsx     # 身高
│       ├── birthday-field.tsx   # 出生年月日
│       └── region-field.tsx     # 省市
├── data/regions.ts              # 省市数据 + 搜索
└── lib/
    ├── utils.ts                 # cn()
    └── haptics.ts               # 触感反馈
```

## 三个高交互组件的设计取舍

这三个字段的「选择难度」完全不同，所以**没有套用同一个交互范式**：

| 组件 | 数据特征 | 采用的交互 | 为什么 |
|---|---|---|---|
| **身高** | 100 个连续值，需精确到 cm | 滚轮 + 大号数字跟手 + 常见档位快捷键 | 滑块在手机上精确到 1cm 很难（手指挡住数值），滚轮是精度与速度的平衡点 |
| **生日** | 三段联动，跨 50 年 | 三列滚轮 + 实时年龄 + 闰年收敛 | 原生 date picker 翻到 1998 年很痛苦；三段滚轮是中文用户的肌肉记忆 |
| **省市** | 34 省 + 330 市 | **搜索优先** + 热门城市 + 省→市兜底 | 用户想的是「我在杭州」而不是「杭州属于浙江」，让他直接打 `hz` 是最短路径 |

### 几个具体的体验决策

- **身高默认落点是人群中位数附近**（男 173 / 女 162），不是 130。否则用户要往上滚 45 格。
- **大号数字实时跟手**，而不是松手才跳。这靠 `onLiveIndexChange`（滚动中触发）与 `onChange`（停稳后提交）分离实现。
- **滚轮用原生 scroll-snap**，不用 JS 逐帧算 transform——惯性、回弹、跟手都交给浏览器合成线程，低端机也不掉帧。
- **每越过一格触发 8ms 震动**（Android 有效，iOS 静默跳过）。超过 30ms 会像来消息，反而干扰。
- **闰年与月末收敛**：选到 1/31 再切 2 月，自动收敛到 2/29 或 2/28，而不是跳到 1 日。
- **未满 18 岁即时拦截**，不是等到提交。
- **省市搜索支持中文与拼音首字母**（`hz` → 杭州）。

## 已知待改进

1. **拼音只覆盖热门城市**。生产环境接入 `pinyin-pro` 为全部城市生成全拼与首字母索引，`searchCities()` 签名不变，替换实现即可。
2. **省市数据应替换为官方数据**（民政部行政区划代码，或 npm 的 `china-division`）。
3. **未做定位自动填充**。能显著减少一步操作，但需要申请定位权限——建议放到「用户主动点击『使用当前位置』」时再申请，不要一进表单就弹权限框。

## 预览部署

```bash
sudo ./deploy-preview.sh     # 部署到 https://jianjiange.site/mutual/
```

复用主站证书与域名，不需要新签 DNS。
