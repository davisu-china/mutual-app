import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, tokenStore } from "@/lib/api";

interface AuthState {
  userId: number | null;
  onboarded: boolean;
  ready: boolean;
  login: (phone: string, password: string) => Promise<void>;
  register: (phone: string, password: string) => Promise<void>;
  logout: () => void;
  markOnboarded: () => void;
}

const Ctx = createContext<AuthState | null>(null);

interface AuthResult {
  userId: number;
  accessToken: string;
  refreshToken: string;
  onboarded: boolean;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<number | null>(null);
  const [onboarded, setOnboarded] = useState(false);
  const [ready, setReady] = useState(false);

  // 启动时用已有 token 探一次：token 有效但服务端重启等情况要能自愈
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tokenStore.access) {
        setReady(true);
        return;
      }
      try {
        const me = await api.get<{ userId: number }>("/users/me");
        if (cancelled) return;
        setUserId(me.userId);
        // Onboarding 状态用 /quota 探测：它挂在 OnboardGuard 后面，
        // 未完成会返回 ONBOARDING_REQUIRED。比多拉一次完整资料便宜。
        try {
          await api.get("/quota");
          setOnboarded(true);
        } catch {
          setOnboarded(false);
        }
      } catch {
        tokenStore.clear();
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (phone: string, password: string) => {
    const r = await api.postPublic<AuthResult>("/auth/login", { phone, password });
    tokenStore.save(r.accessToken, r.refreshToken);
    setUserId(r.userId);
    setOnboarded(r.onboarded);
  }, []);

  const register = useCallback(async (phone: string, password: string) => {
    const deviceId = getDeviceId();
    const r = await api.postPublic<AuthResult>("/auth/register", {
      phone,
      password,
      deviceId,
    });
    tokenStore.save(r.accessToken, r.refreshToken);
    setUserId(r.userId);
    setOnboarded(r.onboarded);
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUserId(null);
    setOnboarded(false);
  }, []);

  const markOnboarded = useCallback(() => setOnboarded(true), []);

  const value = useMemo(
    () => ({ userId, onboarded, ready, login, register, logout, markOnboarded }),
    [userId, onboarded, ready, login, register, logout, markOnboarded]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return v;
}

/**
 * 设备指纹。
 *
 * 没有短信验证码的情况下，注册几乎是零成本的，所以需要设备维度兜一道
 * （PRD 4.4：同设备每月最多 3 个账号）。这里用随机 ID + UA 指纹做个轻量实现，
 * 生产环境应换成原生设备标识或风控 SDK。
 */
function getDeviceId(): string {
  const KEY = "mutual.device";
  let id = localStorage.getItem(KEY);
  if (!id) {
    const seed = `${navigator.userAgent}|${screen.width}x${screen.height}|${Date.now()}|${Math.random()}`;
    id = simpleHash(seed);
    localStorage.setItem(KEY, id);
  }
  return id;
}

function simpleHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
