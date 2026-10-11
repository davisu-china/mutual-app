/**
 * 定位采集。
 *
 * 这一小段决定了「卡上的距离」有没有数据可用，而它的失败是**静默的**：
 * 拿不到定位就当作没有，卡片退化成「同城/同省/异地」——不报错、不崩。
 * 所以更要把"什么时候弹框、什么时候不弹"钉住：保存资料时突然弹一个权限框
 * 很招人烦。
 *
 * ⚠️ `@/lib/geo` 里有模块级缓存（一次会话只取一次位置），所以每个用例都要一份
 * **全新的模块**；而 `jest.resetModules()` 之后 `expo-location` 的替身也是新的
 * （jest.fn 全换了），**必须拿新的那一个去配 mock**——配旧的实例不会生效，
 * 表现为"已授权却拿不到坐标"这种假失败。
 */
const granted = { status: "granted" };
const denied = { status: "denied" };
const pos = { coords: { latitude: 31.2304, longitude: 121.4737 } };

type Mocked = {
  Accuracy: { Balanced: number };
  getForegroundPermissionsAsync: jest.Mock;
  requestForegroundPermissionsAsync: jest.Mock;
  getCurrentPositionAsync: jest.Mock;
};

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

/** 一份全新的 geo 模块 + 与它配套的那份 expo-location 替身 */
async function freshGeo() {
  jest.resetModules();
  const loc = require("expo-location") as Mocked;
  loc.getForegroundPermissionsAsync.mockResolvedValue(granted);
  loc.requestForegroundPermissionsAsync.mockResolvedValue(granted);
  loc.getCurrentPositionAsync.mockResolvedValue(pos);
  const geo = (await import("@/lib/geo")) as typeof import("@/lib/geo");
  return { geo, loc };
}

describe("定位", () => {
  it("已授权时能取到坐标", async () => {
    const { geo } = await freshGeo();
    expect(await geo.locationIfGranted()).toEqual({ lat: 31.2304, lng: 121.4737 });
  });

  it("没授权时 locationIfGranted 不弹框、直接给 null", async () => {
    const { geo, loc } = await freshGeo();
    loc.getForegroundPermissionsAsync.mockResolvedValue(denied);
    expect(await geo.locationIfGranted()).toBeNull();
    // 关键：绝不能去申请权限（那会弹系统框），也不该白等一次 GPS
    expect(loc.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(loc.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it("ensureLocation 在用户拒绝后给 null，且不去取位置", async () => {
    const { geo, loc } = await freshGeo();
    loc.requestForegroundPermissionsAsync.mockResolvedValue(denied);
    expect(await geo.ensureLocation()).toBeNull();
    expect(loc.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it("并发调用只申请一次（用户只会看到一个权限框）", async () => {
    const { geo, loc } = await freshGeo();
    const [a, b] = await Promise.all([geo.ensureLocation(), geo.ensureLocation()]);
    expect(a).toEqual({ lat: 31.2304, lng: 121.4737 });
    expect(b).toEqual(a);
    expect(loc.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it("取过一次就缓存住，不反复唤醒 GPS", async () => {
    const { geo, loc } = await freshGeo();
    await geo.locationIfGranted();
    await geo.locationIfGranted();
    await geo.ensureLocation();
    expect(loc.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
  });

  it("定位失败（服务关了/超时）当作没有，而不是抛出去", async () => {
    const { geo, loc } = await freshGeo();
    loc.getCurrentPositionAsync.mockRejectedValue(new Error("location unavailable"));
    expect(await geo.locationIfGranted()).toBeNull();
  });
});
