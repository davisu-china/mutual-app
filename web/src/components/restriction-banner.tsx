import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@/store/auth";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

/**
 * 「账号被限制」的说明 —— 和 App 端同一套口径（`mobile/src/components/restriction.tsx`）。
 *
 * 封禁＝**限制互动**，不是踢出去：推荐照看、消息照看、资料照改，
 * 只是不能喜欢别人、不能发消息。所以这里是一条横幅，不是整屏遮罩。
 * 原因由管理员在后台填写，这里原话展示。
 */
export function RestrictionBanner() {
  const { restriction } = useAuth();
  const [open, setOpen] = useState(false);

  if (!restriction) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-5 mb-3 flex w-[calc(100%-2.5rem)] items-center gap-2 rounded-field bg-brand-soft px-3.5 py-2.5 text-left"
      >
        <AlertCircle size={16} strokeWidth={2.2} className="shrink-0 text-brand-dark" aria-hidden="true" />
        <span className="flex-1 text-[13px] leading-snug text-brand-dark">
          账号被限制：暂时不能喜欢别人、不能发消息
        </span>
        <span className="shrink-0 text-[13px] font-medium text-brand-dark">详情</span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="账号被限制">
        <div className="space-y-4 px-5 pb-6 pt-1">
          <p className="text-[14px] leading-relaxed text-ink-2">
            你的账号目前只能浏览：<span className="font-medium text-ink">不能喜欢别人、不能发消息</span>。
            <br />
            看推荐、看消息、改资料都不受影响。
          </p>

          {restriction.reason && (
            <div className="rounded-field bg-brand-soft px-4 py-3">
              <p className="text-[12px] font-medium text-brand-dark">限制原因</p>
              <p className="mt-1 text-[14px] leading-relaxed text-brand-dark">{restriction.reason}</p>
            </div>
          )}

          <p className="text-[12.5px] leading-relaxed text-muted-2">
            如果你觉得是误判、或已经按要求修改，可以联系客服申诉。
          </p>
          <Button className="w-full" onClick={() => setOpen(false)}>
            知道了
          </Button>
        </div>
      </Sheet>
    </>
  );
}
