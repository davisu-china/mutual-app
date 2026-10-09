import type { Card } from "@/lib/api";
import { Briefcase, MapPin } from "lucide-react";
import { EDUCATION_LABEL } from "@/data/options";
import { cn } from "@/lib/utils";

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

  // 整图出血：照片铺满整张卡，信息压在图上。
  //
  // 上一版是「上面一张图 + 下面一块白底信息区」，看着像资料表；照片类产品的
  // 高级感来自**让照片当主角**——文字压在图上、只留一层渐层做承载，
  // 卡片的形状也因此立起来了。
  return (
    <div className="relative h-full overflow-hidden rounded-card shadow-card">
      {photo ? (
        <img
          src={photo}
          alt=""
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          // 图片解码是异步的，加个淡入避免「白块突然变图」的跳动
          onLoad={(e) => (e.currentTarget.style.opacity = "1")}
          style={{ opacity: 0, transition: "opacity .25s ease-out" }}
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-brand-soft to-gold-soft" />
      )}

      {/* 距离：小圆标压在右上角 */}
      {card.hasDistance && (
        <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full border border-white/15 bg-ink/45 px-2.5 py-1 text-[10px] text-white backdrop-blur-md">
          <MapPin size={10} strokeWidth={2.2} aria-hidden="true" />
          {distanceText(card.distanceKm)}
        </span>
      )}

      {/* 文字承载层：渐层从下往上铺开，名字/年龄/职业/兴趣都在这一层 */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/95 via-ink/55 to-transparent",
          compact ? "px-3.5 pb-3 pt-16" : "px-4 pb-4 pt-24"
        )}
      >
        <p
          className={cn(
            "font-bold leading-tight tracking-tight text-white",
            compact ? "text-[17px]" : "text-[21px]"
          )}
        >
          {card.nickname}
        </p>
        <p className={cn("mt-1 text-white/85", compact ? "text-[11.5px]" : "text-[13px]")}>
          {card.age} 岁 · {card.city} · {card.heightCm}cm
        </p>
        {card.occupation && (
          <p
            className={cn(
              "mt-1.5 flex items-center gap-1.5 text-white/70",
              compact ? "text-[11px]" : "text-[12px]"
            )}
          >
            <Briefcase size={12} strokeWidth={2} className="shrink-0" aria-hidden="true" />
            <span className="truncate">
              {card.occupation}
              {card.education ? ` · ${EDUCATION_LABEL(card.education)}` : ""}
            </span>
          </p>
        )}

        {/* 兴趣标签：半透明的玻璃片，压在照片上比纯色块干净 */}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {(card.hobbies ?? []).slice(0, 3).map((h) => (
            <span
              key={h}
              className="rounded-full border border-white/20 bg-white/15 px-2.5 py-[3px] text-[10.5px] font-medium text-white backdrop-blur-md"
            >
              {h}
            </span>
          ))}
        </div>

        {/* 软条件不完全满足时明确告知，而不是偷偷排在后面（PRD 7.2） */}
        {card.softMismatch && card.softMismatch.length > 0 && (
          <p className="mt-2 inline-flex rounded-full bg-gold/25 px-2.5 py-[3px] text-[10.5px] text-gold-soft backdrop-blur-md">
            部分条件不符
          </p>
        )}
      </div>
    </div>
  );
}

