import { cn } from "@/lib/utils";

interface Props {
  label: string;
  min: number;
  max: number;
  step?: number;
  valueMin: number;
  valueMax: number;
  /** 两端之间至少保持的距离（身高 5cm、收入 0 档就够） */
  gap?: number;
  format: (v: number) => string;
  /** 顶部右侧显示什么；默认「下限 – 上限」。收入那种两端都可能是「不限」的用得上 */
  formatRange?: (lo: number, hi: number) => string;
  /** 轨道两端的小字，例如 140 / 210 */
  endLabels?: [string, string];
  onChange: (lo: number, hi: number) => void;
}

/**
 * 区间选择（双滑块，一根轨道）。
 *
 * 为什么不是「两根并排的滑杆」（改版前的做法）：并排的两个滑杆看不出是一件事，
 * 用户得先读下面的「最低 / 最高」才知道哪个是哪个，而且选中的那段区间在视觉上
 * 完全不存在。这里把两个滑块叠在同一根轨道上，中间那段用品牌色连起来——
 * 「我在找一个 165–180 的人」一眼就能看出来。
 *
 * 实现上沿用通行做法：两个原生 range 叠在一起，轨道本身 pointer-events-none，
 * 只让滑块能接指针。原生 range 免费带来键盘方向键、无障碍语义和移动端的
 * 手感，比自己写 pointer 事件靠谱。
 */
export function RangeField({
  label,
  min,
  max,
  step = 1,
  valueMin,
  valueMax,
  gap = 0,
  format,
  formatRange,
  endLabels,
  onChange,
}: Props) {
  const span = max - min || 1;
  const pct = (v: number) => ((v - min) / span) * 100;
  const bothSame = valueMin === valueMax;

  const setLo = (v: number) => onChange(Math.max(min, Math.min(v, valueMax - gap)), valueMax);
  const setHi = (v: number) => onChange(valueMin, Math.min(max, Math.max(v, valueMin + gap)));

  const thumbCls = cn(
    "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6",
    "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
    "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-brand [&::-webkit-slider-thumb]:bg-surface",
    "[&::-webkit-slider-thumb]:shadow-md",
    "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6",
    "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-brand",
    "[&::-moz-range-thumb]:bg-surface [&::-moz-range-thumb]:shadow-md",
    "pointer-events-none absolute inset-0 h-9 w-full appearance-none bg-transparent",
    "[&::-webkit-slider-runnable-track]:h-9 [&::-webkit-slider-runnable-track]:bg-transparent",
    "[&::-moz-range-track]:h-9 [&::-moz-range-track]:bg-transparent",
    "focus:outline-none focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-brand/40"
  );

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <p className="text-[15px] text-muted">{label}</p>
        <p className="truncate text-[15px] font-medium tabular-nums text-ink">
          {formatRange ? formatRange(valueMin, valueMax) : `${format(valueMin)} – ${format(valueMax)}`}
        </p>
      </div>

      <div className="relative h-9">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-line" />
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-brand transition-[left,right] duration-75"
          style={{ left: `${pct(valueMin)}%`, right: `${100 - pct(valueMax)}%` }}
        />

        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={valueMin}
          aria-label={`${label}下限`}
          aria-valuetext={format(valueMin)}
          onChange={(e) => setLo(Number(e.target.value))}
          className={thumbCls}
          // 两个滑块重合时让上限那个在上面，用户还能把它拖开
          style={{ zIndex: bothSame ? 20 : 30 }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={valueMax}
          aria-label={`${label}上限`}
          aria-valuetext={format(valueMax)}
          onChange={(e) => setHi(Number(e.target.value))}
          className={thumbCls}
          style={{ zIndex: bothSame ? 30 : 20 }}
        />
      </div>

      {endLabels && (
        <div className="flex justify-between text-[11px] text-muted-2">
          <span>{endLabels[0]}</span>
          <span>{endLabels[1]}</span>
        </div>
      )}
    </div>
  );
}
