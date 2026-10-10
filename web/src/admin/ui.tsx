import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 后台共用的小件。刻意都做得很安静——这一屏是看数据的，界面不该抢戏。 */

export const fmt = (n: number | undefined | null) => (n ?? 0).toLocaleString("zh-CN");
export const pct = (v: number | undefined) => `${((v ?? 0) * 100).toFixed(1)}%`;

export const GENDER_LABEL: Record<number, string> = { 1: "男", 2: "女" };
export const genderText = (g: number | null | undefined) => (g ? GENDER_LABEL[g] ?? "—" : "未填");

const STATUS: Record<string, { text: string; cls: string }> = {
  active: { text: "正常", cls: "border-brand/30 bg-brand-soft text-brand-dark" },
  registered: { text: "未完成资料", cls: "border-line bg-line-soft text-muted" },
  frozen: { text: "冻结待审", cls: "border-gold-line bg-gold-soft text-gold" },
  banned: { text: "已封禁", cls: "border-danger/30 bg-danger/5 text-danger" },
  deleted: { text: "已注销", cls: "border-line bg-line-soft text-muted-2" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { text: status, cls: "border-line bg-line-soft text-muted" };
  return <span className={cn("rounded-pill border px-2 py-0.5 text-[11.5px]", s.cls)}>{s.text}</span>;
}

export function Card({ title, extra, children, className }: { title?: string; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-card border border-line bg-surface p-5 shadow-card", className)}>
      {title ? (
        <header className="mb-4 flex items-baseline justify-between gap-3">
          <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
          {extra}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** 指标块。数字用 tabular-nums——同一行的数字要能对齐，不然扫读时一直在重新定位 */
export function Kpi({ label, value, sub, tone = "ink" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ink" | "brand" | "gold" }) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3.5 shadow-card">
      <div className="text-[12px] text-muted-2">{label}</div>
      <div
        className={cn(
          "mt-1 text-[24px] font-semibold tabular-nums leading-tight",
          tone === "brand" && "text-brand",
          tone === "gold" && "text-gold",
          tone === "ink" && "text-ink"
        )}
      >
        {value}
      </div>
      {sub ? <div className="mt-1 text-[12px] text-muted">{sub}</div> : null}
    </div>
  );
}

export function Pager({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <div className="py-3 text-[12px] text-muted-2">共 {fmt(total)} 条</div>;
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-[12px] text-muted-2">
        共 {fmt(total)} 条 · 第 {page} / {pages} 页
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="rounded-field border border-line px-3 py-1 text-[12.5px] text-muted transition-colors hover:border-brand/40 hover:text-ink disabled:opacity-40"
        >
          上一页
        </button>
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
          className="rounded-field border border-line px-3 py-1 text-[12.5px] text-muted transition-colors hover:border-brand/40 hover:text-ink disabled:opacity-40"
        >
          下一页
        </button>
      </div>
    </div>
  );
}

export function Loading({ label = "加载中" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-[13px] text-muted-2">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-brand" />
      {label}…
    </div>
  );
}

export function ErrorNote({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-field border border-brand/20 bg-brand-soft px-4 py-3 text-[13px] text-brand-dark">
      <span>{msg}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="shrink-0 underline underline-offset-2">
          重试
        </button>
      ) : null}
    </div>
  );
}

export function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return <th className={cn("whitespace-nowrap px-3 py-2 font-normal text-muted-2", right ? "text-right" : "text-left")}>{children}</th>;
}

export function Td({ children, right, mono }: { children: ReactNode; right?: boolean; mono?: boolean }) {
  return (
    <td className={cn("whitespace-nowrap px-3 py-2 text-ink-2", right && "text-right tabular-nums", mono && "font-mono text-[12px]")}>
      {children}
    </td>
  );
}

/** 头像：没有就显示昵称首字。后台看的是"这个人是谁"，一片灰方块帮不上忙 */
export function Avatar({ url, name, size = 32 }: { url?: string; name: string; size?: number }) {
  if (url) {
    return <img src={url} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-brand-soft text-[12px] text-brand-dark"
      style={{ width: size, height: size }}
    >
      {(name || "?").slice(0, 1)}
    </span>
  );
}

/**
 * 极小的取数 hook。
 *
 * 没有用 react-query：后台这几屏都是"进页面取一次、改筛选重取"，
 * 用一个 15 行的 hook 就够了，也省得为它去给整个 App 套 Provider
 * （那会牵动交友端本来就跑着的渲染树）。
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    fn()
      .then((d) => alive && setState({ data: d, loading: false }))
      .catch((e: unknown) => alive && setState({ error: e instanceof Error ? e.message : "加载失败", loading: false }));
    return () => {
      alive = false;
    };
    // fn 每次渲染都是新函数，不能进依赖；由调用方用 deps 明确说明"什么时候该重取"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}
