import { NumberWheelField } from "./number-wheel-field";

const MIN_KG = 30;
const MAX_KG = 200;

/**
 * 默认落点：男女体重的人群均值附近。
 *
 * 理由同身高：停在区间端点（30kg）要滚几十格。区间按 body 校验的 30–200 给
 * （见 Onboarding 的 weightOk），但靠默认值和快捷档位，实际没人需要滚远。
 */
export const WEIGHT_DEFAULT_BY_GENDER: Record<string, number> = {
  male: 70,
  female: 55,
};

/** 快捷档位按性别分开——两性的常见值几乎不重叠 */
export const WEIGHT_QUICK_PICKS_BY_GENDER: Record<string, number[]> = {
  male: [60, 65, 70, 75, 80, 85],
  female: [45, 50, 55, 60, 65, 70],
};

export function WeightField({
  value,
  onChange,
  gender = "male",
  error,
}: {
  value: number | null;
  onChange: (kg: number) => void;
  gender?: "male" | "female";
  error?: string;
}) {
  return (
    <NumberWheelField
      label="体重"
      unit="kg"
      min={MIN_KG}
      max={MAX_KG}
      value={value}
      fallback={WEIGHT_DEFAULT_BY_GENDER[gender] ?? 62}
      quickPicks={WEIGHT_QUICK_PICKS_BY_GENDER[gender] ?? []}
      ariaLabel="体重选择"
      onChange={onChange}
      error={error}
    />
  );
}
