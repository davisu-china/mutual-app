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

const label = (arr: { value: number; label: string }[], v?: number | null) =>
  v === undefined || v === null ? "—" : (arr.find((x) => x.value === v)?.label ?? "—");

export const EDUCATION_LABEL = (v?: number) => label(EDUCATION, v);
export const INCOME_LABEL = (v?: number) => label(INCOME, v);
export const SMOKING_LABEL = (v?: number) => label(SMOKING, v);
export const DRINKING_LABEL = (v?: number) => label(DRINKING, v);
export const HOUSE_LABEL = (v?: number) => label(HOUSE, v);
export const DINK_LABEL = (v?: number) => label(DINK, v);
export const ELDERCARE_LABEL = (v?: number) => label(ELDERCARE, v);
