import { useMemo, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { FieldRow } from "@/components/ui/field-row";
import {
  HOT_CITIES,
  REGIONS,
  searchCities,
  shortName,
  type Region,
} from "@/data/regions";
import { cn } from "@/lib/utils";

export interface RegionValue {
  province: string;
  city: string;
}

interface RegionFieldProps {
  value: RegionValue | null;
  onChange: (v: RegionValue) => void;
  label?: string;
  placeholder?: string;
  error?: string;
}

/**
 * 省市选择器。
 *
 * 设计判断：**搜索优先，而不是滚动优先。**
 * 全国有 34 个省级行政区、330+ 个地级市。如果用「省列表 → 市列表」两级滚动，
 * 用户在第二步平均要翻十几屏。而实际上用户心里想的是「我在杭州」，
 * 不是「杭州属于浙江」——所以让他直接打「hangzhou」或「杭州」是最短的路径。
 *
 * 因此这里是三件事按优先级叠起来的：
 *   1. 搜索框（常驻顶部，永远最快）
 *   2. 热门城市胶囊（覆盖约 80% 的用户，一次点击到位，连搜索都省了）
 *   3. 省份 → 城市列表（兜底，给不在热门城市里的用户）
 */
export function RegionField({
  value,
  onChange,
  label = "现居地",
  placeholder = "请选择城市",
  error,
}: RegionFieldProps) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [activeProvince, setActiveProvince] = useState<Region | null>(null);

  const hits = useMemo(() => searchCities(keyword), [keyword]);

  function openSheet() {
    setKeyword("");
    setActiveProvince(null);
    setOpen(true);
  }

  function pick(province: string, city: string) {
    onChange({ province, city });
    setOpen(false);
  }

  const isSearching = keyword.trim().length > 0;

  return (
    <>
      <FieldRow
        label={label}
        value={value ? `${shortName(value.province)} · ${shortName(value.city)}` : undefined}
        placeholder={placeholder}
        onClick={openSheet}
        error={error}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={activeProvince ? shortName(activeProvince.name) : label}
      >
        {/* 返回省级列表 */}
        {activeProvince && (
          <div className="px-5 pb-2">
            <button
              type="button"
              onClick={() => setActiveProvince(null)}
              className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-1 text-[14px] text-muted hover:text-ink transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              返回省份
            </button>
          </div>
        )}

        {/* 搜索框常驻——它是这一屏的主路径，不是辅助功能 */}
        {!activeProvince && (
          <div className="px-5 pb-3">
            <div className="flex items-center gap-2 rounded-field border border-line bg-paper px-3 py-2.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0 text-muted-2" aria-hidden="true">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索城市，如「杭州」或「hangzhou」"
                className="w-full bg-transparent text-[15px] text-ink placeholder:text-muted-2 focus:outline-none"
                autoComplete="off"
              />
              {keyword && (
                <button
                  type="button"
                  onClick={() => setKeyword("")}
                  className="shrink-0 text-muted-2 hover:text-ink"
                  aria-label="清空搜索"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" fill="currentColor" opacity=".15" />
                    <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}

        <div className="max-h-[46vh] overflow-y-auto overscroll-contain pb-4">
          {/* ---------- 搜索结果 ---------- */}
          {isSearching && (
            <div className="px-2">
              {hits.length === 0 ? (
                <p className="px-3 py-8 text-center text-[14px] text-muted-2">
                  没有找到「{keyword}」相关的城市
                </p>
              ) : (
                hits.map((hit) => (
                  <button
                    key={`${hit.province}/${hit.city}`}
                    type="button"
                    onClick={() => pick(hit.province, hit.city)}
                    className="flex w-full items-center justify-between rounded-field px-3 py-3 text-left transition-colors hover:bg-paper active:bg-paper"
                  >
                    <span className="text-[15px] text-ink">{shortName(hit.city)}</span>
                    <span className="text-[13px] text-muted-2">
                      {shortName(hit.province)}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {/* ---------- 热门城市 ---------- */}
          {!isSearching && !activeProvince && (
            <div className="px-5 pb-4">
              <p className="mb-2.5 text-[12px] font-medium tracking-wide text-muted-2">
                热门城市
              </p>
              <div className="flex flex-wrap gap-2">
                {HOT_CITIES.map((h) => (
                  <button
                    key={h.city}
                    type="button"
                    onClick={() => pick(h.province, h.city)}
                    className={cn(
                      "rounded-full border px-3.5 py-1.5 text-[14px] transition-colors",
                      value?.city === h.city
                        ? "border-brand bg-brand-soft font-medium text-brand-dark"
                        : "border-line text-ink hover:border-brand/40"
                    )}
                  >
                    {shortName(h.city)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ---------- 省份列表 / 城市列表 ---------- */}
          {!isSearching && (
            <div className="px-2">
              {!activeProvince && (
                <p className="px-3 pb-1.5 pt-1 text-[12px] font-medium tracking-wide text-muted-2">
                  全部省份
                </p>
              )}
              {(activeProvince ? activeProvince.cities : REGIONS.map((r) => r.name)).map(
                (item) => {
                  if (activeProvince) {
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => pick(activeProvince.name, item)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-field px-3 py-3 text-left transition-colors hover:bg-paper",
                          value?.city === item && "bg-brand-soft"
                        )}
                      >
                        <span className="text-[15px] text-ink">{shortName(item)}</span>
                        {value?.city === item && (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-brand" aria-hidden="true">
                            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                    );
                  }
                  const region = REGIONS.find((r) => r.name === item)!;
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setActiveProvince(region)}
                      className="flex w-full items-center justify-between rounded-field px-3 py-3 text-left transition-colors hover:bg-paper"
                    >
                      <span className="text-[15px] text-ink">{shortName(item)}</span>
                      <span className="flex items-center gap-1 text-[13px] text-muted-2">
                        {region.cities.length} 市
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </button>
                  );
                }
              )}
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}
