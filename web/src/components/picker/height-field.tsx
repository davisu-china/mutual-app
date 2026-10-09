import { useMemo, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { FieldRow } from "@/components/ui/field-row";
import { WheelPicker, type WheelOption } from "./wheel-picker";

const MIN_CM = 130;
const MAX_CM = 230;

/**
 * 默认落点。
 *
 * 这是本组件体验的关键之一：如果默认停在 130，用户要往上滚 45 格才能到
 * 自己的身高。默认落在人群分布的中位数附近，**大多数人只需要微调一两格**。
 * 男女中位数不同，所以按性别给不同的默认值。
 */
const DEFAULT_BY_GENDER: Record<string, number> = {
  male: 173,
  female: 162,
};

interface HeightFieldProps {
  value: number | null;
  onChange: (cm: number) => void;
  gender?: "male" | "female";
  error?: string;
}

export function HeightField({
  value,
  onChange,
  gender = "male",
  error,
}: HeightFieldProps) {
  const [open, setOpen] = useState(false);
  const fallback = DEFAULT_BY_GENDER[gender] ?? 170;
  const [draft, setDraft] = useState<number>(value ?? fallback);
  /** 跟随滚动实时变化的值，用于大号数字 */
  const [live, setLive] = useState<number>(value ?? fallback);

  const options = useMemo<WheelOption[]>(() => {
    const out: WheelOption[] = [];
    for (let cm = MIN_CM; cm <= MAX_CM; cm++) {
      out.push({ value: cm, label: String(cm) });
    }
    return out;
  }, []);

  function openSheet() {
    // 每次打开都从「当前值，或按性别的默认值」开始，而不是上次滚到哪算哪
    const start = value ?? fallback;
    setDraft(start);
    setLive(start);
    setOpen(true);
  }

  return (
    <>
      <FieldRow
        label="身高"
        value={value ? `${value} cm` : undefined}
        onClick={openSheet}
        error={error}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="身高"
        confirmText="确定"
        onConfirm={() => {
          onChange(draft);
          setOpen(false);
        }}
      >
        {/* 大号数字：跟着滚轮实时变化，而不是松手才跳 */}
        <div className="flex items-baseline justify-center gap-1.5 pt-1 pb-3">
          <span className="text-[40px] font-bold leading-none tabular-nums text-ink">
            {live}
          </span>
          <span className="text-[15px] font-medium text-muted-2">cm</span>
        </div>

        <div className="px-6 pb-4">
          <WheelPicker
            options={options}
            value={draft}
            onChange={(v) => setDraft(v as number)}
            onLiveIndexChange={(i) => setLive(options[i].value as number)}
            ariaLabel="身高选择"
          />
        </div>

        {/* 快捷定位：离默认值近的常见档位，省得滚 */}
        <div className="flex flex-wrap justify-center gap-2 px-5 pb-5">
          {[160, 165, 170, 175, 180, 185].map((cm) => (
            <button
              key={cm}
              type="button"
              onClick={() => {
                setDraft(cm);
                setLive(cm);
              }}
              className={
                "rounded-full border px-3 py-1 text-[13px] transition-colors " +
                (draft === cm
                  ? "border-brand bg-brand-soft font-medium text-brand-dark"
                  : "border-line text-muted hover:border-brand/40")
              }
            >
              {cm}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}
