/**
 * 广场筛选的查询串。
 *
 * 拼错参数不会报错——服务端认不出来的查询参数一律忽略，表现是"筛了但没生效"，
 * 只有逐条对着看才发现。所以这里把几条容易错的规则钉住。
 */
import { plazaQuery, toggleProvince, type PlazaFilter } from "@/lib/plaza";

/** 模拟服务端解析：gin 会先把查询串解码，再按逗号切 */
function asServerSees(qs: string): Record<string, string> {
  const p = new URLSearchParams(qs);
  const out: Record<string, string> = {};
  p.forEach((v, k) => (out[k] = v));
  return out;
}

describe("plazaQuery", () => {
  it("没有条件就是空串", () => {
    expect(plazaQuery({})).toBe("");
  });

  it("数字条件按参数名原样带上", () => {
    expect(asServerSees(plazaQuery({ ageMin: 26, ageMax: 30 }))).toEqual({ ageMin: "26", ageMax: "30" });
  });

  it("省份多选用逗号拼——服务端就是按逗号切的", () => {
    const seen = asServerSees(plazaQuery({ provinces: ["浙江省", "江苏省"] }));
    expect(seen.provinces).toBe("浙江省,江苏省");
  });

  it("省份为空数组时整个不传，而不是传一个空串", () => {
    // 传 provinces= 读起来像"筛了但没命中"，而服务端对空串根本不加这条 SQL
    expect(plazaQuery({ provinces: [] })).toBe("");
    expect(asServerSees(plazaQuery({ provinces: [] })).provinces).toBeUndefined();
  });

  it("单个省份不带逗号", () => {
    expect(asServerSees(plazaQuery({ provinces: ["上海市"] })).provinces).toBe("上海市");
  });

  it("undefined 的字段不出现（不能变成 ageMin=undefined）", () => {
    const qs = plazaQuery({ ageMin: undefined, education: 3 });
    expect(qs).not.toContain("ageMin");
    expect(asServerSees(qs)).toEqual({ education: "3" });
  });
});

describe("toggleProvince", () => {
  it("点一下加进去，再点一下去掉", () => {
    const a = toggleProvince({}, "浙江省");
    expect(a.provinces).toEqual(["浙江省"]);
    const b = toggleProvince(a, "江苏省");
    expect(b.provinces).toEqual(["浙江省", "江苏省"]);
    expect(toggleProvince(b, "浙江省").provinces).toEqual(["江苏省"]);
  });

  it("去掉最后一个时把字段清成 undefined，而不是留一个空数组", () => {
    // 留空数组的话 plazaQuery 会跳过它、行为上一样，但状态里会多一个"筛了空的"
    // 假象，activeCount 之类的判断容易跟着错
    const one = toggleProvince({}, "浙江省");
    expect(toggleProvince(one, "浙江省").provinces).toBeUndefined();
  });

  it("不动其它筛选条件", () => {
    const f: PlazaFilter = { ageMin: 26, ageMax: 30, education: 3 };
    const next = toggleProvince(f, "上海市");
    expect(next.ageMin).toBe(26);
    expect(next.education).toBe(3);
    expect(f.provinces).toBeUndefined(); // 原对象不被改
  });
});
