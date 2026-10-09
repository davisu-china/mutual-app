/**
 * 滑卡的手势参数与判定。
 *
 * 单独放一个文件、而不是塞在页面里，有两个理由：
 *   1. 页面里除 default 之外的东西都不该是"路由"的一部分，组件/hook/工具
 *      按约定放在 `src/` 下；
 *   2. **这些数值得能被单测**。jest 环境里 reanimated 是手写替身，手势回调
 *      压根不会执行，判定逻辑留在 `onEnd` 里就等于没有任何测试覆盖。
 *      抽成纯函数之后，"多快算甩、多远算滑、方向怎么定"是可验证的。
 */

export type Dir = "like" | "pass";

/** 拖过卡片宽度的这个比例就算一次有效滑卡 */
export const SWIPE_RATIO = 0.28;
/** 或者甩得够快也算——短距离快甩不该白甩（单位 pt/s） */
export const SWIPE_VELOCITY = 800;
/** 卡片飞出的时长，和 FlyingCard 里的动画对齐 */
export const EXIT_MS = 380;
/** 卡栈纵深：每深一层缩小 4.5%、下沉 13pt、多减 34% 不透明度 */
export const DEPTH_SCALE = 0.045;
export const DEPTH_Y = 13;
export const DEPTH_FADE = 0.34;
/** 卡片回弹／升级用的弹簧，和 Web 版 framer-motion 的手感对齐 */
export const SPRING = { stiffness: 280, damping: 28 };

/**
 * 松手时的判定：这一次算不算滑卡、往哪边。不算则返回 null（卡片弹回原位）。
 *
 * `x` 是拖动位移、`vx` 是松手瞬间的横向速度。两个信号取其一：
 * 拖得够远看**位移**方向，短距离快甩看**速度**方向——
 * 如果一律看位移，一次"在手感上很明确"的快甩会因为位移小而被判成没滑。
 *
 * 带 `'worklet'` 是为了能在手势回调（UI 线程）里直接调用；
 * 它同时仍是普通函数，JS 线程和单测里照样能调。
 */
export function decideSwipe(x: number, vx: number, width: number): Dir | null {
  "worklet";
  const far = Math.abs(x) > width * SWIPE_RATIO;
  const fast = Math.abs(vx) > SWIPE_VELOCITY;
  if (!far && !fast) return null;
  return (far ? x : vx) > 0 ? "like" : "pass";
}
