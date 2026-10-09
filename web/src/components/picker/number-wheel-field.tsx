import { useMemo, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { FieldRow } from "@/components/ui/field-row";
import { WheelPicker, type WheelOption } from "./wheel-picker";

interface Props {
  label: string;
  /** 显示在字段值里的单位，如 cm / kg */
  unit?: string;
  min: number;
  max: number;
  value: number | null;
  /**
   * 没填过时滚轮停在哪。
   *
   * 这是这类字段体验的关键：默认停在区间端点的话（身高 130、体重 30），
   * 用户要往上滚几十格才能到自己那儿。停在人群均值附近，**大多数人只需微调一两格**。
   */
  fallback: number;
  /** 快捷档位：离默认值不远的常见值，一点就到，省得滚 */
  quickPicks: number[];
  ariaLabel: string;
  onChange: (v: number) => void;
  error?: string;
}

/**
 * 「一行 + 底部弹层 + 滚轮」的数值字段（身高、体重）。
 *
 * 滚轮 + 大号数字跟手是刻意的：手指滚的时候数字实时变，松手才提交，
 * 而不是弹个键盘让人输数字（手机上一只手输三位数很别扭，还容易输错）。
 * 身高与体重只差区间、默认落点和快捷档位，所以抽成一个组件。
 */
export function NumberWheelField({
  label,
  unit,
  min,
  max,
  value,
  fallback,
  quickPicks,
  ariaLabel,
  onChange,
  error,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number>(value ?? fallback);
  /** 跟随滚动实时变化的值，用于大号数字 */
  const [live, setLive] = useState<number>(value ?? fallback);

  const options = useMemo<WheelOption[]>(() => {
    const out: WheelOption[] = [];
    for (let n = min; n <= max; n++) out.push({ value: n, label: String(n) });
    return out;
  }, [min, max]);

  function openSheet() {
    // 每次打开都从「当前值，或人群均值」开始，而不是上次滚到哪算哪
    const start = value ?? fallback;
    setDraft(start);
    setLive(start);
    setOpen(true);
  }

  return (
    <>
      <FieldRow
        label={label}
        value={value ? `${value}${unit ? ` ${unit}` : ""}` : undefined}
        onClick={openSheet}
        error={error}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        confirmText="确定"
        onConfirm={() => {
          onChange(draft);
          setOpen(false);
        }}
      >
        <div className="flex items-baseline justify-center gap-1.5 pt-1 pb-3">
          <span className="text-[40px] font-bold leading-none tabular-nums text-ink">{live}</span>
          {unit && <span className="text-[15px] font-medium text-muted-2">{unit}</span>}
        </div>

        <div className="px-6 pb-4">
          <WheelPicker
            options={options}
            value={draft}
            onChange={(v) => setDraft(v as number)}
            onLiveIndexChange={(i) => setLive(options[i].value as number)}
            ariaLabel={ariaLabel}
          />
        </div>

        <div className="flex flex-wrap justify-center gap-2 px-5 pb-5">
          {quickPicks.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setDraft(n);
                setLive(n);
              }}
              className={
                "rounded-full border px-3 py-1 text-[13px] transition-colors " +
                (draft === n
                  ? "border-brand bg-brand-soft font-medium text-brand-dark"
                  : "border-line text-muted hover:border-brand/40")
              }
            >
              {n}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}
