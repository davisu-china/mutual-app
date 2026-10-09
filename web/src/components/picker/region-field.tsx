import { useCallback, useEffect, useMemo, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { FieldRow } from "@/components/ui/field-row";
import { Spinner } from "@/components/ui/button";
import {
  loadRegions,
  searchRegions,
  shortName,
  fullName,
  type Province,
  type RegionHit,
} from "@/data/regions";

export interface RegionValue {
  province: string;
  city: string;
  /** 现居地精确到区；家乡通常只到市 */
  district?: string;
}

interface RegionFieldProps {
  value: RegionValue | null;
  onChange: (v: RegionValue) => void;
  label?: string;
  placeholder?: string;
  /** 是否要求选到区一级（现居地用 true，家乡用 false） */
  withDistrict?: boolean;
  error?: string;
}

type Stage = "province" | "city" | "district";

/**
 * 省市选择器（支持到区）。
 *
 * 设计判断：**搜索优先，而不是滚动优先。**
 * 全国有 34 个省级、366 个市级、3439 个区县级。逐级滚动，用户在最后一级
 * 平均要翻十几屏。而用户心里想的是「我在杭州西湖区」，不是「杭州属于浙江」
 * ——让他直接打 `hz` 或「西湖」是最短的路径。
 *
 * 所以这里三件事按优先级叠起来：
 *   1. 搜索框（常驻顶部，永远最快）
 *   2. 逐级列表（兜底，给不确定归属的用户）
 *   3. 直辖市特判：北京/上海的用户直接选到区，不会看到「北京市 > 北京市」
 */
export function RegionField({
  value,
  onChange,
  label = "现居地",
  placeholder = "请选择城市",
  withDistrict = false,
  error,
}: RegionFieldProps) {
  const [open, setOpen] = useState(false);
  const [provinces, setProvinces] = useState<Province[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [stage, setStage] = useState<Stage>("province");
  const [pickedProvince, setPickedProvince] = useState<Province | null>(null);
  const [pickedCity, setPickedCity] = useState<string>("");

  // 打开时才加载完整区划树（216KB，不该进首屏包）
  useEffect(() => {
    if (!open || provinces) return;
    setLoading(true);
    loadRegions()
      .then(setProvinces)
      .finally(() => setLoading(false));
  }, [open, provinces]);

  const hits = useMemo(
    () => (provinces && keyword.trim() ? searchRegions(provinces, keyword) : []),
    [provinces, keyword]
  );

  const isSearching = keyword.trim().length > 0;

  const openSheet = useCallback(() => {
    setKeyword("");
    setStage("province");
    setPickedProvince(null);
    setPickedCity("");
    setOpen(true);
  }, []);

  /** 选中一个省：直辖市直接进区列表，其余进市列表 */
  function chooseProvince(p: Province) {
    setPickedProvince(p);
    if (p.isMunicipality) {
      // 直辖市没有独立市级，直接把城市名设为省名
      setPickedCity(p.name);
      setStage("district");
    } else {
      setStage("city");
    }
  }

  function chooseCity(city: string) {
    setPickedCity(city);
    if (withDistrict) {
      setStage("district");
    } else {
      finish({ province: pickedProvince!.name, city });
    }
  }

  function finish(v: RegionValue) {
    onChange(v);
    setOpen(false);
  }

  /** 搜索结果里的一条 → 直接落到对应层级 */
  function pickHit(hit: RegionHit) {
    if (hit.level === "district" && hit.district) {
      finish({ province: hit.province, city: hit.city, district: hit.district });
      return;
    }
    // 命中市：如果这个市其实没有区（少见），或者不需要区，直接完成
    const prov = provinces?.find((p) => p.name === hit.province);
    const city = prov?.cities.find((c) => c.name === hit.city);
    if (withDistrict && city && city.districts.length > 0) {
      setPickedProvince(prov ?? null);
      setPickedCity(city.name);
      setKeyword("");
      setStage("district");
      return;
    }
    finish({ province: hit.province, city: hit.city });
  }

  const display = value
    ? fullName(value.province, value.city, withDistrict ? value.district : undefined)
    : undefined;

  const currentCity = useMemo(() => {
    if (!pickedProvince || !pickedCity) return null;
    return pickedProvince.cities.find((c) => c.name === pickedCity) ?? null;
  }, [pickedProvince, pickedCity]);

  const title =
    stage === "province" ? label : stage === "city" ? shortName(pickedProvince?.name ?? "") : shortName(pickedCity);

  return (
    <>
      <FieldRow
        label={label}
        value={display}
        placeholder={placeholder}
        onClick={openSheet}
        error={error}
      />

      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        {/* 返回上一级 */}
        {stage !== "province" && (
          <div className="px-5 pb-2">
            <button
              type="button"
              onClick={() => setStage(stage === "district" ? "city" : "province")}
              className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-1 text-[14px] text-muted transition-colors hover:text-ink"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              返回
            </button>
          </div>
        )}

        {/* 搜索框常驻——它是这一屏的主路径，不是辅助功能 */}
        {stage === "province" && (
          <div className="px-5 pb-3">
            <div className="flex items-center gap-2 rounded-field border border-line bg-paper px-3 py-2.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0 text-muted-2" aria-hidden="true">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索，如「杭州」「西湖」或「hz」"
                className="w-full bg-transparent text-[15px] text-ink placeholder:text-muted-2 focus:outline-none"
                autoComplete="off"
              />
              {keyword && (
                <button type="button" onClick={() => setKeyword("")} className="shrink-0 text-muted-2" aria-label="清空">
                  ×
                </button>
              )}
            </div>
          </div>
        )}

        <div className="max-h-[46vh] overflow-y-auto overscroll-contain pb-4">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-[14px] text-muted-2">
              <Spinner /> 加载区划数据…
            </div>
          )}

          {/* ---------- 搜索结果 ---------- */}
          {!loading && isSearching && (
            <div className="px-2">
              {hits.length === 0 ? (
                <p className="px-3 py-8 text-center text-[14px] text-muted-2">
                  没有找到「{keyword}」相关的地名
                </p>
              ) : (
                hits.map((h) => (
                  <button
                    key={`${h.province}/${h.city}/${h.district ?? ""}`}
                    type="button"
                    onClick={() => pickHit(h)}
                    className="flex w-full items-center justify-between rounded-field px-3 py-3 text-left transition-colors hover:bg-paper active:bg-paper"
                  >
                    <span className="text-[15px] text-ink">
                      {shortName(h.district ?? h.city)}
                      {h.level === "district" && (
                        <span className="ml-1.5 text-[12px] text-muted-2">区/县</span>
                      )}
                    </span>
                    <span className="text-[13px] text-muted-2">
                      {h.city && h.city !== h.province ? `${shortName(h.city)} · ` : ""}
                      {shortName(h.province)}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {/* ---------- 省级列表 ---------- */}
          {!loading && !isSearching && stage === "province" && (
            <div className="px-2">
              {(provinces ?? []).map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => chooseProvince(p)}
                  className="flex w-full items-center justify-between rounded-field px-3 py-3 text-left transition-colors hover:bg-paper"
                >
                  <span className="text-[15px] text-ink">{shortName(p.name)}</span>
                  <span className="flex items-center gap-1 text-[13px] text-muted-2">
                    {p.isMunicipality ? `${p.cities[0]?.districts.length ?? 0} 区` : `${p.cities.length} 市`}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* ---------- 市级列表 ---------- */}
          {!loading && !isSearching && stage === "city" && pickedProvince && (
            <div className="px-2">
              {pickedProvince.cities.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => chooseCity(c.name)}
                  className="flex w-full items-center justify-between rounded-field px-3 py-3 text-left transition-colors hover:bg-paper"
                >
                  <span className="text-[15px] text-ink">{shortName(c.name)}</span>
                  <span className="flex items-center gap-1 text-[13px] text-muted-2">
                    {c.districts.length > 0 ? `${c.districts.length} 区` : ""}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* ---------- 区级列表 ---------- */}
          {!loading && !isSearching && stage === "district" && (
            <div className="px-2">
              {currentCity?.districts.length ? (
                currentCity.districts.map((d) => (
                  <button
                    key={d.name}
                    type="button"
                    onClick={() =>
                      finish({
                        province: pickedProvince!.name,
                        city: pickedCity,
                        district: d.name,
                      })
                    }
                    className="flex w-full items-center justify-between rounded-field px-3 py-3 text-left transition-colors hover:bg-paper"
                  >
                    <span className="text-[15px] text-ink">{shortName(d.name)}</span>
                    {value?.district === d.name && (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-brand" aria-hidden="true">
                        <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                ))
              ) : (
                <button
                  type="button"
                  onClick={() => finish({ province: pickedProvince!.name, city: pickedCity })}
                  className="w-full rounded-field px-3 py-4 text-center text-[14px] text-brand"
                >
                  这个市没有下级区县，直接选定
                </button>
              )}
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}
