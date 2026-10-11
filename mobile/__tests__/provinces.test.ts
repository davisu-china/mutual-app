/**
 * 省份大区分组。
 *
 * 分组本身是手写的，而省份名单是自动生成的——两者一旦对不上，
 * 表现是"某个省在筛选面板里根本找不到"，或者更糟：名字写错一个字，
 * 筛选看起来生效了但一个人都筛不出来（后端按 city_prov 精确匹配）。
 * 所以这里不测"数组等于数组"，而是直接和自动生成的名单对。
 */
import { PROVINCE_NAMES } from "@/lib/data/regions";
import { PROVINCE_GROUPS, selectedProvinceText } from "@/lib/provinces";

describe("省份分组", () => {
  it("覆盖全部省份，且不重不漏", () => {
    const flat = PROVINCE_GROUPS.flatMap((g) => g.provinces);
    expect(new Set(flat).size).toBe(flat.length); // 不重复
    expect([...flat].sort()).toEqual([...PROVINCE_NAMES].sort()); // 不遗漏、不多余
  });

  it("顺序和统计局名单一致（大区顺序没有被打乱）", () => {
    // PROVINCE_NAMES 本身就是按大区排的，所以「按组拼接」应当等于原名单。
    // 哪天有人调整了某一组里的省份位置，这条会红。
    expect(PROVINCE_GROUPS.flatMap((g) => g.provinces)).toEqual([...PROVINCE_NAMES]);
  });

  it("每组都有名字，且没有空组", () => {
    for (const g of PROVINCE_GROUPS) {
      expect(g.label.trim()).not.toBe("");
      expect(g.provinces.length).toBeGreaterThan(0);
    }
  });
});

describe("selectedProvinceText", () => {
  it("没选就是不限", () => {
    expect(selectedProvinceText(undefined)).toBe("不限");
    expect(selectedProvinceText([])).toBe("不限");
  });

  it("少量就直接列名字（用简称，省地方）", () => {
    expect(selectedProvinceText(["浙江省", "江苏省"])).toBe("浙江、江苏");
  });

  it("多了只报个数，不然那一行会被撑爆", () => {
    expect(selectedProvinceText(["浙江省", "江苏省", "上海市", "广东省"])).toBe("已选 4 个");
  });
});
