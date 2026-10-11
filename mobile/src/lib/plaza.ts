/**
 * 恋爱广场的筛选条件与查询串。
 *
 * 字段名**就是**后端的查询参数名（`GET /plaza`），改这里等于改接口约定。
 * 抽成纯函数是为了能测：拼错一个参数不会报错，只会安静地少筛掉一批人。
 */
export interface PlazaFilter {
  ageMin?: number;
  ageMax?: number;
  heightMin?: number;
  heightMax?: number;
  education?: number;
  incomeMin?: number;
  incomeMax?: number;
  /** **现居地**省份，可多选；存的是全名（浙江省），后端按 city_prov 精确匹配，不是 LIKE */
  provinces?: string[];
  /**
   * **家乡**省份，可多选；后端按 hometown_prov 精确匹配。
   * 和现居地是**两个独立维度**：可以只筛其一，也可以两个都选（取交集）。
   */
  hometownProvinces?: string[];
}

/** 省份多选的两个栏位（现居地 / 家乡）。两栏共用同一套省份网格 */
export type ProvinceField = "provinces" | "hometownProvinces";

/**
 * 拼查询串。
 *
 * 两条规则值得单独说，因为错了不会报错、只会悄悄筛错人：
 *   - **数组按逗号拼**（后端用 `strings.Split(v, ",")` 解析；省名里不含逗号，
 *     所以不需要转义）；
 *   - **空数组整个跳过**：`provinces=` 传一个空串，读起来像"筛了但没有命中"，
 *     而服务端对空串是不加这条 SQL 的——两头理解不一致，干脆不传。
 */
export function plazaQuery(f: PlazaFilter): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (Array.isArray(v)) {
      if (v.length) p.set(k, v.join(","));
      continue;
    }
    if (v !== undefined) p.set(k, String(v));
  }
  return p.toString();
}

/**
 * 多选省份的开关。`field` 决定改哪一栏（现居地 / 家乡）。
 * 清空时把字段设回 undefined，别给查询串留一个空的 provinces。
 */
export function toggleProvince(f: PlazaFilter, field: ProvinceField, name: string): PlazaFilter {
  const cur = f[field] ?? [];
  const next = cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name];
  return { ...f, [field]: next.length ? next : undefined };
}
