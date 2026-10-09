/**
 * API 客户端。
 *
 * 统一处理三件事：带上 token、解析统一响应体、把业务错误码翻译成可展示的异常。
 * 组件里只看到 `ApiError.message`，不需要关心 HTTP 状态码。
 */

const BASE = import.meta.env.VITE_API_BASE ?? "/api/v1";

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

export const tokenStore = {
  get access() {
    return localStorage.getItem(ACCESS_KEY) ?? "";
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY) ?? "";
  },
  save(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
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
  signal?: AbortSignal;
};

/** 刷新 token 的并发去重：多个请求同时 401 时只刷新一次 */
let refreshing: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const rt = tokenStore.refresh;
  if (!rt) return false;
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as Resp<{ accessToken: string; refreshToken: string }>;
    if (!json.data?.accessToken) return false;
    tokenStore.save(json.data.accessToken, json.data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

export async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, auth = true, signal } = opts;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth && tokenStore.access) {
    headers["Authorization"] = `Bearer ${tokenStore.access}`;
  }

  const send = () =>
    fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });

  let res = await send();

  // access token 过期：刷新一次再重试。只重试一次，避免死循环。
  if (res.status === 401 && auth && tokenStore.refresh) {
    refreshing = refreshing ?? doRefresh().finally(() => (refreshing = null));
    const ok = await refreshing;
    if (ok) {
      headers["Authorization"] = `Bearer ${tokenStore.access}`;
      res = await send();
    }
  }

  let json: Resp<T> | null = null;
  try {
    json = (await res.json()) as Resp<T>;
  } catch {
    throw new ApiError("NETWORK", "网络异常，请稍后重试", res.status);
  }

  if (!res.ok || (json.code && json.code !== "OK")) {
    const code = json?.code ?? "UNKNOWN";
    const msg = json?.message ?? "服务暂时不可用";
    if (code === "UNAUTHORIZED") tokenStore.clear();
    throw new ApiError(code, msg, res.status);
  }

  return json.data;
}

export const api = {
  get: <T>(p: string, signal?: AbortSignal) => request<T>(p, { signal }),
  post: <T>(p: string, body?: unknown) => request<T>(p, { method: "POST", body }),
  put: <T>(p: string, body?: unknown) => request<T>(p, { method: "PUT", body }),
  patch: <T>(p: string, body?: unknown) => request<T>(p, { method: "PATCH", body }),
  del: <T>(p: string, body?: unknown) => request<T>(p, { method: "DELETE", body }),

  // 登录注册不带旧 token
  postPublic: <T>(p: string, body: unknown) =>
    request<T>(p, { method: "POST", body, auth: false }),
};

// ---------- 直接上传 MinIO（不走后端）----------

export async function uploadToPresigned(url: string, file: File): Promise<void> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": file.type || "image/jpeg" },
    body: file,
  });
  if (!res.ok) throw new ApiError("UPLOAD_FAILED", "上传失败，请重试", res.status);
}

// ---------- 业务类型 ----------

export interface Quota {
  used: number;
  limit: number;
  remain: number;
}

export interface Card {
  userId: number;
  nickname: string;
  age: number;
  gender: number;
  heightCm: number;
  city: string;
  cityProvince: string;
  occupation: string;
  education: number;
  distanceKm: number;
  hasDistance: boolean;
  avatarUrl: string;
  photos: string[] | null;
  hobbies: string[] | null;
  completeness: number;
  softMismatch?: string[];
}

export interface ActionResult {
  matched: boolean;
  matchId?: number;
  quotaUsed: number;
  quotaLimit: number;
  quotaRemain: number;
  alreadyActed: boolean;
}

export interface Profile {
  userId: number;
  nickname: string;
  gender: number | null;
  age: number;
  heightCm: number;
  weightKg?: number;
  hometownProvince: string;
  hometownCity: string;
  cityProvince: string;
  city: string;
  cityDistrict?: string;
  occupation: string;
  occupationOther?: string;
  mbti?: string;
  smoking: number;
  drinking: number;
  incomeRange?: number;
  education: number;
  school?: string;
  company?: string;
  isOnlyChild: boolean;
  eldercarePressure?: number;
  hasCar: boolean;
  hasHouse: number;
  isDink: number;
  weightPublic: boolean;
  incomePublic: boolean;
  companyPublic: boolean;
  completeness: number;
  avatarUrl: string;
  incomeHidden: boolean;
  companyHidden: boolean;
  hobbies?: { name: string; description: string; sortOrder: number }[];
  aboutMe?: string;
  expectPartner?: string;
  photos?: { id: number; url: string; sortOrder: number }[];
  preference?: PreferenceView;
}

export interface PreferenceView {
  heightMin: number;
  heightMax: number;
  hometownProvinces: string[];
  smokingAccept: number;
  drinkingAccept: number;
  incomeMin: number;
  incomeMax: number;
  educationMin: number;
  onlyChildAccept: number;
  carPrefer: number;
  housePrefer: number;
  dinkAccept: number;
  tags: string[];
}

export interface Interactor {
  userId: number;
  nickname: string;
  age: number;
  gender: number;
  heightCm: number;
  city: string;
  occupation: string;
  avatarUrl: string;
  completeness: number;
  actedAt: string;
  likedAt?: string;
  matchId?: number;
}

export interface Conversation {
  id: number;
  matchId: number;
  peerId: number;
  peerNickname: string;
  peerAvatar: string;
  peerCity: string;
  lastMessage: string;
  lastMessageAt: string | null;
  unread: number;
  status: string;
  matchedAt: string;
}

export interface Message {
  id: number;
  fromUser: number;
  msgType: string;
  content: string;
  seq: number;
  status: string;
  createdAt: string;
  clientMsgId?: string;
}

export interface Photo {
  id: number;
  url: string;
  sortOrder: number;
  auditStatus: string;
  visibility: string;
}
