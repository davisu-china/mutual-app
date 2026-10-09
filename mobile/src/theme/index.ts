/**
 * 设计令牌 —— 与 Web 版 `web/tailwind.config.ts` **同一套口径**。
 *
 * 两端共用一份色值与尺度：改配色时两边一起改，才不会出现「App 是酒红、
 * 网页是粉色」这种割裂。Web 用 Tailwind 的类名表达，这里用对象表达，
 * 但值必须对得上。
 *
 * 调色方向（2026-10-09）：深酒红 + 象牙白 + 香槟金。
 * 高级感来自克制与层次，所以：主色只用在一个地方（主操作），
 * 中性色全部偏暖，第二强调色（金）只在有仪式感的瞬间出现。
 */

export const colors = {
  brand: "#A32E4E", // 深酒红：主操作、强调
  brandDark: "#86243F", // 按下态
  brandDeep: "#61182C", // 渐变的深端
  brandSoft: "#F9EEF1", // 选中态底色
  brandLine: "#EED8DE",

  gold: "#A8763E", // 香槟金：只用于配对这类仪式感
  goldSoft: "#F6EFE4",
  goldLine: "#E6D6BE",

  ink: "#1A1512", // 正文（暖墨，不是纯黑）
  ink2: "#46403A",
  muted: "#6B615A",
  muted2: "#8C8178", // 12–13px 的提示文字

  line: "#E7DDD2", // 暖沙色描边
  lineSoft: "#F1EAE1",
  paper: "#F7F3EE", // 象牙白底
  surface: "#FFFFFF",

  white: "#FFFFFF",
  danger: "#B3372F",
} as const;

/** 圆角：卡片 20 / 字段 12，和 Web 一致 */
export const radius = { card: 20, field: 12, sm: 10, pill: 999 } as const;

/** 间距按 4 的倍数走，避免出现 7、13 这种随手值 */
export const space = (n: number) => n * 4;

/** 字号阶梯：正文 15，次要 13，标题 17–26 */
export const font = {
  hero: 26,
  title: 22,
  section: 16,
  body: 15,
  label: 13,
  caption: 11.5,
} as const;

/**
 * 阴影：iOS 用 shadow*，Android 只有 elevation（且表现不同）。
 * 所以这里成对给出，卡片在两端都能「浮」起来。
 */
export const shadow = {
  card: {
    shadowColor: "#1A1512",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  raised: {
    shadowColor: "#1A1512",
    shadowOpacity: 0.14,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  brand: {
    shadowColor: colors.brand,
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
} as const;

/**
 * 动效。
 *
 * 时长不是随手定的：150ms 以内是「即时反馈」（按压、切态），
 * 250–300ms 是「空间变化」（弹层进出卡片飞走）。把这两类分开，
 * 界面才会有节奏，而不是所有东西一起慢半拍。
 */
export const motion = {
  instant: 140,
  quick: 220,
  sheet: 280,
} as const;

/** 卡片上压文字的渐层（整图出血卡片用） */
export const overlayGradient = ["transparent", "rgba(26,21,18,.35)", "rgba(26,21,18,.92)"] as const;
