import { useState } from "react";
import { FieldRow } from "@/components/ui/field-row";
import { Sheet } from "@/components/ui/sheet";
import { RangeField } from "@/components/ui/range-slider";

interface Props {
  label: string;
  min: number;
  max: number;
  step?: number;
  valueMin: number;
  valueMax: number;
  /** 两端之间至少保持的距离（身高 5cm） */
  gap?: number;
  format: (v: number) => string;
  /** 两端都拉到尽头时的文案（默认「不限」） */
  unrestrictedText?: string;
  onChange: (lo: number, hi: number) => void;
}

/**
 * 区间字段（一行 + 底部弹层）。
 *
 * 直接在面板里铺一根双滑块轨道，会和别的筛选项挤在一起、还占掉两三行高度；
 * 收进弹层后每项只占一行，点开才调，跟「省份」「年收入」是同一套交互。
 *
 * 弹层里的读数放在正中央并实时跟手（和身高/体重的滚轮字段一致），
 * 底下给一个「不限」快捷入口——把两个滑块拖回两端很烦。
 */
export function RangeSheetField({
  label,
  min,
  max,
  step = 1,
  valueMin,
  valueMax,
  gap = 0,
  format,
  unrestrictedText = "不限",
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ lo: valueMin, hi: valueMax });

  const isFull = valueMin <= min && valueMax >= max;
  const display = isFull ? unrestrictedText : `${format(valueMin)} – ${format(valueMax)}`;
  const draftDisplay =
    draft.lo <= min && draft.hi >= max ? unrestrictedText : `${format(draft.lo)} – ${format(draft.hi)}`;

  return (
    <>
      <FieldRow
        label={label}
        value={isFull ? unrestrictedText : display}
        onClick={() => {
          setDraft({ lo: valueMin, hi: valueMax });
          setOpen(true);
        }}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        confirmText="确定"
        onConfirm={() => {
          onChange(draft.lo, draft.hi);
          setOpen(false);
        }}
      >
        <div className="px-5 pb-6 pt-1">
          <p className="mb-3 text-center text-[22px] font-bold tabular-nums text-ink">{draftDisplay}</p>

          <RangeField
            label={label}
            min={min}
            max={max}
            step={step}
            gap={gap}
            valueMin={draft.lo}
            valueMax={draft.hi}
            format={format}
            endLabels={[format(min), format(max)]}
            hideLabel
            onChange={(lo, hi) => setDraft({ lo, hi })}
          />

          <button
            type="button"
            onClick={() => setDraft({ lo: min, hi: max })}
            className="mt-4 w-full text-center text-[13px] text-muted-2 underline"
          >
            设为{unrestrictedText}
          </button>
        </div>
      </Sheet>
    </>
  );
}
