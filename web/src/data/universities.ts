/**
 * 院校数据访问层。
 *
 * 数据来源见 scripts/gen-universities.mjs（教育部《全国高等学校名单》，快照 2021-10）。
 * **完整名单是懒加载的**：292KB 只在用户打开院校选择器时才需要，首屏不该为它付账。
 */
import { provinceShort } from "./regions";
import type { RawSchool, RawUniProvince } from "./universities.generated";

export interface School {
  name: string;
  city: string;
  /** 1=本科 2=专科 0=未知（军校/港澳台名单没有这一列） */
  level: number;
  pyFull: string;
  pyCore: string;
  iniCore: string;
}

export interface UniProvince {
  name: string;
  short: string;
  schools: School[];
}

const LEVEL_LABEL: Record<number, string> = { 1: "本科", 2: "专科" };
export function levelLabel(level: number): string {
  return LEVEL_LABEL[level] ?? "";
}

/** 「其他院校」这个出口的取值，用户选它时存进库的就是这个字符串 */
export const OTHER_SCHOOL = "其他院校";

function normalize(raw: RawSchool): School {
  const [name, city, level, pyFull, pyCore, iniCore] = raw;
  return { name, city, level, pyFull, pyCore, iniCore };
}

let cache: UniProvince[] | null = null;
let inflight: Promise<UniProvince[]> | null = null;

/** 加载完整院校名单（带缓存与并发去重）。 */
export function loadUniversities(): Promise<UniProvince[]> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;

  inflight = import("./universities.generated")
    .then((m) => {
      cache = (m.RAW_UNI_PROVINCES as RawUniProvince[]).map((p) => ({
        name: p.name,
        short: provinceShort(p.name),
        schools: (p.schools as RawSchool[]).map(normalize),
      }));
      return cache;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** 已同步加载过的数据（未加载则返回 null） */
export function loadedUniversities(): UniProvince[] | null {
  return cache;
}

export interface SchoolHit {
  school: School;
  province: string;
}

/**
 * 常见简称 / 英文缩写 → 校名。
 *
 * 用户搜学校时打的是「浙大」「zju」，不是「浙江大学」「zhejiangdaxue」——
 * 拼不出来的话会以为学校里没收录。只挑最有辨识度的那批（其余靠拼音索引就够了），
 * 键一律小写。
 */
const ALIAS: Record<string, string> = {
  清华: "清华大学",
  北大: "北京大学",
  浙大: "浙江大学",
  复旦: "复旦大学",
  上交: "上海交通大学",
  人大: "中国人民大学",
  中科大: "中国科学技术大学",
  南大: "南京大学",
  武大: "武汉大学",
  华科: "华中科技大学",
  中大: "中山大学",
  哈工大: "哈尔滨工业大学",
  西交: "西安交通大学",
  同济: "同济大学",
  南开: "南开大学",
  天大: "天津大学",
  川大: "四川大学",
  厦大: "厦门大学",
  东南: "东南大学",
  兰大: "兰州大学",
  吉大: "吉林大学",
  北师大: "北京师范大学",
  华东师大: "华东师范大学",
  thu: "清华大学",
  pku: "北京大学",
  zju: "浙江大学",
  fudan: "复旦大学",
  sjtu: "上海交通大学",
  ustc: "中国科学技术大学",
  nju: "南京大学",
  whu: "武汉大学",
  hust: "华中科技大学",
};

const NO_MATCH = 99;

/**
 * 搜学校：中文、全拼、首字母都能命中。
 *
 * 排序按「匹配得有多像」：校名以关键词开头 > 校名包含 > 核心名首字母/全拼开头 >
 * 整名全拼开头 > 只在城市或省份里出现。同名不同校（「师范学院」一类的名字在很多
 * 城市都有）靠列表里的城市与省份区分，所以这些都保持同一档、按原始顺序。
 */
export function searchSchools(list: UniProvince[], keyword: string, limit = 60): SchoolHit[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [];

  const alias = ALIAS[kw];
  const scored: { hit: SchoolHit; score: number }[] = [];
  for (const p of list) {
    const provMatch = p.name.includes(kw) || p.short.includes(kw);
    for (const s of p.schools) {
      let score = NO_MATCH;
      if (alias === s.name) score = -1;
      else if (s.name.startsWith(kw)) score = 0;
      else if (s.name.includes(kw)) score = 1;
      else if (s.iniCore.startsWith(kw)) score = 2;
      else if (s.pyCore.startsWith(kw)) score = 3;
      else if (s.pyFull.startsWith(kw)) score = 4;
      else if (provMatch || s.city.includes(kw)) score = 5;
      if (score !== NO_MATCH) scored.push({ hit: { school: s, province: p.short }, score });
    }
  }

  scored.sort((a, b) => a.score - b.score || a.hit.school.name.length - b.hit.school.name.length);
  return scored.slice(0, limit).map((x) => x.hit);
}
