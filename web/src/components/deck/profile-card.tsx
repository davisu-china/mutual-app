import type { Card } from "@/lib/api";
import { EDUCATION_LABEL } from "@/data/options";

/** 距离按区间展示，不给精确值——既诚实，也保护隐私（PRD 第 15 章） */
function distanceText(km: number): string {
  if (km <= 1) return "1 km 内";
  if (km <= 3) return "1–3 km";
  if (km <= 5) return "3–5 km";
  if (km <= 10) return "5–10 km";
  if (km <= 50) return `${Math.round(km / 10) * 10} km 左右`;
  return "50 km 以上";
}

export function ProfileCard({ card, compact }: { card: Card; compact?: boolean }) {
  const photo = card.photos?.[0] || card.avatarUrl;
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[18px] border border-black/5 bg-surface shadow-card">
      {/* 主图 */}
      <div className="relative shrink-0 overflow-hidden" style={{ height: compact ? 200 : 216 }}>
        {photo ? (
          <img
            src={photo}
            alt=""
            className="h-full w-full object-cover"
            // 图片解码是异步的，加个淡入避免「白块突然变图」的跳动
            onLoad={(e) => (e.currentTarget.style.opacity = "1")}
            style={{ opacity: 0, transition: "opacity .2s ease-out" }}
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-brand-soft to-line" />
        )}

        {card.hasDistance && (
          <span className="absolute right-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-[10px] text-white backdrop-blur-sm">
            {distanceText(card.distanceKm)}
          </span>
        )}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-4 pb-3 pt-10">
          <p className="text-[17px] font-bold leading-tight text-white drop-shadow">
            {card.nickname}
          </p>
          <p className="mt-0.5 text-[11.5px] text-white/90">
            {card.age} 岁 · {card.city} · {card.heightCm}cm
          </p>
        </div>
      </div>

      {/* 信息区 */}
      <div className="flex flex-1 flex-col px-4 pb-3 pt-3">
        <p className="mb-2.5 text-[11.5px] text-muted">
          {card.occupation}
          {card.education ? ` · ${EDUCATION_LABEL(card.education)}` : ""}
        </p>

        <div className="flex flex-wrap gap-1.5">
          {(card.hobbies ?? []).slice(0, 3).map((h) => (
            <span
              key={h}
              className="rounded-full border border-brand-line bg-brand-soft px-2.5 py-[3px] text-[10px] font-medium text-brand-dark"
            >
              {h}
            </span>
          ))}
          {card.age && (
            <span className="rounded-full border border-line bg-line-soft px-2.5 py-[3px] text-[10px] text-muted">
              {card.age} 岁
            </span>
          )}
        </div>

        {/* 软条件不完全满足时明确告知，而不是偷偷排在后面（PRD 7.2） */}
        {card.softMismatch && card.softMismatch.length > 0 && (
          <p className="mt-auto pt-2 text-[10.5px] text-muted-2">
            部分条件不符：{card.softMismatch.slice(0, 3).join("、")}
          </p>
        )}
      </div>
    </div>
  );
}
