/**
 * 触感反馈。
 *
 * 有意做得「轻」——只有 5~12ms 的极短震动，模拟滚轮每过一格的咔哒感。
 * 超过 30ms 会让人以为来消息了，反而干扰。
 *
 * 兼容性：Android Chrome 支持；iOS Safari 至今不支持 Vibration API，
 * 会静默失败。所以这只是锦上添花，任何交互都不应「依赖」它才有反馈。
 */
export function haptic(ms = 8) {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(ms);
  } catch {
    /* 用户未授权或无振动马达，忽略 */
  }
}
