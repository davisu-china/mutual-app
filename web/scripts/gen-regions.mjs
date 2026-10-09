#!/usr/bin/env node
/**
 * 从国家统计局的区划数据生成前端用的 region 数据与拼音索引。
 *
 * 为什么在构建期生成而不是运行时算：
 *   1. 拼音不需要在用户手机上算 —— 3056 个区县现算要几百毫秒，而这只是
 *      一个搜索索引，属于纯粹的浪费。
 *   2. 运行时就不必把 pinyin-pro 打进包里（它本身有几十 KB）。
 *
 * 产物：src/data/regions.generated.ts
 * 用法：node scripts/gen-regions.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pinyin } from "pinyin-pro";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = resolve(ROOT, "data-src");
const OUT = resolve(ROOT, "src/data/regions.generated.ts");
const OUT_PROV = resolve(ROOT, "src/data/provinces.generated.ts");

/** 生成「全拼 + 首字母」两套索引。搜索时两者都匹配。 */
function py(name) {
  // 去掉行政区划后缀再取拼音：「东城区」→「东城」得到 dongcheng，
  // 用户不会打「dongchengqu」。但全称的拼音也保留一份，以防有人打全。
  const core = name.replace(/(省|市|自治区|特别行政区|自治州|地区|盟|自治县|县|区|旗)$/u, "") || name;
  const arr = pinyin(core, { toneType: "none", type: "array" });
  const full = arr.join("");
  const initials = arr.map((s) => s[0] ?? "").join("");
  const arrFull = pinyin(name, { toneType: "none", type: "array" });
  return [full, initials, arrFull.join("")];
}

/** 直辖市：区划数据里的中间层是「市辖区」「县」，要把这一层压掉 */
const MUNICIPALITIES = new Set(["北京市", "天津市", "上海市", "重庆市"]);

function buildProvince(p, opts = {}) {
  const out = {
    code: p.code ?? "",
    name: p.name,
    py: py(p.name),
    isMunicipality: false,
    cities: [],
  };

  if (MUNICIPALITIES.has(p.name)) {
    out.isMunicipality = true;
    // 把「市辖区」「县」下挂的区县提升成市一级，市名用直辖市自己的名字
    const districts = [];
    for (const mid of p.children ?? []) {
      for (const d of mid.children ?? []) {
        districts.push({ code: d.code ?? "", name: d.name, py: py(d.name), districts: [] });
      }
    }
    out.cities = [{
      code: p.code,
      name: p.name,
      py: py(p.name),
      districts,
    }];
    return out;
  }

  if (opts.hmt) {
    // 港澳台：源数据是 {市/区组: [区名...]} 的形式，统一成 市 → 区 两层。
    // 「香港岛/九龙/新界」这一类当市，下挂的当区；台湾则是 市/县 → 区。
    out.cities = Object.entries(p.children ?? {}).map(([cityName, districts]) => ({
      code: "",
      name: cityName,
      py: py(cityName),
      districts: (Array.isArray(districts) ? districts : []).map((d) => ({
        code: "", name: String(d), py: py(String(d)), districts: [],
      })),
    }));
    return out;
  }

  out.cities = (p.children ?? []).map((c) => ({
    code: c.code ?? "",
    name: c.name,
    py: py(c.name),
    districts: (c.children ?? []).map((d) => ({
      code: d.code ?? "",
      name: d.name,
      py: py(d.name),
      districts: [],
    })),
  }));
  return out;
}

function main() {
  const pca = JSON.parse(readFileSync(resolve(SRC, "pca-code.json"), "utf8"));
  const hmt = JSON.parse(readFileSync(resolve(SRC, "HK-MO-TW.json"), "utf8"));

  const provinces = pca.map((p) => buildProvince(p));

  // 港澳台补齐：统计局数据不含这三地
  for (const name of ["香港特别行政区", "澳门特别行政区", "台湾省"]) {
    const raw = hmt[name];
    if (!raw) continue;
    provinces.push(buildProvince({ code: "", name, children: raw }, { hmt: true }));
  }

  // 兜底：按官方顺序把港澳台放到最后，其余保持统计局原顺序
  const stats = provinces.filter(
    (p) => !["香港特别行政区", "澳门特别行政区", "台湾省"].includes(p.name)
  );
  const extra = provinces.filter((p) =>
    ["香港特别行政区", "澳门特别行政区", "台湾省"].includes(p.name)
  );
  const ordered = [...stats, ...extra];

  const cityCount = ordered.reduce((n, p) => n + p.cities.length, 0);
  const districtCount = ordered.reduce(
    (n, p) => n + p.cities.reduce((m, c) => m + c.districts.length, 0), 0
  );

  const header = `/**
 * 行政区划数据 + 拼音索引 —— **本文件由 scripts/gen-regions.mjs 自动生成，请勿手改**。
 *
 * 数据来源：国家统计局《统计用区划和城乡划分代码》
 * （经 npm 包 china-division 整理，源文件见 web/data-src/）
 *
 * 覆盖：${ordered.length} 个省级 / ${cityCount} 个市级 / ${districtCount} 个区县级
 *
 * 拼音在构建期用 pinyin-pro 算好写死在这里，运行时不需要拼音库。
 * 省级/市级：{ code, name, py:[全拼,首字母,带后缀全拼] }
 * 区县级数组：[code, name, 全拼, 首字母, 带后缀全拼]
 */
export type Py = [string, string, string];
/** [code, name, 全拼, 首字母, 带后缀的全拼] */
export type RawDistrict = [string, string, string, string, string];
export interface RawCity { code: string; name: string; py: Py; districts: RawDistrict[] }
export interface RawProvince {
  code: string; name: string; py: Py; isMunicipality: boolean; cities: RawCity[];
}

export const RAW_PROVINCES: RawProvince[] = `;

  // 用紧凑的数组形式而不是对象，源码体积能小一半以上
  const body = JSON.stringify(
    ordered.map((p) => ({
      code: p.code,
      name: p.name,
      py: p.py,
      isMunicipality: p.isMunicipality,
      cities: p.cities.map((c) => ({
        code: c.code,
        name: c.name,
        py: c.py,
        districts: c.districts.map((d) => [d.code, d.name, ...d.py]),
      })),
    }))
    , null, 0)
    .replace(/"(\w+)":/g, "$1:")     // 去掉属性名的引号
    .replace(/\["([^"]*)","([^"]*)","([^"]*)","([^"]*)"\]/g, '["$1","$2","$3","$4"]');

  const content = `${header}${body};\n`;

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, content);

  // 省级名单单独出一份：它只有 34 项、约 1KB，伴侣画像的多选需要它，
  // 但完整树有 216KB —— 拆开才能让首屏不为一个下拉框付 200KB 的代价。
  const provContent = `/**
 * 省级行政区名单 —— **自动生成，请勿手改**（scripts/gen-regions.mjs）。
 * 数据来源：国家统计局行政区划代码。
 *
 * 这份只有名单，不含下辖市/区。需要完整树请用 data/regions.ts 的 loadRegions()。
 */
export const PROVINCE_NAMES: string[] = ${JSON.stringify(ordered.map((p) => p.name))};
`;
  writeFileSync(OUT_PROV, provContent);

  const kb = (Buffer.byteLength(content) / 1024).toFixed(0);
  console.log(`  生成 ${OUT}  (${kb} KB)`);
  console.log(`  生成 ${OUT_PROV}  (${(Buffer.byteLength(provContent) / 1024).toFixed(1)} KB)`);
  console.log(`  省级 ${ordered.length} / 市级 ${cityCount} / 区县 ${districtCount}`);
  console.log(`  直辖市处理：${ordered.filter((p) => p.isMunicipality).map((p) => p.name).join("、")}`);
}

main();
