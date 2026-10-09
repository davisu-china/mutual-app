import { NumberWheelField } from "./number-wheel-field";

const MIN_CM = 130;
const MAX_CM = 230;

/**
 * 默认落点：男女身高的人群中位数。
 *
 * 停在区间端点（130）的话，用户要往上滚 45 格才能到自己那儿；停在均值附近，
 * **大多数人只需要微调一两格**。所以这个字段按性别给不同的默认值，
 * 表单里性别是第一个问的，滚轮打开时已经知道该停哪。
 */
export const HEIGHT_DEFAULT_BY_GENDER: Record<string, number> = {
  male: 173,
  female: 162,
};

/** 快捷档位：覆盖两性均值附近最常填的那几档 */
export const HEIGHT_QUICK_PICKS = [160, 165, 170, 175, 180, 185];

export function HeightField({
  value,
  onChange,
  gender = "male",
  error,
}: {
  value: number | null;
  onChange: (cm: number) => void;
  gender?: "male" | "female";
  error?: string;
}) {
  return (
    <NumberWheelField
      label="身高"
      unit="cm"
      min={MIN_CM}
      max={MAX_CM}
      value={value}
      fallback={HEIGHT_DEFAULT_BY_GENDER[gender] ?? 170}
      quickPicks={HEIGHT_QUICK_PICKS}
      ariaLabel="身高选择"
      onChange={onChange}
      error={error}
    />
  );
}
