import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  api,
  setAccountBlockedHandler,
  setOnboardingRequiredHandler,
  setUnauthorizedHandler,
  tokens,
} from "@/lib/api";

/**
 * 会话状态。
 *
 * 两件容易被忽略的事：
 *   1. **启动时要等令牌从 Keychain 读出来**（异步），在此之前不能渲染业务页面，
 *      否则会出现「已登录却闪一下登录页」。所以有 ready 这个状态。
 *   2. `onboarded` 要跟着会话一起维护：未完成五步的用户被后端中间件挡着，
 *      客户端提前知道就能直接把人送去向导，省掉一次必然失败的请求。
 */
/** 账号被限制时的信息（管理员填的原因原话）。null = 没有被限制 */
export interface Restriction {
  reason: string | null;
}

interface AuthState {
  ready: boolean;
  userId: number | null;
  /**
   * 账号被限制（封禁）。**不是"登出"**：人还在、还能看推荐和消息，
   * 只是不能喜欢别人、不能发消息。界面据此摆一条说明横幅（见 components/restriction.tsx）。
   */
  restriction: Restriction | null;
  /** null = 还没问到（首次请求后才知道） */
  onboarded: boolean | null;
  signIn: (phone: string, password: string) => Promise<void>;
  signUp: (phone: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  markOnboarded: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [restriction, setRestriction] = useState<Restriction | null>(null);

  useEffect(() => {
    (async () => {
      await tokens.load();
      if (tokens.access) {
        try {
          const me = await api.get<{ userId: number; accountStatus?: string; banReason?: string }>("/users/me");
          setUserId(me.userId);
          // 能拿到资料就说明走完了五步（后端中间件挡着未完成的账号）
          setOnboarded(true);
          // 被限制的账号照样能登录、能看东西——限制说明从自己的资料里读
          if (me.accountStatus === "banned") setRestriction({ reason: me.banReason ?? null });
        } catch {
          // 令牌失效：清干净，回到登录页
          await tokens.clear();
        }
      }
      setReady(true);
    })();
  }, []);

  // 任何请求被判 401 且刷新失败 → 立刻退回登录态（而不是停在半死不活的页面）
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUserId(null);
      setOnboarded(null);
      setRestriction(null);
    });
    setOnboardingRequiredHandler(() => setOnboarded(false));
    // 做了被限制的动作（喜欢/发消息）→ 把人标记成受限，并顺手把自己的资料再拉一次：
    // 上一次可能是好久以前拉的，原因也以最新的为准
    setAccountBlockedHandler(() => {
      setRestriction((prev) => prev ?? { reason: null });
      void api
        .get<{ accountStatus?: string; banReason?: string }>("/users/me")
        .then((me) => {
          if (me.accountStatus === "banned") setRestriction({ reason: me.banReason ?? null });
        })
        .catch(() => {
          /* 拉不到就先用已知道的 */
        });
    });
    return () => {
      setUnauthorizedHandler(() => {});
      setOnboardingRequiredHandler(() => {});
      setAccountBlockedHandler(() => {});
    };
  }, []);

  const signIn = useCallback(async (phone: string, password: string) => {
    const r = await api.postPublic<{ userId: number; accessToken: string; refreshToken: string; onboarded?: boolean }>(
      "/auth/login",
      { phone, password }
    );
    await tokens.save(r.accessToken, r.refreshToken);
    setUserId(r.userId);
    setOnboarded(!!r.onboarded);
  }, []);

  const signUp = useCallback(async (phone: string, password: string) => {
    const r = await api.postPublic<{ userId: number; accessToken: string; refreshToken: string }>("/auth/register", {
      phone,
      password,
    });
    await tokens.save(r.accessToken, r.refreshToken);
    setUserId(r.userId);
    setOnboarded(false);
  }, []);

  const signOut = useCallback(async () => {
    await tokens.clear();
    setUserId(null);
    setOnboarded(false);
    setRestriction(null);
  }, []);

  const markOnboarded = useCallback(() => setOnboarded(true), []);

  const value = useMemo(
    () => ({ ready, userId, onboarded, restriction, signIn, signUp, signOut, markOnboarded }),
    [ready, userId, onboarded, restriction, signIn, signUp, signOut, markOnboarded]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return v;
}
