import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, SlidersHorizontal, Store } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ListSkeleton, Empty } from "@/components/ui/empty";
import { ProfileCard } from "@/components/deck/profile-card";
import { ProvinceMultiField } from "@/components/picker/province-field";
import { IncomeRangeField } from "@/components/picker/income-range-field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, type Card } from "@/lib/api";
import { EDUCATION } from "@/data/options";
import { cn } from "@/lib/utils";

interface Filter {
  /** 省份可多选，空/未设表示不限 */
  provinces?: string[];
  education?: number;
  /** 收入按档位下标（1–6）；未设表示这一端不限 */
  incomeMin?: number;
  incomeMax?: number;
}

/**
 * 恋爱广场。
 *
 * 浏览与筛选**不消耗额度**，只有点「喜欢」才消耗（PRD 10.3）。
 * 所以这里的交互重心是「让人快速找到想找的人」，而不是控制消耗。
 */
export default function Plaza() {
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState<Filter>({});
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (f.provinces?.length) p.set("provinces", f.provinces.join(","));
    if (f.education !== undefined) p.set("education", String(f.education));
    if (f.incomeMin !== undefined) p.set("incomeMin", String(f.incomeMin));
    if (f.incomeMax !== undefined) p.set("incomeMax", String(f.incomeMax));
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

  // 一组筛选算一次（省份选了 5 个也只显示「筛选 · 1」）
  const activeCount =
    (f.provinces?.length ? 1 : 0) +
    (f.education !== undefined ? 1 : 0) +
    (f.incomeMin !== undefined || f.incomeMax !== undefined ? 1 : 0);

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-10 border-b border-line-soft bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-[520px] items-center justify-between px-5 py-3">
          <span className="flex items-center gap-2 text-[17px] font-bold text-ink">
            <Store size={19} strokeWidth={2} className="text-brand" aria-hidden="true" />
            恋爱广场
          </span>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors",
              activeCount > 0
                ? "border-brand bg-brand-soft font-medium text-brand-dark"
                : "border-line text-muted"
            )}
          >
            <SlidersHorizontal size={14} strokeWidth={2.1} aria-hidden="true" />
            筛选{activeCount > 0 ? ` · ${activeCount}` : ""}
          </button>
        </div>

        {open && (
          <div className="mx-auto max-w-[520px] space-y-3 border-t border-line-soft px-5 py-4">
            {/* 省份可多选，收进弹层——34 个省铺在筛选面板里会把面板撑爆 */}
            <ProvinceMultiField
              label="省份"
              hint="可多选，不选即不限。"
              value={f.provinces ?? []}
              onChange={(v) => setF({ ...f, provinces: v.length ? v : undefined })}
            />

            {/* 收入按档位给区间；两端都「不限」就不带这个参数 */}
            <IncomeRangeField
              label="年收入"
              min={f.incomeMin ?? 0}
              max={f.incomeMax ?? 7}
              onChange={(lo, hi) =>
                setF({ ...f, incomeMin: lo > 0 ? lo : undefined, incomeMax: hi < 7 ? hi : undefined })
              }
            />

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
              <Button size="sm" variant="ghost" onClick={() => setF({})}>
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
            icon={Search}
            title="没有找到符合条件的人"
            desc="试着放宽一些条件——比如去掉省份或学历的要求。"
            action={
              <Button variant="outline" onClick={() => setF({})}>
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

