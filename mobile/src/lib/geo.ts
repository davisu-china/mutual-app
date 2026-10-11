import * as Location from "expo-location";

/**
 * 设备定位 —— **只为了算一个粗粒度的距离**。
 *
 * 口径（PRD 第 15 章）：客户端把经纬度发给服务端，服务端**只留一个 5 位 geohash**
 * （约 4.9km × 4.9km 的方格），原始经纬度既不落库也不回传。所以这里采的是
 * 「够用就行」的精度——更准只是多耗电，对结果没有影响。
 *
 * 什么时候弹权限框是刻意分开的两个函数：
 *   - `ensureLocation()`：**会弹框**。用在"用户刚选了现居地"这种**上下文里**——
 *     那一刻他知道我们为什么要问；
 *   - `locationIfGranted()`：**不弹框**，没授权就返回 null。用在保存资料时——
 *     不能因为存个资料突然弹一个权限框。
 */

export interface Coords {
  lat: number;
  lng: number;
}

let cached: Coords | null = null;
let inflight: Promise<Coords | null> | null = null;

/** 已经授权时才真的取位置；没授权直接 null（getForegroundPermissionsAsync 不弹框） */
async function read(): Promise<Coords | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") return null;
    // Balanced 够用：我们最后只留 ~5km 的方格，高精度纯属浪费电
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    cached = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    return cached;
  } catch {
    // 定位服务关了、或者拿不到定位：当作没有，不要因此让保存失败
    return null;
  }
}

/** 不弹框：已授权就取（有缓存直接用） */
export function locationIfGranted(): Promise<Coords | null> {
  if (cached) return Promise.resolve(cached);
  return read();
}

/** 会弹框：申请权限并取一次。拒绝/失败都返回 null */
export function ensureLocation(): Promise<Coords | null> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return null;
      return await read();
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
