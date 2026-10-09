/**
 * 滑卡判定。
 *
 * 这段逻辑在手势回调（UI 线程）里跑，jest 环境里 reanimated 是替身、
 * 回调根本不会触发，所以只能靠这个纯函数测试来兜住"到底怎样才算滑了一下"。
 * 参数改错（比如把比例当绝对值）会在这里立刻红掉。
 */
import { SWIPE_RATIO, SWIPE_VELOCITY, decideSwipe } from "@/lib/swipe";

/** 390 宽的机器，卡栈左右各留 20 → 卡片约 350 */
const W = 350;
const FAR = W * SWIPE_RATIO;

describe("decideSwipe", () => {
  it("拖得够远：按位移方向判", () => {
    expect(decideSwipe(FAR + 1, 0, W)).toBe("like");
    expect(decideSwipe(-(FAR + 1), 0, W)).toBe("pass");
  });

  it("既没拖够、也没甩起来：当作没滑，卡片弹回去", () => {
    expect(decideSwipe(FAR - 1, SWIPE_VELOCITY - 1, W)).toBeNull();
    expect(decideSwipe(0, 0, W)).toBeNull();
    expect(decideSwipe(-(FAR - 1), -(SWIPE_VELOCITY - 1), W)).toBeNull();
  });

  it("短距离快甩：按速度方向判（只看位移会把快甩判反）", () => {
    expect(decideSwipe(8, SWIPE_VELOCITY + 1, W)).toBe("like");
    expect(decideSwipe(-8, -(SWIPE_VELOCITY + 1), W)).toBe("pass");
  });

  it("位移和速度冲突时以位移为准：拖到左边再往右甩，仍然是跳过", () => {
    // 拖过半张卡时"跳过"的提示章已经亮着了，松手那一刻反悔不该翻盘
    expect(decideSwipe(-W * 0.5, SWIPE_VELOCITY + 1, W)).toBe("pass");
    expect(decideSwipe(W * 0.5, -(SWIPE_VELOCITY + 1), W)).toBe("like");
  });

  it("阈值是卡片宽度的比例，不是固定像素", () => {
    // 同一个位移，窄屏算数、宽屏不算数
    expect(decideSwipe(120, 0, 350)).toBe("like");
    expect(decideSwipe(120, 0, 900)).toBeNull();
  });
});
