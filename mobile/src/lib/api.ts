/**
 * API 客户端 —— 与 Web 版 `web/src/lib/api.ts` 同一套约定。
 *
 * 三件事保持一致：
 *   1. 统一响应体 `{code, message, data}`：非 OK 的 code 一律抛 ApiError
 *      （错误消息是服务端写好的中文，直接展示给用户）；
 *   2. 401 自动刷新一次并重放请求，且**并发去重**（多个请求同时 401 只刷新一次，
 *      否则会把刷新令牌用废）；
 *   3. 业务错误码原样带到上层，页面按 code 决定行为（如 ONBOARDING_REQUIRED 跳向导）。
 */
import * as SecureStore from "expo-secure-store";

/**
 * 服务端地址。
 *
 * 放在这里而不是散在各处：真机调试时要改成电脑的局域网 IP，
 * 上线时改成正式域名，只动这一行。也可以用环境变量覆盖（Expo 的约定）：
 *   EXPO_PUBLIC_API_BASE=http://192.168.1.5:8099/api/v1 npx expo start
 */
export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ?? "https://mutual.jianjiange.site/api/v1";

/** 媒体的根地址（图片走同一个域名，不带 /api/v1 前缀） */
export const ORIGIN = API_BASE.replace(/\/api\/v1\/?$/, "");

const ACCESS_KEY = "mutual.access";
const REFRESH_KEY = "mutual.refresh";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// ---------- 令牌 ----------
//
// 用 SecureStore（iOS Keychain / Android Keystore）而不是 AsyncStorage：
// token 等同于账号，落在明文存储里不合适。
let accessToken = "";
let refreshToken = "";

export const tokens = {
  get access() {
    return accessToken;
  },
  async load() {
    accessToken = (await SecureStore.getItemAsync(ACCESS_KEY)) ?? "";
    refreshToken = (await SecureStore.getItemAsync(REFRESH_KEY)) ?? "";
  },
  async save(access: string, refresh: string) {
    accessToken = access;
    refreshToken = refresh;
    await SecureStore.setItemAsync(ACCESS_KEY, access);
    await SecureStore.setItemAsync(REFRESH_KEY, refresh);
  },
  async clear() {
    accessToken = "";
    refreshToken = "";
    await SecureStore.deleteItemAsync(ACCESS_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  },
};

interface Resp<T> {
  code: string;
  message: string;
  data: T;
}

type Options = {
  method?: string;
  body?: unknown;
  /** 传 false 时不带 Authorization（登录注册用） */
  auth?: boolean;
};

/** 刷新令牌的并发去重：多个请求同时 401 时只刷新一次 */
let refreshing: Promise<boolean> | null = null;
let onUnauthorized: (() => void) | null = null;
let onOnboardingRequired: (() => void) | null = null;

/** 会话失效时通知外部（跳回登录页）。由 auth store 注册。 */
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

/**
 * 服务端说「请先完成资料填写」时通知外部。
 *
 * 后端中间件会拦未完成五步的账号（PRD 3.3），客户端提前知道就能直接把人
 * 送去向导，而不是让用户在几个页面里撞一遍 403。
 */
export function setOnboardingRequiredHandler(fn: () => void) {
  onOnboardingRequired = fn;
}

async function doRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as Resp<{ accessToken: string; refreshToken: string }>;
    if (json.code !== "OK" || !json.data) return false;
    await tokens.save(json.data.accessToken, json.data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const send = () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(`${API_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  };

  let res = await send();
  if (res.status === 401 && opts.auth !== false) {
    refreshing = refreshing ?? doRefresh().finally(() => (refreshing = null));
    const ok = await refreshing;
    if (ok) {
      res = await send();
    } else {
      await tokens.clear();
      onUnauthorized?.();
      throw new ApiError("UNAUTHORIZED", "登录已过期，请重新登录", 401);
    }
  }

  let json: Resp<T>;
  try {
    json = (await res.json()) as Resp<T>;
  } catch {
    throw new ApiError("NETWORK", "网络异常，请稍后重试", res.status);
  }

  if (!res.ok || (json.code && json.code !== "OK")) {
    const code = json?.code ?? "UNKNOWN";
    if (code === "UNAUTHORIZED") {
      await tokens.clear();
      onUnauthorized?.();
    }
    if (code === "ONBOARDING_REQUIRED") {
      onOnboardingRequired?.();
    }
    throw new ApiError(code, json?.message ?? "服务暂时不可用", res.status);
  }
  return json.data;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  del: <T>(path: string, body?: unknown) => request<T>(path, { method: "DELETE", body }),
  postPublic: <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body, auth: false }),
};

/**
 * 把服务端返回的媒体路径拼成可加载的绝对地址。
 *
 * 图片要靠 Authorization 头鉴权——原生图片组件支持自定义头，
 * 所以不必像浏览器那样绕读图 cookie（服务端两种都认）。
 */
export function mediaImage(pathOrUrl: string): { uri: string; headers?: Record<string, string> } | null {
  if (!pathOrUrl) return null;
  const uri = pathOrUrl.startsWith("http") ? pathOrUrl : ORIGIN + pathOrUrl;
  return accessToken ? { uri, headers: { Authorization: `Bearer ${accessToken}` } } : { uri };
}
