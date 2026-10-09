import { useEffect, useMemo, useState } from "react";
import { FieldRow } from "@/components/ui/field-row";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  OTHER_SCHOOL,
  levelLabel,
  loadUniversities,
  loadedUniversities,
  searchSchools,
  type School,
  type UniProvince,
} from "@/data/universities";

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
}

/**
 * 院校选择器（弹层）。
 *
 * 原来是一格自由输入：手打校名会写进各种简称、错字（「浙大」「浙江大学紫金港校区」），
 * 后面按学校做匹配就没法用。改成从一个 3004 所的名单里选。
 *
 * 结构照搬「现居地」那套：打开先给省级网格，点进去看这个省的学校；顶部搜索框
 * 一输入就跨省搜（中文 / 全拼 / 首字母）。同一所学校名在全国可能有好几处
 * （「师范学院」遍地都是），所以每条都带省市，靠它区分。
 *
 * 名单里没有的（海外院校、部分军校）留了一个「其他院校」的出口——
 * 仍然是一次选择，不是自由输入，但不会让人卡在这一步。
 */
export function UniversityField({ label, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [province, setProvince] = useState<string | null>(null);
  const [list, setList] = useState<UniProvince[] | null>(() => loadedUniversities());

  useEffect(() => {
    if (!open || list) return;
    loadUniversities().then(setList).catch(() => {
      /* 加载失败就是空列表，用户可以先用「其他院校」过关 */
    });
  }, [open, list]);

  const hits = useMemo(() => (list && keyword.trim() ? searchSchools(list, keyword) : []), [list, keyword]);
  const inProvince = useMemo(
    () => (province && list ? list.find((p) => p.name === province) : null),
    [province, list]
  );

  function openSheet() {
    setKeyword("");
    setProvince(null);
    setOpen(true);
  }

  function pick(name: string) {
    onChange(name);
    setOpen(false);
  }

  const searching = keyword.trim().length > 0;

  return (
    <>
      <FieldRow label={label} value={value} placeholder="请选择学校" onClick={openSheet} />

      <Sheet open={open} onClose={() => setOpen(false)} title={searching ? "搜索院校" : label}>
        <div className="px-5 pb-6 pt-1">
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜学校，支持拼音（如 zju / 浙江）"
          />

          <div className="mt-3 max-h-[52vh] overflow-y-auto overscroll-contain">
            {!list ? (
              <p className="py-8 text-center text-[13px] text-muted-2">正在加载院校名单…</p>
            ) : searching ? (
              <div className="space-y-1">
                {hits.map((h) => (
                  <SchoolRow
                    key={`${h.province}-${h.school.name}-${h.school.city}`}
                    school={h.school}
                    province={h.province}
                    onClick={() => pick(h.school.name)}
                  />
                ))}
                {hits.length === 0 && (
                  <p className="py-8 text-center text-[13px] text-muted-2">
                    没找到。可以换个写法，或选下面的「{OTHER_SCHOOL}」
                  </p>
                )}
              </div>
            ) : inProvince ? (
              <div className="space-y-1">
                {inProvince.schools.map((s, i) => (
                  <SchoolRow
                    key={`${s.name}-${s.city}-${i}`}
                    school={s}
                    province={inProvince.short}
                    showProvince={false}
                    onClick={() => pick(s.name)}
                  />
                ))}
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  onClick={() => pick(OTHER_SCHOOL)}
                  className="mb-3 w-full rounded-field border border-dashed border-line px-3 py-2.5 text-[14px] text-muted hover:border-brand/40"
                >
                  找不到？选「{OTHER_SCHOOL}」（含海外院校）
                </button>
                <div className="grid grid-cols-3 gap-2">
                  {(list ?? []).map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => setProvince(p.name)}
                      className="rounded-field border border-line bg-surface px-2 py-2.5 text-[14px] text-ink transition-colors hover:border-brand/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      {p.short}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {!searching && inProvince && (
            <button
              type="button"
              onClick={() => setProvince(null)}
              className="mt-3 w-full text-center text-[13px] text-muted-2 underline"
            >
              返回省份列表
            </button>
          )}

          {searching && hits.length >= 60 && (
            <p className="mt-3 text-center text-[12px] text-muted-2">结果较多，再输入几个字缩小范围</p>
          )}
        </div>
      </Sheet>
    </>
  );
}

function SchoolRow({
  school,
  province,
  showProvince = true,
  onClick,
}: {
  school: School;
  province: string;
  showProvince?: boolean;
  onClick: () => void;
}) {
  const meta = [showProvince ? province : "", school.city, levelLabel(school.level)]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-field px-3 py-2.5 text-left",
        "transition-colors hover:bg-brand-soft/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-[15px] text-ink">{school.name}</span>
        {meta && <span className="block truncate text-[12px] text-muted-2">{meta}</span>}
      </span>
    </button>
  );
}
