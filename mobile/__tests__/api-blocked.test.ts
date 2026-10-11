/**
 * api 层对「账号被限制」的识别。
 *
 * 单独一个文件：这里要**用真的 api 模块**（别的用例把它整体替身掉了），
 * 只把 fetch 换掉——要验的正是"响应是 403 ACCOUNT_BANNED 时，
 * 它会不会通知出去、话有没有带出来"。这是"点到被拦的动作"时的唯一通道。
 */
import { api, setAccountBlockedHandler, type AccountBlocked } from "@/lib/api";

describe("api 层：账号被限制", () => {
  it("403 ACCOUNT_BANNED → 通知出去，且把服务端那句话带上", async () => {
    const seen: AccountBlocked[] = [];
    setAccountBlockedHandler((i) => seen.push(i));

    const realFetch = global.fetch;
    global.fetch = (async () =>
      ({
        ok: false,
        status: 403,
        json: async () => ({
          code: "ACCOUNT_BANNED",
          message: "账号被限制：暂时不能喜欢别人",
          data: null,
        }),
      }) as unknown as Response) as typeof fetch;

    try {
      await expect(api.post("/actions", { toUser: 1, action: "like" })).rejects.toMatchObject({
        code: "ACCOUNT_BANNED",
      });
    } finally {
      global.fetch = realFetch;
      setAccountBlockedHandler(() => {});
    }

    expect(seen).toHaveLength(1);
    expect(seen[0].message).toContain("不能喜欢别人");
  });
});
