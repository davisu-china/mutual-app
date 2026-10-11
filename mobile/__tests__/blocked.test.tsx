/**
 * 被封禁时 App 的表现。
 *
 * 这条链路只有一个入口：**中间件在所有业务接口之前拦下来**，客户端能拿到的
 * 就那个 403 响应体。所以两件事必须都对：api 层认得出来（并带上管理员填的原因），
 * 说明页把原因原话显示出来。任一处漏了，用户看到的就是"划不动、发不出去"的一堆怪现象。
 */
import { render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AccountBlockedScreen } from "@/components/account-blocked";
import { api, setAccountBlockedHandler, type AccountBlocked } from "@/lib/api";

function wrap(ui: React.ReactElement) {
  return (
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}
    >
      {ui}
    </SafeAreaProvider>
  );
}

describe("账号被封禁", () => {
  it("api 层能从 403 里认出封禁，并把原因带出来", async () => {
    const reason = "头像与本人不符，请更换后联系客服";
    const seen: AccountBlocked[] = [];
    setAccountBlockedHandler((i) => seen.push(i));

    const realFetch = global.fetch;
    global.fetch = (async () =>
      ({
        ok: false,
        status: 403,
        json: async () => ({
          code: "ACCOUNT_BANNED",
          message: `账号已被封禁：${reason}`,
          data: { reason },
        }),
      }) as unknown as Response) as typeof fetch;

    try {
      await expect(api.get("/cards")).rejects.toMatchObject({ code: "ACCOUNT_BANNED" });
    } finally {
      global.fetch = realFetch;
      setAccountBlockedHandler(() => {});
    }

    expect(seen).toHaveLength(1);
    expect(seen[0].reason).toBe(reason);
    expect(seen[0].message).toContain(reason);
  });

  it("说明页把管理员填的原因原话显示出来", () => {
    const reason = "相册含违规内容，删除后可申请恢复";
    const r = render(
      wrap(<AccountBlockedScreen info={{ code: "ACCOUNT_BANNED", message: "账号已被封禁", reason }} onSignOut={() => {}} />)
    );
    expect(r.getByText("账号已被封禁")).toBeTruthy();
    expect(r.getByText("封禁原因")).toBeTruthy();
    expect(r.getByText(reason)).toBeTruthy();
    expect(r.getByText("退出登录")).toBeTruthy();
  });

  it("没有原因时不编一个（运维直接改库封的账号没有理由）", () => {
    const r = render(
      wrap(<AccountBlockedScreen info={{ code: "ACCOUNT_BANNED", message: "账号已被封禁" }} onSignOut={() => {}} />)
    );
    expect(r.getByText("账号已被封禁")).toBeTruthy();
    expect(r.queryByText("封禁原因")).toBeNull();
  });
});
