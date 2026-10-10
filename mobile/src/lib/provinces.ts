import { shortName } from "@/lib/data/regions";

/**
 * 省份按大区归组，供筛选面板展示。
 *
 * 为什么不直接平铺 34 个：一是要用户从头扫到尾，二是看不出地理结构——
 * 想找「江西」的人脑子里想的是"华东那片"，不是"第 14 个"。分组之后
 * 先落到一片、再在里面找省，一次扫视就够。
 *
 * ⚠️ 名字必须和 `PROVINCE_NAMES`（国家统计局口径，自动生成的那份）**一字不差**：
 * 后端是按 `city_prov` 精确匹配的，("浙江" vs "浙江省" 这种) 差一个字就是
 * "筛选生效了但一个人都没有"。`__tests__/provinces.test.ts` 盯着这件事。
 *
 * 顺序沿用统计局的大区顺序（华北→东北→华东→华中→华南→西南→西北→港澳台），
 * 和 `PROVINCE_NAMES` 的排列一致。
 */
export const PROVINCE_GROUPS: { label: string; provinces: string[] }[] = [
  { label: "华北", provinces: ["北京市", "天津市", "河北省", "山西省", "内蒙古自治区"] },
  { label: "东北", provinces: ["辽宁省", "吉林省", "黑龙江省"] },
  { label: "华东", provinces: ["上海市", "江苏省", "浙江省", "安徽省", "福建省", "江西省", "山东省"] },
  { label: "华中", provinces: ["河南省", "湖北省", "湖南省"] },
  { label: "华南", provinces: ["广东省", "广西壮族自治区", "海南省"] },
  { label: "西南", provinces: ["重庆市", "四川省", "贵州省", "云南省", "西藏自治区"] },
  { label: "西北", provinces: ["陕西省", "甘肃省", "青海省", "宁夏回族自治区", "新疆维吾尔自治区"] },
  { label: "港澳台", provinces: ["香港特别行政区", "澳门特别行政区", "台湾省"] },
];

/**
 * 按关键词过滤。匹配简称（浙江）或全名（浙江省）。
 *
 * 只认中文，不做拼音——34 个省份已经按大区分好组、一眼能扫到，
 * 搜索只是给"知道自己要找哪个省"的人省一次滚动，不值得为它引入
 * 拼音表（那要异步加载整棵区划树）。真需要时再说。
 */
export function filterProvinces(keyword: string): { label: string; provinces: string[] }[] {
  const k = keyword.trim();
  if (!k) return PROVINCE_GROUPS;
  return PROVINCE_GROUPS.map((g) => ({
    label: g.label,
    provinces: g.provinces.filter((p) => shortName(p).includes(k) || p.includes(k)),
  })).filter((g) => g.provinces.length > 0);
}

/** 已选省份的展示文案：最多列三个名字，多了就只报个数 */
export function selectedProvinceText(provinces: string[] | undefined): string {
  if (!provinces?.length) return "不限";
  if (provinces.length <= 3) return provinces.map(shortName).join("、");
  return `已选 ${provinces.length} 个`;
}
