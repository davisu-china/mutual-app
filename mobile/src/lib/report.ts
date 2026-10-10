/**
 * 举报理由。
 *
 * ⚠️ `value` **必须**是这几个英文码，不能自己造：`reports.reason` 上有数据库
 * CHECK 约束（`schema.sql` 的 `ck_rep_reason`），而服务端的 `ActionService.Report`
 * **不做任何校验**、直接插库——所以理由写错不会得到一句"理由不合法"，而是
 * 一条数据库约束错误，排查起来很难看。
 *
 * 文案顺序按「严重程度 + 常见程度」排：色情、诈骗、骚扰是最需要被快速处理的，
 * 放前面；「其他」兜底放最后。
 */
export const REPORT_REASONS = [
  { value: "porn", label: "色情低俗" },
  { value: "fraud", label: "诈骗 / 骗取钱财" },
  { value: "harassment", label: "骚扰辱骂" },
  { value: "fake_info", label: "资料造假" },
  { value: "ad", label: "广告推销" },
  { value: "minor", label: "未成年人" },
  { value: "other", label: "其他" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["value"];

/** 后端 `reports.detail` 是 VARCHAR(500)，超了会直接报错 */
export const REPORT_DETAIL_MAX = 500;

export const REPORT_REASON_LABEL = (v: string) =>
  REPORT_REASONS.find((r) => r.value === v)?.label ?? v;
