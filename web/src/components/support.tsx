import { useCallback, useEffect, useState } from "react";
import { MessageSquareHeart, Copy } from "lucide-react";
import { request } from "@/lib/api";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";

/**
 * 「加我微信提建议」——和 App 端同一套口径（`mobile/src/components/support.tsx`）。
 *
 * 微信号由服务端给（`GET /support`），**没配就整个入口都不显示**：
 * 宁可没有，也别摆一个假的联系方式。文案两端保持一致，用户换端不会觉得是两个产品。
 */

let cache: string | null | undefined;
let inflight: Promise<string | null> | null = null;

export function loadSupportWechat(): Promise<string | null> {
  if (cache !== undefined) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = request<{ wechat?: string }>("/support")
    .then((r) => {
      const v = (r.wechat ?? "").trim();
      cache = v === "" ? null : v;
      return cache;
    })
    .catch(() => null) // 拿不到就当没配：不能因为一个联系方式把页面搞挂
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useSupportWechat(): string | null {
  const [v, setV] = useState<string | null>(cache ?? null);
  useEffect(() => {
    let alive = true;
    void loadSupportWechat().then((x) => alive && setV(x));
    return () => {
      alive = false;
    };
  }, []);
  return v;
}

/** 弹层：注册后自动弹的那次和「我的」里点开的是同一个 */
export function SupportSheet({ open, wechat, onClose }: { open: boolean; wechat: string; onClose: () => void }) {
  const toast = useToast();

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(wechat);
      toast("微信号已复制，去微信里搜索添加");
    } catch {
      // 浏览器不给剪贴板权限（非 https / 用户拒绝）：微信号就摆在上面，让他手动抄
      toast("复制失败，请手动记一下上面的微信号", "error");
    }
    onClose();
  }, [wechat, toast, onClose]);

  return (
    <Sheet open={open} onClose={onClose} title="有问题随时找我">
      <div className="space-y-4 px-5 pb-6 pt-1">
        <p className="text-[14px] leading-relaxed text-ink-2">
          这是一个小团队做的产品，你的每条建议我们都会看。
          <br />
          用着别扭的地方、想要的功能、遇到的 bug——加我微信直接说。
        </p>

        <div className="rounded-field bg-brand-soft px-4 py-4 text-center">
          <p className="text-[12px] text-brand-dark">我的微信</p>
          <p className="mt-1 select-all text-[20px] font-bold tracking-wide text-brand-dark">{wechat}</p>
        </div>

        <button
          type="button"
          onClick={() => void copy()}
          className="flex w-full items-center justify-center gap-2 rounded-field bg-brand py-3 text-[15px] font-medium text-white transition-colors hover:bg-brand-dark"
        >
          <Copy size={17} aria-hidden="true" />
          复制微信号
        </button>

        <button type="button" onClick={onClose} className="w-full text-center text-[13px] text-muted-2 underline">
          以后再说
        </button>
      </div>
    </Sheet>
  );
}

/** 「我的」页里的那一行 */
export function SupportMenuItem({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-line-soft px-4 py-3.5 text-left text-[15px] text-ink last:border-b-0 hover:bg-paper"
    >
      <MessageSquareHeart size={18} strokeWidth={1.9} className="shrink-0 text-brand" aria-hidden="true" />
      <span className="flex-1">
        提建议 · 加我微信
        <span className="ml-2 text-[12.5px] text-muted-2">想要什么功能、哪里别扭，直接说</span>
      </span>
      <span className="shrink-0 text-muted-2" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

/**
 * 注册之后弹一次。
 *
 * 存 localStorage：这只是"别再自动弹了"，换个浏览器再弹一次没损失，
 * 不值得为它在用户资料里加一位。
 */
const SEEN_KEY = "mutual:support_prompt_seen";

export function supportPromptSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markSupportPromptSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* 记不住就算了 */
  }
}
