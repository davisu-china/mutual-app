/**
 * 行政区划数据访问层。
 *
 * 数据来源：国家统计局《统计用区划和城乡划分代码》，覆盖 34 个省级 /
 * 366 个市级 / 3439 个区县级。生成脚本见 scripts/gen-regions.mjs。
 *
 * **完整树是懒加载的**：它有 216KB，而用户只在打开地区选择器时才需要它。
 * 首屏为它付这个代价不值得，所以拆成动态 import，首次使用才拉。
 * 省级名单（1KB）单独静态引入，给伴侣画像的多选用。
 */
import { PROVINCE_NAMES } from "./provinces.generated";
import type { RawProvince, Py } from "./regions.generated";

export { PROVINCE_NAMES };

export interface District {
  code: string;
  name: string;
  py: Py;
}

export interface City {
  code: string;
  name: string;
  py: Py;
  districts: District[];
}

export interface Province {
  code: string;
  name: string;
  py: Py;
  /** 直辖市：中间层没有独立市，其「市」就是自己 */
  isMunicipality: boolean;
  cities: City[];
}

// ---------------------------------------------------------------- 加载

let cache: Province[] | null = null;
let inflight: Promise<Province[]> | null = null;

/** 加载完整区划树（带缓存与并发去重）。 */
export function loadRegions(): Promise<Province[]> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;

  inflight = import("./regions.generated")
    .then((m) => {
      cache = m.RAW_PROVINCES.map(normalize);
      return cache;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** 已同步加载过的数据（用于需要同步访问的场景，未加载则返回 null） */
export function loadedRegions(): Province[] | null {
  return cache;
}

function normalize(raw: RawProvince): Province {
  return {
    code: raw.code,
    name: raw.name,
    py: raw.py,
    isMunicipality: raw.isMunicipality,
    cities: raw.cities.map((c) => ({
      code: c.code,
      name: c.name,
      py: c.py,
      districts: c.districts.map((d) => ({ code: d[0], name: d[1], py: [d[2], d[3], d[2] + "市"] as Py })),
    })),
  };
}

// ---------------------------------------------------------------- 展示

/**
 * 展示用的简称：只剥「省」「市」后缀。
 *
 * 「自治区 / 特别行政区 / 自治州 / 地区 / 盟 / 区 / 县」一律保留——
 * 剥了会歧义（「广西壮族自治区」剥成「广西壮族」，而「西湖区」剥成「西湖」
 * 会和地名混淆）。
 */
export function shortName(name: string): string {
  if (name.endsWith("省") || name.endsWith("市")) return name.slice(0, -1);
  return name;
}

/** 省份在标签里用的更短写法：额外剥掉自治区/特别行政区的大尾巴 */
export function provinceShort(name: string): string {
  return shortName(name).replace(/(回族|壮族|维吾尔|特别行政区)+$/u, "");
}

/** 完整展示名，如「浙江省 杭州市 西湖区」 */
export function fullName(province: string, city: string, district?: string): string {
  const parts = [shortName(province)];
  // 直辖市不重复显示自己
  if (city && city !== province) parts.push(shortName(city));
  if (district) parts.push(shortName(district));
  return parts.join(" ");
}

// ---------------------------------------------------------------- 搜索

export type HitLevel = "province" | "city" | "district";

export interface RegionHit {
  province: string;
  city: string;
  district?: string;
  level: HitLevel;
}

interface IndexEntry {
  level: HitLevel;
  province: string;
  city: string;
  district?: string;
  /** 参与匹配的各种写法，命中越靠前得分越高 */
  keys: string[];
}

let index: IndexEntry[] | null = null;

function buildIndex(provinces: Province[]): IndexEntry[] {
  const out: IndexEntry[] = [];
  for (const p of provinces) {
    out.push({
      level: "province",
      province: p.name,
      city: "",
      keys: [p.name, p.py[0], p.py[1], p.py[2]],
    });
    for (const c of p.cities) {
      out.push({
        level: "city",
        province: p.name,
        city: c.name,
        keys: [c.name, c.py[0], c.py[1], c.py[2]],
      });
      for (const d of c.districts) {
        out.push({
          level: "district",
          province: p.name,
          city: c.name,
          district: d.name,
          keys: [d.name, d.py[0], d.py[1]],
        });
      }
    }
  }
  return out;
}

/**
 * 搜索。
 *
 * 匹配顺序即得分顺序：中文精确 > 中文包含 > 拼音全拼前缀 > 拼音首字母前缀。
 * 支持中文与拼音两种输入——中文用户打拼音首字母（hz）的频率其实高于全拼。
 *
 * 返回结果按层级补齐：命中省份会展开成省内的市（用户搜「浙江」通常是想选
 * 浙江的某个市），命中市或区则直接返回该条。
 */
export function searchRegions(
  provinces: Province[],
  keyword: string,
  limit = 30
): RegionHit[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [];

  if (!index) index = buildIndex(provinces);

  type Scored = { score: number; hit: RegionHit };
  const scored: Scored[] = [];

  for (const e of index) {
    let best = 0;
    const [zh, full, initials] = e.keys;

    if (zh === kw) best = 100;
    else if (zh.includes(kw)) best = 80;
    else if (full.startsWith(kw)) best = 60;
    else if (initials.startsWith(kw)) best = 40;

    if (!best) continue;
    // 层级略作加权：同名时优先给市而不是区（用户更多在选市）
    if (e.level === "city") best += 3;
    if (e.level === "province") best -= 2;

    scored.push({
      score: best,
      hit: { province: e.province, city: e.city, district: e.district, level: e.level },
    });
  }

  scored.sort((a, b) => b.score - a.score);

  // 命中省份的展开成市
  const out: RegionHit[] = [];
  const seen = new Set<string>();
  for (const s of scored) {
    const hits: RegionHit[] =
      s.hit.level === "province"
        ? (provinces.find((p) => p.name === s.hit.province)?.cities ?? []).map((c) => ({
            province: s.hit.province,
            city: c.name,
            level: "city" as const,
          }))
        : [s.hit];

    for (const h of hits) {
      const key = `${h.province}/${h.city}/${h.district ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(h);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
