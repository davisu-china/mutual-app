import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Clock, Compass, Flame, Heart, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ProfileCard } from "@/components/deck/profile-card";
import { MatchOverlay } from "@/components/deck/match-overlay";
import { Button } from "@/components/ui/button";
import { CardSkeleton, Empty } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, type ActionResult, type Card } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

const BATCH = 10;

export default function Discover() {
  const nav = useNavigate();
  const toast = useToast();

  const [cards, setCards] = useState<Card[] | null>(null);
  const [quota, setQuota] = useState({ used: 0, limit: 10, remain: 10 });
  const [exitDir, setExitDir] = useState<"like" | "pass" | null>(null);
  const [matchInfo, setMatchInfo] = useState<{ peerId: number; peerNickname: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const myAvatar = useRef<string>("");

  // 加载卡片（含额度）
  const load = useCallback(async () => {
    try {
      const r = await api.get<{ cards: Card[]; quota: typeof quota }>(
        `/cards?limit=${BATCH}`
      );
      setCards(r.cards ?? []);
      setQuota(r.quota);
    } catch (e) {
      if (e instanceof ApiError && e.code === "ONBOARDING_REQUIRED") {
        nav("/onboarding", { replace: true });
        return;
      }
      toast(e instanceof ApiError ? e.message : "加载失败", "error");
      setCards([]);
    }
  }, [nav, toast]);

  useEffect(() => {
    void load();
    api
      .get<{ avatarUrl: string }>("/users/me")
      .then((p) => (myAvatar.current = p.avatarUrl))
      .catch(() => {});
  }, [load]);

  // 预加载接下来的几张图。图片没到位的话，动画再顺也会在换图时卡一下。
  useLayoutEffect(() => {
    if (!cards?.length) return;
    cards.slice(0, 3).forEach((c) => {
      const url = c.photos?.[0] || c.avatarUrl;
      if (url) {
        const img = new Image();
        img.src = url;
      }
    });
  }, [cards]);

  const top = cards?.[0];

  const act = useCallback(
    async (action: "like" | "pass") => {
      if (!top || busy) return;

      // 乐观更新：先让卡片飞走、额度先扣，请求在后台跑。
      // 用户感知到的延迟是 0——这是「丝滑」的关键（技术方案第 6 章）。
      setBusy(true);
      setExitDir(action === "like" ? "like" : "pass");
      haptic(action === "like" ? 14 : 8);

      const snapshot = cards;
      const prevQuota = quota;
      setCards((prev) => (prev ? prev.slice(1) : prev));
      if (action === "like") {
        setQuota((q) => ({ ...q, used: q.used + 1, remain: Math.max(0, q.remain - 1) }));
      }

      try {
        const res = await api.post<ActionResult>("/actions", {
          toUser: top.userId,
          action,
          source: "card",
        });
        setQuota({ used: res.quotaUsed, limit: res.quotaLimit, remain: res.quotaRemain });
        if (res.matched) {
          setMatchInfo({ peerId: top.userId, peerNickname: top.nickname });
        }
      } catch (e) {
        // 失败回滚：把卡片放回去、额度还原
        setCards(snapshot ?? null);
        setQuota(prevQuota);
        toast(e instanceof ApiError ? e.message : "操作失败，请重试", "error");
      } finally {
        setExitDir(null);
        setBusy(false);
      }
    },
    [top, busy, cards, quota, toast]
  );

  // 剩 3 张时后台续拉，用户滑到底不会看到空白
  useEffect(() => {
    if (cards && cards.length > 0 && cards.length <= 3) {
      api
        .get<{ cards: Card[] }>(`/cards?limit=${BATCH}`)
        .then((r) => {
          const fresh = (r.cards ?? []).filter(
            (c) => !cards.some((x) => x.userId === c.userId)
          );
          if (fresh.length) setCards((prev) => [...(prev ?? []), ...fresh]);
        })
        .catch(() => {});
    }
  }, [cards]);

  // 键盘操作：← 跳过、→ 喜欢。按钮方案的天然优势，顺手就做了。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchInfo) return;
      if (e.key === "ArrowLeft") void act("pass");
      if (e.key === "ArrowRight") void act("like");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, matchInfo]);

  const exhausted = quota.remain <= 0;

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      {/* 顶部额度 */}
      <header className="flex items-center justify-between px-5 pb-3 pt-4">
        <span className="text-[17px] font-bold tracking-tight text-ink">相悦</span>
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium tabular-nums",
            exhausted ? "bg-line-soft text-muted-2" : "bg-brand-soft text-brand-dark"
          )}
        >
          <Flame size={13} strokeWidth={2.2} aria-hidden="true" />
          今日还可喜欢 {quota.remain} 人
        </span>
      </header>

      <main className="flex flex-1 flex-col px-5 pb-2">
        <div className="relative h-[322px]">
          {cards === null ? (
            <CardSkeleton />
          ) : cards.length === 0 ? (
            <Empty
              icon={exhausted ? Clock : Compass}
              title={exhausted ? "今日额度已用完" : "暂时没有新的推荐"}
              desc={
                exhausted
                  ? "明天 00:00 恢复。也可以去恋爱广场主动找人——浏览不消耗额度。"
                  : "试试放宽一点偏好条件，或者过一会儿再来。完善资料也能让更多人看到你。"
              }
              action={
                <Button variant="outline" onClick={() => nav("/plaza")}>
                  去恋爱广场
                </Button>
              }
            />
          ) : (
            <AnimatePresence initial={false}>
              {cards.slice(0, 3).map((c, i) => {
                const isTop = i === 0;
                return (
                  <motion.div
                    key={c.userId}
                    className="absolute inset-0"
                    style={{ zIndex: 10 - i }}
                    initial={false}
                    animate={{
                      scale: 1 - i * 0.045,
                      y: i * 13,
                      opacity: i === 0 ? 1 : i === 1 ? 0.62 : 0.32,
                    }}
                    exit={
                      isTop
                        ? {
                            x: exitDir === "like" ? 340 : -340,
                            y: -70,
                            rotate: exitDir === "like" ? 16 : -16,
                            opacity: 0,
                          }
                        : { opacity: 0 }
                    }
                    transition={{ type: "spring", stiffness: 280, damping: 28 }}
                  >
                    <div
                      onClick={() => nav(`/u/${c.userId}`)}
                      className="h-full cursor-pointer"
                    >
                      <ProfileCard card={c} />
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>

        {/* 按钮组：只有两个。
            点卡片本身进详情（同时记一次 Visit），所以不需要第三个「详情」按钮。 */}
        <div className="flex items-center justify-center gap-7 pt-5">
          <button
            type="button"
            aria-label="跳过"
            disabled={!top || busy}
            onClick={() => act("pass")}
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface",
              "text-muted shadow-sm transition-all duration-150",
              "active:scale-95 disabled:opacity-40",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            )}
          >
            <X size={26} strokeWidth={2.2} aria-hidden="true" />
          </button>

          <button
            type="button"
            aria-label="喜欢"
            disabled={!top || busy || exhausted}
            onClick={() => act("like")}
            className={cn(
              "flex h-16 w-16 items-center justify-center rounded-full text-white",
              "bg-gradient-to-br from-brand to-brand-dark",
              "shadow-[0_6px_18px_rgba(192,69,90,.34)] transition-all duration-150",
              "active:scale-95 disabled:opacity-40 disabled:shadow-none",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            )}
          >
            <Heart size={30} strokeWidth={2.2} fill="currentColor" aria-hidden="true" />
          </button>
        </div>

        {exhausted && cards && cards.length > 0 && (
          <p className="pt-4 text-center text-[12.5px] text-muted-2">
            今日额度已用完，明天 00:00 恢复
          </p>
        )}
      </main>

      <AnimatePresence>
        {matchInfo && (
          <MatchOverlay
            myAvatar={myAvatar.current}
            peerAvatar={top?.avatarUrl}
            peerNickname={matchInfo.peerNickname}
            onChat={() =>
              nav("/chat", { state: { peerId: matchInfo.peerId } })
            }
            onClose={() => setMatchInfo(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
