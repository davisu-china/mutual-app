import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Empty, ListSkeleton } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, type Interactor } from "@/lib/api";
import { cn } from "@/lib/utils";

type Tab = "likes" | "visits";

/**
 * 心动页：谁喜欢我 / 谁看过我。
 *
 * 「回喜欢」是这个页面的一级动作——对方已经表达过兴趣，回应不该再多绕一步。
 * 但回 Like 会消耗每日额度（PRD 已定），所以顶部常驻剩余额度提示，
 * 避免用户点到第 8 个人发现点不动了才知道。
 */
export default function Likes() {
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("likes");
  const [list, setList] = useState<Interactor[] | null>(null);
  const [quotaRemain, setQuotaRemain] = useState<number | null>(null);

  const load = useCallback(async () => {
    setList(null);
    try {
      const r = await api.get<{ items: Interactor[] }>(
        tab === "likes" ? "/likes-me" : "/visits-me"
      );
      setList(r.items ?? []);
    } catch (e) {
      if (e instanceof ApiError && e.code === "ONBOARDING_REQUIRED") {
        nav("/onboarding", { replace: true });
        return;
      }
      setList([]);
    }
  }, [tab, nav]);

  useEffect(() => {
    void load();
    api
      .get<{ remain: number }>("/quota")
      .then((q) => setQuotaRemain(q.remain))
      .catch(() => {});
  }, [load]);

  async function likeBack(u: Interactor) {
    try {
      const res = await api.post<{ matched: boolean; quotaRemain: number }>("/actions", {
        toUser: u.userId,
        action: "like",
        source: "likes_me",
      });
      setQuotaRemain(res.quotaRemain);
      setList((prev) => (prev ? prev.filter((x) => x.userId !== u.userId) : prev));
      toast(res.matched ? `和 ${u.nickname} 配对成功` : "已表达喜欢");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "操作失败", "error");
    }
  }

  async function pass(u: Interactor) {
    // 乐观移除
    setList((prev) => (prev ? prev.filter((x) => x.userId !== u.userId) : prev));
    try {
      await api.post("/actions", { toUser: u.userId, action: "pass", source: "likes_me" });
    } catch {
      void load();
    }
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-10 border-b border-line-soft bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-[520px] items-center gap-5 px-5 pb-0 pt-3">
          <TabBtn on={tab === "likes"} onClick={() => setTab("likes")}>
            喜欢我
          </TabBtn>
          <TabBtn on={tab === "visits"} onClick={() => setTab("visits")}>
            看过我
          </TabBtn>
        </div>
      </header>

      <main className="mx-auto max-w-[520px] px-5 pb-6 pt-3">
        {tab === "likes" && quotaRemain !== null && (
          <p className="mb-3 rounded-field bg-brand-soft/70 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-brand-dark">
            回喜欢会消耗 1 次每日额度，今天还剩 <b>{quotaRemain}</b> 次
          </p>
        )}

        {list === null ? (
          <ListSkeleton rows={5} />
        ) : list.length === 0 ? (
          <Empty
            title={tab === "likes" ? "还没有人喜欢你" : "还没有人看过你"}
            desc={
              tab === "likes"
                ? "完善资料、多上传几张照片，会明显提高被喜欢的概率。"
                : "去看看划卡和广场吧，互动多了自然会有人来看你。"
            }
            action={<Button variant="outline" onClick={() => nav("/")}>去划卡</Button>}
          />
        ) : (
          <div className="divide-y divide-line-soft overflow-hidden rounded-card border border-line bg-surface">
            {list.map((u) => (
              <div key={u.userId} className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => nav(`/u/${u.userId}`)}
                  className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-line-soft"
                >
                  {u.avatarUrl ? (
                    <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-[16px] font-bold text-muted-2">
                      {u.nickname.slice(0, 1)}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => nav(`/u/${u.userId}`)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-[14.5px] font-medium text-ink">
                    {u.nickname} <span className="text-[12px] font-normal text-muted-2">{u.age}</span>
                  </p>
                  <p className="truncate text-[12px] text-muted-2">
                    {u.city}
                    {u.heightCm ? ` · ${u.heightCm}cm` : ""}
                    {u.occupation ? ` · ${u.occupation}` : ""}
                  </p>
                </button>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => pass(u)}
                    className="text-[12px] text-muted-2"
                    aria-label="忽略"
                  >
                    忽略
                  </button>
                  {tab === "likes" && (
                    <button
                      type="button"
                      onClick={() => likeBack(u)}
                      className="rounded-full bg-gradient-to-br from-[#EF7183] to-[#D8445C] px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-transform active:scale-95"
                    >
                      回喜欢
                    </button>
                  )}
                  {tab === "visits" && (
                    <button
                      type="button"
                      onClick={() => likeBack(u)}
                      className="rounded-full border border-brand px-3.5 py-1.5 text-[12.5px] font-medium text-brand transition-transform active:scale-95"
                    >
                      喜欢
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function TabBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border-b-2 pb-2.5 text-[14.5px] transition-colors",
        on ? "border-brand font-semibold text-brand" : "border-transparent text-muted-2"
      )}
    >
      {children}
    </button>
  );
}
