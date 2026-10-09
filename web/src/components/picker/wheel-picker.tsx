import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";

export interface WheelOption {
  value: string | number;
  label: string;
}

interface WheelPickerProps {
  options: WheelOption[];
  value: string | number;
  onChange: (value: string | number) => void;
  /** 单行高度 */
  itemHeight?: number;
  /** 可见行数，建议奇数（中间那行是选中项） */
  visibleCount?: number;
  className?: string;
  /** 无障碍标签 */
  ariaLabel?: string;
  /**
   * 滚动过程中的「实时」回调（每越过一格触发一次）。
   * 与 onChange 的区别：onChange 是停稳后才提交（用于写状态），
   * onLiveIndexChange 是滚动中就触发（用于让外部的大号数字跟着滚）。
   * 两者分开，才有「转轮子」的实感，否则大数字会在松手那一刻才跳。
   */
  onLiveIndexChange?: (index: number) => void;
}

/** 停止滚动多久后判定为「已停稳」，这个值决定确认的手感 */
const SETTLE_MS = 110;

/**
 * 浏览器用 useLayoutEffect（在绘制前定位，避免闪一下），
 * 服务端渲染时退回 useEffect（否则 React 会警告）。
 * 本项目是纯客户端 SPA，写成这样只是为了 SSR 冒烟测试能跑干净。
 */
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * 滚轮选择器。
 *
 * 实现选择：用 CSS scroll-snap + 原生滚动，而不是 JS 驱动的 transform 动画。
 * 原因：原生的惯性滚动、回弹、触摸跟手都是浏览器在合成线程上做的，
 * 比 JS 每帧算 translate 顺滑得多，低端机上也不会掉帧。JS 只负责两件事：
 * 读取当前停在哪一格、以及在外部改值时滚过去。
 *
 * 手感上的三个关键：
 *   1. 滚动过程中大号数字要「实时跟手」——所以 liveIndex 是连续更新的，
 *      而真正向外提交（onChange）是停稳后防抖的。两者分开，才有「转轮子」
 *      的实感而不是「跳数字」。
 *   2. 离中心越远的行越淡越小，形成滚轮的透视感。
 *   3. 每越过一格触发一次 8ms 极短震动，模拟机械档位。iOS 不支持会静默跳过。
 */
export function WheelPicker({
  options,
  value,
  onChange,
  itemHeight = 36,
  visibleCount = 5,
  className,
  ariaLabel,
  onLiveIndexChange,
}: WheelPickerProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number | null>(null);
  const lastIndex = useRef(-1);
  /** 程序触发的滚动不应当再回调 onChange，否则会与外部状态打架 */
  const programmatic = useRef(false);

  const pad = Math.floor(visibleCount / 2) * itemHeight;
  const viewportHeight = itemHeight * visibleCount;

  const resolveIndex = useCallback(
    (v: string | number) => {
      const i = options.findIndex((o) => o.value === v);
      return i < 0 ? 0 : i;
    },
    [options]
  );

  const [liveIndex, setLiveIndex] = useState(() => resolveIndex(value));

  // 用 useLayoutEffect 保证首次渲染就定位好，避免进来先闪一下第 0 项
  useIsoLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const idx = resolveIndex(value);
    const target = idx * itemHeight;
    if (Math.abs(el.scrollTop - target) < 1) return;

    programmatic.current = true;
    el.scrollTop = target; // 直接赋值比 scrollTo 更快，且不受 scroll-behavior 影响
    setLiveIndex(idx);

    const t = window.setTimeout(() => {
      programmatic.current = false;
    }, 80);
    return () => window.clearTimeout(t);
  }, [value, itemHeight, resolveIndex]);

  const handleScroll = useCallback(() => {
    const el = elRef.current;
    if (!el) return;

    const idx = Math.max(
      0,
      Math.min(options.length - 1, Math.round(el.scrollTop / itemHeight))
    );

    if (idx !== lastIndex.current) {
      lastIndex.current = idx;
      setLiveIndex(idx);
      haptic(8); // 每过一格
      onLiveIndexChange?.(idx);
    }

    if (programmatic.current) return;

    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const opt = options[idx];
      if (opt && opt.value !== value) onChange(opt.value);
    }, SETTLE_MS);
  }, [options, itemHeight, onChange, value, onLiveIndexChange]);

  // 卸载时清掉挂起的定时器，避免在已卸载组件上 setState
  useIsoLayoutEffect(() => {
    return () => {
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
    };
  }, []);

  return (
    <div
      className={cn("relative select-none", className)}
      style={{ height: viewportHeight }}
    >
      {/* 选中高亮带 */}
      <div
        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-[10px] bg-brand-soft/80"
        style={{ height: itemHeight }}
      />

      {/* 上下渐隐，制造滚轮的纵深感 */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-surface to-transparent"
        style={{ height: pad } as CSSProperties}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-surface to-transparent"
        style={{ height: pad } as CSSProperties}
      />

      <div
        ref={elRef}
        onScroll={handleScroll}
        role="listbox"
        aria-label={ariaLabel}
        tabIndex={0}
        className={cn(
          "no-scrollbar h-full overflow-y-scroll",
          "snap-y snap-mandatory overscroll-contain",
          "focus:outline-none"
        )}
        // 桌面端支持滚轮与方向键，键盘可达
        onKeyDown={(e) => {
          const el = elRef.current;
          if (!el) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const next = Math.max(
              0,
              Math.min(
                options.length - 1,
                liveIndex + (e.key === "ArrowDown" ? 1 : -1)
              )
            );
            el.scrollTop = next * itemHeight;
            onLiveIndexChange?.(next);
            const opt = options[next];
            if (opt) onChange(opt.value);
          }
        }}
      >
        <div style={{ height: pad }} />
        {options.map((opt, i) => {
          const distance = Math.abs(i - liveIndex);
          return (
            <div
              key={opt.value}
              role="option"
              aria-selected={i === liveIndex}
              className="flex snap-center items-center justify-center"
              style={{ height: itemHeight }}
            >
              <span
                className={cn(
                  "tabular-nums transition-[color,transform] duration-150",
                  i === liveIndex
                    ? "text-[17px] font-semibold text-ink"
                    : "text-[15px] text-muted-2"
                )}
                style={{
                  // 离中心越远越淡，形成滚轮透视
                  opacity: Math.max(0.25, 1 - distance * 0.28),
                  transform: `scale(${i === liveIndex ? 1 : 1 - Math.min(distance, 3) * 0.03})`,
                }}
              >
                {opt.label}
              </span>
            </div>
          );
        })}
        <div style={{ height: pad }} />
      </div>
    </div>
  );
}
