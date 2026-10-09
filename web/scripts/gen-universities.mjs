#!/usr/bin/env node
/**
 * 生成前端用的院校数据与拼音索引。
 *
 * 数据源：data-src/china-universities-2021.json（34 省 / 3004 所，含港澳台）
 *   原始出处是教育部《全国高等学校名单》（香港/澳门高等学校名单另见教育部，
 *   军校与台湾院校来自维基百科，由 WenryXu/ChinaUniversity 整理汇总到 2021-10）。
 *   换数据只要替换这个源文件再重跑本脚本。
 *
 * 和区划数据同样的取舍：拼音在构建期算好写死进产物，运行时不需要拼音库，
 * 也就不会把几十 KB 的 pinyin-pro 打进用户要下载的包里。
 *
 * 产物：src/data/universities.generated.ts（约 200KB，懒加载）
 * 用法：node scripts/gen-universities.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pinyin } from "pinyin-pro";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = resolve(ROOT, "data-src/china-universities-2021.json");
const OUT = resolve(ROOT, "src/data/universities.generated.ts");

/** 学校名的通用后缀。取拼音时剥掉它们——没人会打「zhejiangdaxue」里的「daxue」，
 *  但全称的拼音也留一份，因为总有人打全。 */
const SUFFIX = /(大学|学院|高等专科学校|职业技术学院|职业学院|专科学校|分校|校区)$/u;

function pyOf(s) {
  const core = s.replace(SUFFIX, "") || s;
  const full = pinyin(s, { toneType: "none", type: "array" }).join("");
  const coreFull = pinyin(core, { toneType: "none", type: "array" }).join("");
  const coreIni = pinyin(core, { toneType: "none", type: "array" })
    .map((x) => x[0] ?? "")
    .join("");
  return [full, coreFull, coreIni];
}

const LEVEL = { 本科: 1, 专科: 2 };

const src = JSON.parse(readFileSync(SRC, "utf8"));

const provinces = src.map((p) => ({
  name: p.province,
  schools: p.schools.map(([name, city, level]) => [
    name,
    city,
    LEVEL[level] ?? 0,
    ...pyOf(name),
  ]),
}));

const total = provinces.reduce((n, p) => n + p.schools.length, 0);

const content = `/**
 * 院校数据 + 拼音索引 —— **本文件由 scripts/gen-universities.mjs 自动生成，请勿手改**。
 *
 * 数据来源：教育部《全国高等学校名单》等（经 WenryXu/ChinaUniversity 汇总，
 * 快照日期 2021-10-08，源文件见 web/data-src/china-universities-2021.json）。
 * 覆盖 ${provinces.length} 个省级行政区 / ${total} 所高校，含港澳台。
 * 换数据：替换源文件后重跑 \`node scripts/gen-universities.mjs\`。
 *
 * 体积约 200KB，**懒加载**：用户只在打开院校选择器时才需要它。
 * 每所学校是 [校名, 城市, 层次, 全拼, 核心全拼, 核心首字母]，
 * 层次 1=本科 2=专科 0=未知（军校/港澳台名单里没有这一列）。
 */
export type RawSchool = [string, string, number, string, string, string];
export interface RawUniProvince { name: string; schools: RawSchool[] }

export const RAW_UNI_PROVINCES: RawUniProvince[] = ${JSON.stringify(provinces)};
`;

writeFileSync(OUT, content);
console.log(
  `已生成 ${OUT}\n  ${provinces.length} 个省级行政区 / ${total} 所高校 / ${(
    Buffer.byteLength(content) / 1024
  ).toFixed(0)}KB`
);
