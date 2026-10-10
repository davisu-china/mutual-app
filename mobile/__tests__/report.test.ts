/**
 * 举报理由与数据库约束的一致性。
 *
 * 这一条值得测的原因：`ActionService.Report` **不做任何校验**，直接把理由插库，
 * 而 `reports.reason` 上有 CHECK 约束。所以客户端多加一个理由、或者少写一个，
 * 在开发时都不会有任何提示——直到线上有人点了那个按钮，拿到一条
 * 「violates check constraint ck_rep_reason」的数据库错误。
 *
 * 所以这里不等价于「测一个常量数组」，而是**从 schema.sql 里把约束抠出来对**：
 * 哪天数据库那边改了取值集合，这条测试会立刻红。
 */
import { readFileSync } from "fs";
import { join } from "path";
import { REPORT_DETAIL_MAX, REPORT_REASONS, REPORT_REASON_LABEL } from "@/lib/report";

const SCHEMA = readFileSync(join(__dirname, "../../schema.sql"), "utf8");

/** 抠出 ck_rep_reason 允许的取值 */
function allowedReasons(): string[] {
  const m = SCHEMA.match(/ck_rep_reason\s+CHECK\s*\(\s*reason\s+IN\s*\(([^)]*)\)/i);
  if (!m) throw new Error("schema.sql 里找不到 ck_rep_reason —— 约束被改名或删了？");
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("举报理由", () => {
  it("与数据库约束完全一致", () => {
    expect(REPORT_REASONS.map((r) => r.value).sort()).toEqual(allowedReasons().sort());
  });

  it("取值不重复，且每条都有中文文案", () => {
    const values = REPORT_REASONS.map((r) => r.value);
    expect(new Set(values).size).toBe(values.length);
    for (const r of REPORT_REASONS) {
      expect(r.label.trim()).not.toBe("");
      // 展示时的回查要能对上，否则详情页会显示英文码
      expect(REPORT_REASON_LABEL(r.value)).toBe(r.label);
    }
    // 认不出来的值原样透出，不要显示成 undefined
    expect(REPORT_REASON_LABEL("unknown")).toBe("unknown");
  });

  it("补充说明上限与 reports.detail 的列宽一致", () => {
    const m = SCHEMA.match(/detail\s+VARCHAR\((\d+)\)/i);
    expect(m).not.toBeNull();
    expect(REPORT_DETAIL_MAX).toBe(Number(m![1]));
  });

  it("target_type 用的是后端认的 'user'（界面只做用户级举报）", () => {
    const m = SCHEMA.match(/ck_rep_type\s+CHECK\s*\(\s*target_type\s+IN\s*\(([^)]*)\)/i);
    expect(m).not.toBeNull();
    const allowed = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(allowed).toContain("user");
  });
});
