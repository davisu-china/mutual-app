/**
 * MBTI 的"按维度选"模型。
 *
 * 这段逻辑在底部弹层里跑，而 jest 里弹层/动画都是替身，靠渲染测试只能验到
 * "点了会不会变"，验不到"什么才算答完"、"脏数据怎么办"。所以把判定抽成纯函数
 * 单测（和 swipe.ts 同一个理由）。
 */
import { MBTI_DIMS, dimsToMbti, missingDims, splitMbti } from "@/lib/mbti";

describe("MBTI 维度模型", () => {
  it("四个维度都答了才拼得出类型", () => {
    expect(dimsToMbti(["E", "N", "F", "P"])).toBe("ENFP");
    expect(dimsToMbti(["I", "S", "T", "J"])).toBe("ISTJ");
  });

  it("只要缺一个维度就没有类型——半成品不能当值存下去", () => {
    expect(dimsToMbti(["E", "N", "F", null])).toBeNull();
    expect(dimsToMbti([null, null, null, null])).toBeNull();
    expect(dimsToMbti(["E", "N", null, "P"])).toBeNull();
  });

  it("维度顺序就是字母顺序，不用另维护映射表", () => {
    expect(MBTI_DIMS.map((d) => d.left + d.right)).toEqual(["EI", "SN", "TF", "JP"]);
    // 每一维取左边那个字母，拼出来就该是 "ESTJ"
    expect(dimsToMbti(MBTI_DIMS.map((d) => d.left))).toBe("ESTJ");
  });

  it("从已填的值拆回四个维度", () => {
    expect(splitMbti("ENFP")).toEqual(["E", "N", "F", "P"]);
    expect(splitMbti("istj")).toEqual(["I", "S", "T", "J"]); // 大小写不敏感
  });

  it("脏数据按「这一维没答」处理，不原样显示成一个答过的维度", () => {
    expect(splitMbti(null)).toEqual([null, null, null, null]);
    expect(splitMbti(undefined)).toEqual([null, null, null, null]);
    expect(splitMbti("")).toEqual([null, null, null, null]);
    expect(splitMbti("NONE")).toEqual([null, null, null, null]); // "不知道"：一个字母都不认
    expect(splitMbti("EXFP")).toEqual(["E", null, "F", "P"]); // 第 2 位 X 不合法
    expect(splitMbti("EN")).toEqual(["E", "N", null, null]); // 短了
  });

  it("还差几个维度：给提示文案用", () => {
    expect(missingDims([null, null, null, null])).toBe(4);
    expect(missingDims(["E", "N", "F", null])).toBe(1);
    expect(missingDims(["E", "N", "F", "P"])).toBe(0);
  });
});
