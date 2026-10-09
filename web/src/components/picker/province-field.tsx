import { useEffect, useMemo, useState } from "react";
import { FieldRow } from "@/components/ui/field-row";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  PROVINCE_NAMES,
  loadRegions,
  loadedRegions,
  provinceShort,
  searchRegions,
  type Province,
} from "@/data/regions";

interface Props {
  label: string;
  /** 完整省名数组，空数组表示不限 */
  value: string[];
  onChange: (v: string[]) => void;
  hint?: string;
}

/**
 * 省份多选（弹层）。
 *
 * 34 个省份直接铺在页面上会占掉大半屏，把这一步的其它字段全挤到下面去，
 * 所以收进弹层：收起时只占一行（已选省份的简称），点开才是可搜索的省份网格。
 *
 * 搜索复用行政区划那份数据（懒加载），所以中文、全拼、首字母都能搜——
 * 和「现居地」那个选择器同一套检索，用户不用记哪一栏支持拼音。
 * 多选点中不关闭，改动先留在草稿里，点「完成」才写回。
 */
export function ProvinceMultiField({ label, value, onChange, hint }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(value);
  const [keyword, setKeyword] = useState("");
  const [regions, setRegions] = useState<Province[] | null>(() => loadedRegions());

  useEffect(() => {
    if (!open || regions) return;
    loadRegions().then(setRegions).catch(() => {
      /* 加载失败就退回静态省份名单，搜索降级为纯中文匹配 */
    });
  }, [open, regions]);

  const all = useMemo(() => (regions ? regions.map((p) => p.name) : PROVINCE_NAMES), [regions]);

  const shown = useMemo(() => {
    const kw = keyword.trim();
    if (!kw) return all;
    if (!regions) {
      // 完整数据还没到：先用静态名单做子串匹配
      return all.filter((n) => n.includes(kw) || provinceShort(n).includes(kw));
    }
    const hit = new Set(searchRegions(regions, kw, 60).map((h) => h.province));
    return all.filter((n) => hit.has(n));
  }, [all, keyword, regions]);

  function openSheet() {
    setDraft(value);
    setKeyword("");
    setOpen(true);
  }

  function toggle(name: string) {
    setDraft((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  }

  const display = value.map(provinceShort).join("、");

  return (
    <>
      <FieldRow
        label={label}
        value={display}
        placeholder="不限"
        hint={value.length > 1 ? `${value.length} 个` : undefined}
        onClick={openSheet}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        confirmText="完成"
        onConfirm={() => {
          onChange(draft);
          setOpen(false);
        }}
      >
        <div className="px-5 pb-6 pt-1">
          {hint && <p className="mb-3 text-[13px] leading-relaxed text-muted-2">{hint}</p>}

          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜省份，支持拼音（如 hz / 浙江）"
          />

          <div className="mt-3 grid grid-cols-3 gap-2">
            {shown.map((name) => {
              const on = draft.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggle(name)}
                  className={cn(
                    "rounded-field border px-2 py-2.5 text-[14px] transition-all duration-150",
                    "active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                    on
                      ? "border-brand bg-brand-soft font-medium text-brand-dark"
                      : "border-line bg-surface text-ink hover:border-brand/40"
                  )}
                >
                  {provinceShort(name)}
                </button>
              );
            })}
            {shown.length === 0 && (
              <p className="col-span-3 py-6 text-center text-[13px] text-muted-2">没有匹配的省份</p>
            )}
          </div>

          {draft.length > 0 && (
            <button
              type="button"
              onClick={() => setDraft([])}
              className="mt-4 w-full text-center text-[13px] text-muted-2 underline"
            >
              清空已选（{draft.length}）
            </button>
          )}
        </div>
      </Sheet>
    </>
  );
}
