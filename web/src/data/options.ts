/** 表单枚举。集中在一处，避免各页面各写一份导致口径不一致。 */

export const GENDER = [
  { value: 2, label: "女" },
  { value: 1, label: "男" },
];

/** 16 型。列表只用于展示已有的值（选择走四维滑杆，见 components/profile/mbti-slider） */
export const MBTI = [
  "INTJ","INTP","ENTJ","ENTP",
  "INFJ","INFP","ENFJ","ENFP",
  "ISTJ","ISFJ","ESTJ","ESFJ",
  "ISTP","ISFP","ESTP","ESFP",
].map((t) => ({ value: t, label: t }));

export const OCCUPATION = [
  "互联网","金融","医疗","教育","公务员","法律","制造","传媒","自由职业","学生","其他",
].map((t) => ({ value: t, label: t }));

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

/**
 * 收入档位，与后端 SMALLINT 1–6 一一对应。
 *
 * 没有「不便透露」这一档：年收入是必填项，留一个「不想说」等于把必填变成选填。
 * 伴侣画像里的收入区间是另一套刻度（0–7，0 与 7 都表示「不限」），
 * 用的是本列表的前 6 项，见 Onboarding 的 INCOME_LABEL_RANGE。
 */
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

/** 伴侣画像里的「最低学历」多一个「无要求」（0） */
export const EDUCATION_MIN = [{ value: 0, label: "无要求" }].concat(EDUCATION);

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

export const PARTNER_TAGS = ["颜控", "智性恋", "身材控", "财迷", "幽默灵魂"];

export const HOBBIES = [
  "运动健身","跑步","徒步","登山","骑行","游泳","球类",
  "音乐","乐器","唱歌","livehouse",
  "阅读","写作","观影","追剧","脱口秀",
  "旅行","摄影","美食","咖啡","茶","酒",
  "游戏","二次元","手工","绘画","书法",
  "宠物","养花","投资","科技","公益",
];

export const EDUCATION_LABEL = (v: number) =>
  EDUCATION.find((e) => e.value === v)?.label ?? "—";

export const INCOME_LABEL = (v: number | undefined) =>
  v === undefined ? "—" : INCOME.find((e) => e.value === v)?.label ?? "—";
