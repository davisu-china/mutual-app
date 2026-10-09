import type { ReactNode } from "react";
import { Inbox, type LucideIcon } from "lucide-react";

/** 空态。给一句「为什么空」和「可以做什么」，不要只画一个插图。 */
export function Empty({
  title,
  desc,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  desc?: string;
  action?: ReactNode;
  /** 圆形底衬上的图标；调用方按场景给（心动的空态给心，消息的给对话框） */
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft">
        <Icon size={26} strokeWidth={1.8} className="text-brand" aria-hidden="true" />
      </div>
      <p className="text-[16px] font-medium text-ink">{title}</p>
      {desc && <p className="mt-2 max-w-[280px] text-[14px] leading-relaxed text-muted-2">{desc}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** 骨架屏：形状与真实内容一致，避免加载完成后大幅跳动。 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cnBase("animate-pulse rounded-lg bg-line-soft", className)} />;
}

function cnBase(...c: (string | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function CardSkeleton() {
  return (
    <div className="rounded-[18px] border border-line bg-surface p-4 shadow-card">
      <Skeleton className="mb-4 h-[216px] w-full rounded-[14px]" />
      <Skeleton className="mb-2 h-5 w-2/5" />
      <Skeleton className="mb-4 h-4 w-3/5" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-16 rounded-full" />
        <Skeleton className="h-6 w-16 rounded-full" />
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line-soft">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
          <div className="flex-1">
            <Skeleton className="mb-1.5 h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
