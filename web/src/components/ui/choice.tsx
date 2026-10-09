import { cn } from "@/lib/utils";

export interface ChoiceOption<T = string | number | boolean> {
  value: T;
  label: string;
}

interface Props<T = string | number | boolean> {
  label?: string;
  options: ChoiceOption<T>[];
  value: T | null | undefined;
  onChange: (v: T) => void;
  error?: string;
  hint?: string;
  /** 一行放几个；不传则自适应换行 */
  columns?: number;
}

/**
 * 选项组。
 *
 * 为什么不用下拉框：本项目的枚举值都很少（3–7 个），
 * 直接铺成标签一次点击到位，比「点开下拉 → 找 → 点」少两步。
 * 而且下拉框在移动端会弹系统控件，和整体视觉割裂。
 */
export function Choice<T extends string | number | boolean>({
  label,
  options,
  value,
  onChange,
  error,
  columns,
}: Props<T>) {
  return (
    <div>
      {label && <p className="mb-2 text-[15px] text-muted">{label}</p>}
      <div
        className={cn("gap-2", columns ? "grid" : "flex flex-wrap")}
        style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` } : undefined}
      >
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={String(o.value)}
              type="button"
              onClick={() => onChange(o.value)}
              className={cn(
                "rounded-field border px-3 py-2.5 text-[14px] transition-all duration-150",
                "active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                active
                  ? "border-brand bg-brand-soft font-medium text-brand-dark"
                  : "border-line bg-surface text-ink hover:border-brand/40"
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {error && <p className="mt-1.5 text-[13px] text-brand">{error}</p>}
    </div>
  );
}
