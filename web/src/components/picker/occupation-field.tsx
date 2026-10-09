import { useState } from "react";
import { FieldRow } from "@/components/ui/field-row";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { INDUSTRIES, occupationValue, parseOccupation } from "@/data/occupation";

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
}

/**
 * 职业选择（弹层，两级：行业 → 岗位）。
 *
 * 一级行业用网格铺开（18 项，两列），点进去看这个行业的岗位（最多 9 项，一行一个），
 * 点中即定稿。结构上和「现居地」「院校」是同一套语言：点一行 → 弹层 → 选完收起。
 *
 * 已经选过的值会带着行业信息，所以再次打开会直接停在那行业里、并标出当前的岗位，
 * 不用从头点一遍。旧数据（改造前存的单段字符串，如「互联网」）也能正常显示。
 */
export function OccupationField({ label, value, onChange }: Props) {
  const parsed = parseOccupation(value);
  const [open, setOpen] = useState(false);
  const [industry, setIndustry] = useState<string | null>(parsed.industry);

  const current = INDUSTRIES.find((x) => x.name === industry) ?? null;

  function openSheet() {
    setIndustry(parseOccupation(value).industry);
    setOpen(true);
  }

  function pick(name: string, role?: string) {
    onChange(occupationValue(name, role));
    setOpen(false);
  }

  return (
    <>
      <FieldRow label={label} value={value} placeholder="请选择" onClick={openSheet} />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={current ? current.name : label}
      >
        <div className="max-h-[56vh] overflow-y-auto overscroll-contain px-5 pb-6 pt-1">
          {current ? (
            <div className="space-y-1">
              {current.roles.map((role) => {
                const on = parsed.industry === current.name && parsed.role === role;
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => pick(current.name, role)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-field border px-3 py-3 text-left text-[15px]",
                      "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                      on
                        ? "border-brand bg-brand-soft font-medium text-brand-dark"
                        : "border-line bg-surface text-ink hover:border-brand/40"
                    )}
                  >
                    {role}
                    {on && <span className="text-[13px] text-brand-dark">已选</span>}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setIndustry(null)}
                className="mt-3 w-full text-center text-[13px] text-muted-2 underline"
              >
                返回行业列表
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {INDUSTRIES.map((x) => {
                const on = parsed.industry === x.name;
                return (
                  <button
                    key={x.name}
                    type="button"
                    onClick={() => (x.roles.length ? setIndustry(x.name) : pick(x.name))}
                    className={cn(
                      "rounded-field border px-2 py-3 text-[14px] transition-all duration-150",
                      "active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                      on
                        ? "border-brand bg-brand-soft font-medium text-brand-dark"
                        : "border-line bg-surface text-ink hover:border-brand/40"
                    )}
                  >
                    {x.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}
