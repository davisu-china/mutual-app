import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ListSkeleton, Empty } from "@/components/ui/empty";
import { ProfileCard } from "@/components/deck/profile-card";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, type Card } from "@/lib/api";
import { EDUCATION } from "@/data/options";
import { PROVINCE_NAMES, provinceShort } from "@/data/regions";
import { cn } from "@/lib/utils";

interface Filter {
  gender?: number;
  ageMin?: number;
  ageMax?: number;
  heightMin?: number;
  heightMax?: number;
  cityProvince?: string;
  education?: number;
}

// 省份筛选用的官方名单（国家统计局口径，34 个省级行政区）
const PROVINCES = PROVINCE_NAMES;

/**
 * 恋爱广场。
 *
 * 浏览与筛选**不消耗额度**，只有点「喜欢」才消耗（PRD 10.3）。
 * 所以这里的交互重心是「让人快速找到想找的人」，而不是控制消耗。
 */
export default function Plaza() {
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState<Filter>({ gender: undefined });
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
    });
    return p.toString();
  }, [f]);

  const search = useCallback(
    async (nextCursor = 0) => {
      try {
        const r = await api.get<{ cards: Card[]; nextCursor: number }>(
          `/plaza?${qs}${nextCursor ? `&cursor=${nextCursor}` : ""}`
        );
        setCards((prev) => (nextCursor ? [...(prev ?? []), ...(r.cards ?? [])] : r.cards ?? []));
        setCursor(r.nextCursor ?? 0);
      } catch (e) {
        if (e instanceof ApiError && e.code === "ONBOARDING_REQUIRED") {
          nav("/onboarding", { replace: true });
          return;
        }
        toast(e instanceof ApiError ? e.message : "检索失败", "error");
        setCards([]);
      }
    },
    [qs, nav, toast]
  );

  useEffect(() => {
    setCards(null);
    void search(0);
    // 筛选条件变化即重新检索
  }, [qs]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeCount = Object.values(f).filter((v) => v !== undefined).length;

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-10 border-b border-line-soft bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-[520px] items-center justify-between px-5 py-3">
          <span className="text-[17px] font-bold text-ink">恋爱广场</span>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[13px] transition-colors",
              activeCount > 0
                ? "border-brand bg-brand-soft font-medium text-brand-dark"
                : "border-line text-muted"
            )}
          >
            筛选{activeCount > 0 ? ` · ${activeCount}` : ""}
          </button>
        </div>

        {open && (
          <div className="mx-auto max-w-[520px] space-y-4 border-t border-line-soft px-5 py-4">
            <Row label="性别">
              {[{ v: undefined, t: "不限" }, { v: 2, t: "女" }, { v: 1, t: "男" }].map((o) => (
                <Chip key={String(o.v)} on={f.gender === o.v} onClick={() => setF({ ...f, gender: o.v })}>
                  {o.t}
                </Chip>
              ))}
            </Row>

            <Row label="年龄">
              <RangeInput
                min={18} max={70}
                lo={f.ageMin ?? 18} hi={f.ageMax ?? 70}
                onChange={(lo, hi) => setF({ ...f, ageMin: lo, ageMax: hi })}
                clear={() => setF({ ...f, ageMin: undefined, ageMax: undefined })}
                active={f.ageMin !== undefined || f.ageMax !== undefined}
              />
            </Row>

            <Row label="身高">
              <RangeInput
                min={140} max={210}
                lo={f.heightMin ?? 140} hi={f.heightMax ?? 210}
                onChange={(lo, hi) => setF({ ...f, heightMin: lo, heightMax: hi })}
                clear={() => setF({ ...f, heightMin: undefined, heightMax: undefined })}
                active={f.heightMin !== undefined || f.heightMax !== undefined}
              />
            </Row>

            <Row label="省份">
              <Chip on={!f.cityProvince} onClick={() => setF({ ...f, cityProvince: undefined })}>
                不限
              </Chip>
              {PROVINCES.map((p) => (
                <Chip
                  key={p}
                  on={f.cityProvince === p}
                  onClick={() => setF({ ...f, cityProvince: p })}
                >
                  {provinceShort(p)}
                </Chip>
              ))}
            </Row>

            <Row label="学历">
              <Chip on={f.education === undefined} onClick={() => setF({ ...f, education: undefined })}>
                不限
              </Chip>
              {EDUCATION.map((e) => (
                <Chip key={e.value} on={f.education === e.value} onClick={() => setF({ ...f, education: e.value })}>
                  {e.label}
                </Chip>
              ))}
            </Row>

            <div className="flex justify-end pt-1">
              <Button size="sm" variant="ghost" onClick={() => setF({ gender: undefined })}>
                重置
              </Button>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[520px] px-5 py-4">
        {cards === null ? (
          <ListSkeleton rows={4} />
        ) : cards.length === 0 ? (
          <Empty
            title="没有找到符合条件的人"
            desc="试着放宽一些条件——比如去掉学历要求，或扩大年龄范围。"
            action={
              <Button variant="outline" onClick={() => setF({ gender: undefined })}>
                清除筛选条件
              </Button>
            }
          />
        ) : (
          <>
            <p className="mb-3 text-[13px] text-muted-2">
              找到 {cards.length} 人{activeCount > 0 ? "（已按条件筛选）" : ""}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {cards.map((c) => (
                <button
                  key={c.userId}
                  type="button"
                  onClick={() => nav(`/u/${c.userId}`)}
                  className="text-left transition-transform active:scale-[0.98]"
                >
                  <div className="h-[240px]">
                    <ProfileCard card={c} compact />
                  </div>
                </button>
              ))}
            </div>
            {cursor > 0 && (
              <div className="pt-5">
                <Button
                  variant="outline"
                  className="w-full"
                  loading={loadingMore}
                  onClick={async () => {
                    setLoadingMore(true);
                    await search(cursor);
                    setLoadingMore(false);
                  }}
                >
                  加载更多
                </Button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[13px] text-muted-2">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[13px] transition-colors",
        on ? "border-brand bg-brand-soft font-medium text-brand-dark" : "border-line text-ink"
      )}
    >
      {children}
    </button>
  );
}

function RangeInput({
  min, max, lo, hi, onChange, clear, active,
}: {
  min: number; max: number; lo: number; hi: number;
  onChange: (lo: number, hi: number) => void;
  clear: () => void;
  active: boolean;
}) {
  return (
    <div className="w-full">
      <div className="mb-2 flex items-center gap-3">
        <span className="text-[14px] tabular-nums text-ink">{lo} – {hi}</span>
        {active && (
          <button type="button" onClick={clear} className="text-[12px] text-muted-2 underline">
            清除
          </button>
        )}
      </div>
      <div className="flex gap-4">
        <input type="range" min={min} max={max} value={lo}
          onChange={(e) => onChange(Math.min(Number(e.target.value), hi), hi)}
          className="h-1.5 w-full accent-[#E4596B]" />
        <input type="range" min={min} max={max} value={hi}
          onChange={(e) => onChange(lo, Math.max(Number(e.target.value), lo))}
          className="h-1.5 w-full accent-[#E4596B]" />
      </div>
    </div>
  );
}
