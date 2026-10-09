import { useMemo, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { FieldRow } from "@/components/ui/field-row";
import { WheelPicker, type WheelOption } from "./wheel-picker";

const MIN_AGE = 18;
const MAX_AGE = 70;

const MONTHS = [
  "1 月","2 月","3 月","4 月","5 月","6 月",
  "7 月","8 月","9 月","10 月","11 月","12 月",
];

/** 某年某月有多少天。注意闰年：直接用 Date 的溢出回卷特性判断最稳。 */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export interface Birthday {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

/** 精确年龄：未过生日要减一岁 */
export function calcAge({ year, month, day }: Birthday, today = new Date()): number {
  let age = today.getFullYear() - year;
  const m = today.getMonth() + 1 - month;
  if (m < 0 || (m === 0 && today.getDate() < day)) age -= 1;
  return age;
}

function formatBirthday(b: Birthday): string {
  const mm = String(b.month).padStart(2, "0");
  const dd = String(b.day).padStart(2, "0");
  return `${b.year}-${mm}-${dd}`;
}

interface BirthdayFieldProps {
  value: Birthday | null;
  onChange: (b: Birthday) => void;
  gender?: "male" | "female";
  error?: string;
}

/**
 * 默认年龄：男女用户的人群均值不同（相亲类产品里男性普遍比女性大两三岁），
 * 落在均值上用户只要微调几格——年滚轮有 53 项，停在 18 岁那种端点会让人滚很久。
 * 日期取 6 月 15 日，一年中间，往前或往后都差不多远。
 */
export const AGE_DEFAULT_BY_GENDER: Record<string, number> = {
  male: 28,
  female: 26,
};

/** 供测试断言用：按性别算出默认生日 */
export function defaultBirthdayFor(gender: "male" | "female" = "male", today = new Date()): Birthday {
  return { year: today.getFullYear() - (AGE_DEFAULT_BY_GENDER[gender] ?? 28), month: 6, day: 15 };
}

export function BirthdayField({ value, onChange, gender = "male", error }: BirthdayFieldProps) {
  const [open, setOpen] = useState(false);

  const today = useMemo(() => new Date(), []);
  const defaultBirthday = useMemo<Birthday>(() => defaultBirthdayFor(gender, today), [gender, today]);

  const [draft, setDraft] = useState<Birthday>(value ?? defaultBirthday);

  const years = useMemo<WheelOption[]>(() => {
    const out: WheelOption[] = [];
    // 倒序：从今年往回。用户大多是往前走（更年轻），倒序让默认值更靠近顶部
    for (let y = today.getFullYear(); y >= today.getFullYear() - MAX_AGE; y--) {
      out.push({ value: y, label: `${y} 年` });
    }
    return out;
  }, [today]);

  const months = useMemo<WheelOption[]>(
    () => MONTHS.map((label, i) => ({ value: i + 1, label })),
    []
  );

  const dayCount = daysInMonth(draft.year, draft.month);
  const days = useMemo<WheelOption[]>(() => {
    const out: WheelOption[] = [];
    for (let d = 1; d <= dayCount; d++) out.push({ value: d, label: `${d} 日` });
    return out;
  }, [dayCount]);

  const age = calcAge(draft);
  const tooYoung = age < MIN_AGE;

  function openSheet() {
    setDraft(value ?? defaultBirthday);
    setOpen(true);
  }

  /**
   * 改年或月时，天数可能变少（比如 1/31 → 2/28）。
   * 这里立刻把日收敛到合法范围，而不是等渲染时再兜底——
   * 否则滚轮会突然跳到 1 日，用户会觉得「我明明选的 31 号」。
   */
  function setYearOrMonth(next: Partial<Pick<Birthday, "year" | "month">>) {
    setDraft((prev) => {
      const merged = { ...prev, ...next };
      const max = daysInMonth(merged.year, merged.month);
      return { ...merged, day: Math.min(merged.day, max) };
    });
  }

  return (
    <>
      <FieldRow
        label="出生年月日"
        value={value ? formatBirthday(value) : undefined}
        hint={value ? `${calcAge(value)} 岁` : undefined}
        onClick={openSheet}
        error={error}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="出生年月日"
        confirmText={tooYoung ? undefined : "确定"}
        onConfirm={
          tooYoung
            ? undefined
            : () => {
                onChange(draft);
                setOpen(false);
              }
        }
      >
        {/* 把「选了什么日期」翻译成「你今年多大」——这才是用户真正关心的 */}
        <div className="flex flex-col items-center gap-1 pt-1 pb-3">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[40px] font-bold leading-none tabular-nums text-ink">
              {age}
            </span>
            <span className="text-[15px] font-medium text-muted-2">岁</span>
          </div>
          <span className="text-[13px] tabular-nums text-muted-2">
            {formatBirthday(draft)}
          </span>
        </div>

        {/* 三列滚轮联动 */}
        <div className="flex gap-1 px-4 pb-3">
          <div className="flex-[1.3]">
            <WheelPicker
              options={years}
              value={draft.year}
              onChange={(v) => setYearOrMonth({ year: v as number })}
              ariaLabel="出生年份"
            />
          </div>
          <div className="flex-1">
            <WheelPicker
              options={months}
              value={draft.month}
              onChange={(v) => setYearOrMonth({ month: v as number })}
              ariaLabel="出生月份"
            />
          </div>
          <div className="flex-1">
            <WheelPicker
              options={days}
              value={draft.day}
              onChange={(v) => setDraft((p) => ({ ...p, day: v as number }))}
              ariaLabel="出生日期"
            />
          </div>
        </div>

        {tooYoung && (
          <div className="mx-5 mb-4 rounded-field bg-brand-soft px-4 py-3 text-[13px] leading-relaxed text-brand-dark">
            相悦仅面向 <b>18 岁以上</b>用户。请确认出生日期填写正确。
          </div>
        )}
      </Sheet>
    </>
  );
}
