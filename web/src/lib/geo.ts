/**
 * 浏览器定位 —— 和 App 端同一套口径（`mobile/src/lib/geo.ts`）。
 *
 * 只为了算一个粗粒度距离：经纬度发给服务端后**只留一个 5 位 geohash**
 * （约 4.9km × 4.9km 的方格），原始坐标既不落库也不回传（PRD 第 15 章）。
 *
 * 两个函数的分工和 App 端一样：
 *   - `ensureLocation()`：**会弹浏览器权限框**，用在"刚选完现居地"那一刻（上下文里问得清楚）；
 *   - `locationIfGranted()`：**不弹框**（用 Permissions API 查一下状态），用在保存资料时。
 */

export interface Coords {
  lat: number;
  lng: number;
}

let cached: Coords | null = null;

/** 查权限状态；浏览器不支持 Permissions API 时返回 "prompt"（当作没授权） */
async function permissionState(): Promise<PermissionState | "prompt"> {
  try {
    // 有些浏览器没有 navigator.permissions.query / 不认 geolocation
    const st = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    return st?.state ?? "prompt";
  } catch {
    return "prompt";
  }
}

function getPosition(): Promise<Coords | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        cached = { lat: p.coords.latitude, lng: p.coords.longitude };
        resolve(cached);
      },
      // 用户拒绝、超时、定位服务关了 —— 都当作"没有"，不要因此让保存失败
      () => resolve(null),
      // 精度要求低：最后只留 ~5km 的格子，等太久不值得
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

/** 不弹框：已经授权才取（有缓存直接用） */
export async function locationIfGranted(): Promise<Coords | null> {
  if (cached) return cached;
  if ((await permissionState()) !== "granted") return null;
  return getPosition();
}

/** 会弹框：直接在用户手势里调（浏览器要求权限请求来自用户操作上下文） */
export function ensureLocation(): Promise<Coords | null> {
  if (cached) return Promise.resolve(cached);
  return getPosition();
}
