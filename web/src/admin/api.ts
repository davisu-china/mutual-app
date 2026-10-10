import { request } from "@/lib/api";

/**
 * 后台的接口封装。
 *
 * 复用 `lib/api` 的 `request`——token 存储、401 刷新、错误码翻译都已经在那里了，
 * 后台只是多加一层路径和类型。**不要另写一个 fetch 封装**：那样两套 token
 * 生命周期会各走各的，最容易出的问题是"后台登录了但 App 那边没登录"。
 */

export interface AdminUserStats {
  total: number;
  onboarded: number;
  active: number;
  newToday: number;
  new7d: number;
  loginToday: number;
  male: number;
  female: number;
  genderUnset: number;
}
export interface AdminActionStats {
  like: number;
  pass: number;
  visit: number;
  likeToday: number;
  passToday: number;
  visitToday: number;
}
export interface AdminMatchStats {
  total: number;
  active: number;
  today: number;
}
export interface AdminMessageStats {
  total: number;
  today: number;
  conversations: number;
  chattedConversations: number;
}
export interface AdminEngagement {
  likeRate: number;
  mutualLikeRate: number;
  replyRate: number;
  avgMessages: number;
  exposureToLike: number;
}
export interface AdminDailyPoint {
  date: string;
  registers: number;
  likes: number;
  passes: number;
  matches: number;
  messages: number;
}
export interface AdminStats {
  users: AdminUserStats;
  actions: AdminActionStats;
  matches: AdminMatchStats;
  messages: AdminMessageStats;
  engagement: AdminEngagement;
  daily: AdminDailyPoint[];
}

export interface AdminUserRow {
  id: number;
  phone: string;
  nickname: string;
  gender: number | null;
  age: number;
  city: string;
  cityProvince: string;
  completeness: number;
  status: string;
  onboarded: boolean;
  isAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  photos: number;
  likesSent: number;
  passesSent: number;
  likesReceived: number;
  visitsReceived: number;
  matches: number;
  messages: number;
}

export interface AdminActionRow {
  id: number;
  action: "like" | "pass" | "visit";
  source: string;
  createdAt: string;
  peerId: number;
  peerNickname: string;
  peerAvatar: string;
}

export interface AdminConvPeer {
  id: number;
  nickname: string;
  avatarUrl: string;
}
export interface AdminConvRow {
  id: number;
  status: string;
  userA: AdminConvPeer;
  userB: AdminConvPeer;
  messageCount: number;
  lastMessage: string;
  lastMessageAt: string | null;
  createdAt: string;
}
export interface AdminMsgRow {
  id: number;
  fromUser: number;
  msgType: string;
  content: string;
  seq: number;
  status: string;
  createdAt: string;
}
export interface AdminConvDetail {
  id: number;
  status: string;
  users: AdminConvPeer[];
  messages: AdminMsgRow[];
  truncated: boolean;
}

export interface AdminUserDetail {
  user: {
    id: number;
    phone: string;
    nickname: string;
    gender: number | null;
    age: number;
    status: string;
    onboarded: boolean;
    isAdmin: boolean;
    deviceId: string | null;
    registerIp: string | null;
    createdAt: string;
    lastLoginAt: string | null;
  };
  avatarUrl: string;
  profile: Record<string, unknown> | null;
  texts: { aboutMe: string | null; expectPartner: string | null } | null;
  hobbies: { name: string; description: string; sortOrder: number }[];
  photos: { id: number; url: string; sortOrder: number; auditStatus: string; visibility: string }[];
  counts: Record<string, number>;
  quotaToday: { used: number; limit: number } | null;
  preference: Record<string, unknown>;
  conversations: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 拼查询串：空值一律不带上，免得后端收到一堆 page=undefined */
export function qs(o: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  });
  return p.toString();
}

export const adminApi = {
  stats: () => request<AdminStats>("/admin/stats"),
  users: (q: Record<string, string | number | undefined>) => request<Paged<AdminUserRow>>(`/admin/users?${qs(q)}`),
  user: (id: number) => request<AdminUserDetail>(`/admin/users/${id}`),
  actions: (id: number, q: Record<string, string | number | undefined>) =>
    request<Paged<AdminActionRow> & { direction: string }>(`/admin/users/${id}/actions?${qs(q)}`),
  conversations: (q: Record<string, string | number | undefined>) =>
    request<Paged<AdminConvRow>>(`/admin/conversations?${qs(q)}`),
  conversation: (id: number) => request<AdminConvDetail>(`/admin/conversations/${id}`),
};
