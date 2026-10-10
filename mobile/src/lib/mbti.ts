/**
 * MBTI 的"按维度选"模型 —— 与 Web 版 `components/profile/mbti-slider.tsx` 同一套口径。
 *
 * 为什么不直接铺 16 个类型让人挑：**很多人根本不知道自己的四字母组合**，
 * 但"更偏外向还是内向"是答得出来的。按四个维度各自答一次，最后拼出类型，
 * 用户是在回答自己知道的问题，而不是在猜一个代号。
 *
 * 维度顺序就是类型字母的顺序（E/I · S/N · T/F · J/P），所以 `dims.join("")` 天然
 * 就是 "ENFP"——不用维护一张映射表。
 *
 * 抽成纯函数是为了能单测：这块逻辑在弹层里跑，jest 里手势/弹层都是替身，
 * 不给它单测就等于没有覆盖。
 */

export const MBTI_DIMS = [
  { left: "E", right: "I", leftHint: "外向", rightHint: "内向" },
  { left: "S", right: "N", leftHint: "实感", rightHint: "直觉" },
  { left: "T", right: "F", leftHint: "思考", rightHint: "情感" },
  { left: "J", right: "P", leftHint: "判断", rightHint: "感知" },
] as const;

/** 四个维度各一个字母，没选的维度是 null */
export type MbtiDims = (string | null)[];

/** 四个维度都答了才拼得出类型，否则返回 null（半成品不该当成值存下去） */
export function dimsToMbti(dims: MbtiDims): string | null {
  return dims.every((x) => !!x) ? dims.join("") : null;
}

/**
 * 把 "ENFP" 拆回四个维度。
 *
 * 只认每维度的两个合法字母：脏数据（长度不对、"NONE"、小写、乱码）一律
 * 当作该维度没选，而不是原样显示成一个答过的维度。
 */
export function splitMbti(v: string | null | undefined): MbtiDims {
  return MBTI_DIMS.map((dim, i) => {
    const ch = v?.[i]?.toUpperCase();
    return ch === dim.left || ch === dim.right ? ch : null;
  });
}

/** 还差几个维度没答（提示文案用） */
export function missingDims(dims: MbtiDims): number {
  return dims.filter((x) => !x).length;
}
