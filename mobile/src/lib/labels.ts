/**
 * 枚举与文案 —— 与 Web 版 `web/src/data/options.ts` 同一份口径。
 *
 * 两端展示同一份资料，措辞必须一致（例如收入档位、丁克选项），
 * 否则用户会以为看到的是两套数据。改动时两边一起改。
 */

export const GENDER = [
  { value: 2, label: "女" },
  { value: 1, label: "男" },
];

export const SMOKING = [
  { value: 1, label: "不抽" },
  { value: 2, label: "偶尔" },
  { value: 3, label: "经常" },
];

export const DRINKING = [
  { value: 1, label: "不喝" },
  { value: 2, label: "偶尔" },
  { value: 3, label: "经常" },
];

/** 收入档位。没有「不便透露」——必填项留一个「不想说」等于把必填变成选填。 */
export const INCOME = [
  { value: 1, label: "10 万以下" },
  { value: 2, label: "10–20 万" },
  { value: 3, label: "20–30 万" },
  { value: 4, label: "30–50 万" },
  { value: 5, label: "50–100 万" },
  { value: 6, label: "100 万以上" },
];

export const EDUCATION = [
  { value: 1, label: "高中及以下" },
  { value: 2, label: "大专" },
  { value: 3, label: "本科" },
  { value: 4, label: "硕士" },
  { value: 5, label: "博士" },
];

export const ELDERCARE = [
  { value: 1, label: "有" },
  { value: 2, label: "无" },
];

export const HOUSE = [
  { value: 1, label: "无" },
  { value: 2, label: "有" },
  { value: 3, label: "有贷款" },
];

export const DINK = [
  { value: 1, label: "是" },
  { value: 2, label: "否" },
];



export const YES_NO = [
  { value: true, label: "是" },
  { value: false, label: "否" },
] as { value: boolean; label: string }[];

/** 伴侣画像里的三档态度：接受 / 不接受 / 无所谓 */
export const ACCEPT_3 = [
  { value: 1, label: "接受" },
  { value: 2, label: "不接受" },
  { value: 3, label: "无所谓" },
];

export const CAR_PREFER = [
  { value: 1, label: "希望有" },
  { value: 2, label: "无所谓" },
];

export const HOUSE_PREFER = [
  { value: 1, label: "希望有房" },
  { value: 2, label: "无所谓" },
];

export const DINK_ACCEPT = [
  { value: 1, label: "接受" },
  { value: 2, label: "不接受" },
];

/** 伴侣画像里的「最低学历」多一个「无要求」（0） */
export const EDUCATION_MIN = [{ value: 0, label: "无要求" }].concat(EDUCATION);

/** 伴侣画像里的多选标签 */
export const PARTNER_TAGS = ["颜控", "智性恋", "身材控", "财迷", "幽默灵魂"];

/** 兴趣（第一步选三个，每个再写一段话） */
export const HOBBIES = [
  "运动健身", "跑步", "徒步", "登山", "骑行", "游泳", "球类",
  "音乐", "乐器", "唱歌", "livehouse",
  "阅读", "写作", "观影", "追剧", "脱口秀",
  "旅行", "摄影", "美食", "咖啡", "茶", "酒",
  "游戏", "二次元", "手工", "绘画", "书法",
  "宠物", "养花", "投资", "科技", "公益",
];

// ------------------------------------------------------------ 期望年收入
//
// 收入是**分档的类别值**，不是连续量：六档各自是一个区间（10–20 万、20–30 万…）。
// 所以期望收入不能用滑杆表达——滑杆两头都叫「不限」，而最左最右两档当上下限
// 根本没意义（「至少 10 万以下」是什么要求？）。改成按档位点选，并且只暴露
// 有意义的那几档：下限从「10 万以上」起、上限到「100 万以下」止。
// 值就是后端的档位下标（下限 0 = 不限，上限 7 = 不限）。

export const INCOME_MIN_CHOICES = [
  { value: 0, label: "不限" },
  { value: 2, label: "10 万以上" },
  { value: 3, label: "20 万以上" },
  { value: 4, label: "30 万以上" },
  { value: 5, label: "50 万以上" },
  { value: 6, label: "100 万以上" },
];

export const INCOME_MAX_CHOICES = [
  { value: 7, label: "不限" },
  { value: 1, label: "10 万以下" },
  { value: 2, label: "20 万以下" },
  { value: 3, label: "30 万以下" },
  { value: 4, label: "50 万以下" },
  { value: 5, label: "100 万以下" },
];

const INCOME_FLOOR: Record<number, number> = { 2: 10, 3: 20, 4: 30, 5: 50, 6: 100 };
const INCOME_CEIL: Record<number, number> = { 1: 10, 2: 20, 3: 30, 4: 50, 5: 100 };

/**
 * 期望收入的区间文案（按后端档位下标给）。
 * 用 `??` 而不是判 0/7：越界的下标（旧数据、将来改刻度）一律当「不设这一端」。
 */
export function INCOME_LABEL_RANGE(min: number, max: number): string {
  const lo = INCOME_FLOOR[min] ?? null;
  const hi = INCOME_CEIL[max] ?? null;
  if (lo !== null && hi !== null) return lo === hi ? `${lo} 万左右` : `${lo}–${hi} 万`;
  if (lo !== null) return `${lo} 万以上`;
  if (hi !== null) return `${hi} 万以下`;
  return "不限";
}

const label = (arr: { value: number; label: string }[], v?: number | null) =>
  v === undefined || v === null ? "—" : (arr.find((x) => x.value === v)?.label ?? "—");

export const EDUCATION_LABEL = (v?: number) => label(EDUCATION, v);
export const INCOME_LABEL = (v?: number) => label(INCOME, v);
export const SMOKING_LABEL = (v?: number) => label(SMOKING, v);
export const DRINKING_LABEL = (v?: number) => label(DRINKING, v);
export const HOUSE_LABEL = (v?: number) => label(HOUSE, v);
export const DINK_LABEL = (v?: number) => label(DINK, v);
export const ELDERCARE_LABEL = (v?: number) => label(ELDERCARE, v);
