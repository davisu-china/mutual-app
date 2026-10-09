import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** 右上角的确认按钮文案；不传则只显示标题 */
  confirmText?: string;
  onConfirm?: () => void;
  children: ReactNode;
}

/**
 * 底部弹层。
 *
 * 为什么用底部弹层而不是居中弹窗：
 *   手机是单手操作，拇指自然落在屏幕下半部。居中弹窗的按钮在屏幕中部，
 *   单手去点需要挪动手掌。底部弹层的操作区天然在拇指热区内。
 *
 * 细节：
 *   - 点遮罩关闭，但**内容区点击不冒泡**（否则选到一半就被关掉）
 *   - 内容区滚动到底时不把滚动传给页面背景（overscroll-contain）
 *   - 弹出时锁定背景滚动，避免「弹层在动、背景也在动」的廉价感
 */
export function Sheet({
  open,
  onClose,
  title,
  confirmText,
  onConfirm,
  children,
}: SheetProps) {
  // 弹出时锁背景滚动
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ESC 关闭（桌面端）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && onConfirm) onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, onConfirm]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-ink/40 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={cn(
          "relative w-full max-w-[440px] bg-surface rounded-t-[22px]",
          "shadow-sheet animate-sheet-up overflow-hidden"
        )}
        // 防止点击内容区冒泡到遮罩导致误关
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <button
            type="button"
            onClick={onClose}
            className="text-[15px] text-muted-2 hover:text-ink transition-colors -ml-1 px-1 py-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            取消
          </button>
          {title && (
            <span className="text-[15px] font-semibold text-ink">{title}</span>
          )}
          {confirmText ? (
            <button
              type="button"
              onClick={onConfirm ?? onClose}
              className="text-[15px] font-semibold text-brand hover:text-brand-dark transition-colors -mr-1 px-1 py-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {confirmText}
            </button>
          ) : (
            <span className="w-10" />
          )}
        </div>

        <div className="overscroll-contain pb-safe">{children}</div>
      </div>
    </div>
  );
}
