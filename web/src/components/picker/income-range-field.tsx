import { useState } from "react";
import { FieldRow } from "@/components/ui/field-row";
import { Sheet } from "@/components/ui/sheet";
import { Choice } from "@/components/ui/choice";
import {
  INCOME_LABEL_RANGE,
  INCOME_MAX_CHOICES,
  INCOME_MIN_CHOICES,
} from "@/data/options";

interface Props {
  label: string;
  /** 后端档位下标：min 0=不限，max 7=不限 */
  min: number;
  max: number;
  onChange: (lo: number, hi: number) => void;
}

/**
 * 期望年收入（区间，按档位点选）。
 *
 * 之前用双滑块表达这个区间，很别扭：收入是分档的类别值而不是连续量，滑杆上
 * 两头都写「不限」，最左最右两档当上下限还没意义（「至少 10 万以下」是什么要求？）。
 * 现在改成弹层里两行**有意义的档位**——下限只有「X 万以上」、上限只有「X 万以下」，
 * 点一下就是一次明确的要求，跟「最低学历」那些是同一套交互。
 *
 * 显示沿用一句话：只设下限说「20 万以上」，只设上限说「50 万以下」，
 * 两边都设说「20–50 万」，都不设说「不限」。
 */
export function IncomeRangeField({ label, min, max, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ min, max });

  function openSheet() {
    setDraft({ min, max });
    setOpen(true);
  }

  /** 选下限：若越过上限就把上限一起抬上来（否则出现空区间） */
  function pickMin(lo: number) {
    setDraft((d) => ({ min: lo, max: d.max !== 7 && d.max < lo ? lo : d.max }));
  }
  /** 选上限：若低于下限就把下限一起压下来 */
  function pickMax(hi: number) {
    setDraft((d) => ({ min: hi !== 7 && hi < d.min ? hi : d.min, max: hi }));
  }

  return (
    <>
      <FieldRow label={label} value={INCOME_LABEL_RANGE(min, max)} onClick={openSheet} />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        confirmText="确定"
        onConfirm={() => {
          onChange(draft.min, draft.max);
          setOpen(false);
        }}
      >
        <div className="space-y-5 px-5 pb-6 pt-1">
          <p className="text-center text-[15px] font-medium text-ink">
            {INCOME_LABEL_RANGE(draft.min, draft.max)}
          </p>

          <Choice
            label="至少"
            options={INCOME_MIN_CHOICES}
            value={draft.min}
            onChange={pickMin}
            columns={3}
          />
          <Choice
            label="至多"
            options={INCOME_MAX_CHOICES}
            value={draft.max}
            onChange={pickMax}
            columns={3}
          />
        </div>
      </Sheet>
    </>
  );
}
