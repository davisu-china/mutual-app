/**
 * 接口返回的实体类型 —— 与 Web 版 `web/src/lib/api.ts` 对齐。
 *
 * 后端是同一套 DTO，两端的类型也应当长得一样；不一致时先怀疑这里漏了字段，
 * 而不是各写各的。
 */

export interface Quota {
  used: number;
  limit: number;
  remain: number;
}

/** 我与 TA 的关系（只在看别人主页时返回） */
export interface Relation {
  liked: boolean;
  passed: boolean;
  matched: boolean;
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
  /** 距离按区间展示，后端不给精确值 */
  distanceKm: number;
  hasDistance: boolean;
  /** 头像＝相册第一张已过审照片 */
  avatarUrl: string;
  photos: string[] | null;
  hobbies: string[] | null;
  completeness: number;
  /** 软条件不完全满足时的提示（PRD 7.2 要求让用户知情） */
  softMismatch?: string[];
  /**
   * 为什么给你看这个人。三个字段一起构成推荐卡下半部分：
   * reasons＝TA 符合你的哪些偏好、sharedHobbies＝你们的共同兴趣、
   * aboutMe＝TA 自己写的那段话（当成引用展示）。
   * 都是服务端算出来的，不是前端拼的文案。
   */
  reasons?: string[];
  sharedHobbies?: string[];
  aboutMe?: string;
}

export interface Photo {
  id: number;
  url: string;
  sortOrder: number;
  auditStatus?: string;
  visibility?: string;
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
  occupation: string;
  mbti?: string;
  smoking: number;
  drinking: number;
  incomeRange?: number;
  education: number;
  school?: string;
  company?: string;
  isOnlyChild: boolean;
  /** 仅在查看自己时返回 */
  eldercarePressure?: number;
  hasCar: boolean;
  hasHouse: number;
  isDink: number;
  completeness: number;
  avatarUrl: string;
  hobbies?: { name: string; description: string; sortOrder: number }[];
  aboutMe?: string;
  expectPartner?: string;
  photos?: Photo[];
  relation?: Relation;
}

export interface Interactor {
  userId: number;
  nickname: string;
  gender: number;
  age: number;
  heightCm: number;
  cityCity: string;
  occupation: string;
  completeness: number;
  avatarUrl: string;
  actedAt: string;
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

export interface ActionResult {
  matched: boolean;
  matchId?: number;
  quotaUsed: number;
  quotaLimit: number;
  quotaRemain: number;
  alreadyActed?: boolean;
}
