/**
 * 账号被限制（封禁）时的表现。
 *
 * ⚠️ 口径是**"限制互动"，不是"踢出去"**（2026-10-11 用户明确）：
 * 被限制的人还能看推荐、看消息、改资料，只是不能喜欢别人、不能发消息。
 * 所以界面上的表现是**一条横幅 + 点到被拦的动作时说明原因**，
 * 而上一版是把整个界面盖住的整屏遮罩（等于踢人，方向错了）。
 */
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ToastProvider } from "@/ui/feedback";
import { AuthProvider } from "@/lib/auth";
import { RestrictionBanner } from "@/components/restriction";
import { api } from "@/lib/api";

const REASON = "头像与本人不符，请更换后联系客服";

jest.mock("@/lib/api", () => {
  const ok = async (v: unknown) => v;
  return {
    API_BASE: "https://example.test/api/v1",
    ORIGIN: "https://example.test",
    ApiError: class ApiError extends Error {
      code = "X";
      status = 0;
    },
    api: {
      get: jest.fn(async (path: string) =>
        path === "/users/me" ? { userId: 7, accountStatus: "banned", banReason: REASON } : {}
      ),
      post: jest.fn(ok),
      patch: jest.fn(ok),
      put: jest.fn(ok),
      del: jest.fn(ok),
      postPublic: jest.fn(ok),
    },
    mediaImage: () => ({ uri: "https://example.test/x.jpg" }),
    tokens: { access: "test-token", load: async () => {}, save: async () => {}, clear: async () => {} },
    setUnauthorizedHandler: () => {},
    setOnboardingRequiredHandler: () => {},
    setAccountBlockedHandler: () => {},
  };
});

function wrap(ui: React.ReactElement) {
  return (
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}
    >
      <AuthProvider>
        <ToastProvider>{ui}</ToastProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

describe("账号被限制", () => {
  it("登录着的人被限制：横幅出现，说清楚是哪两件事不能做", async () => {
    const r = render(wrap(<RestrictionBanner />));
    await waitFor(() => expect(r.getByText(/账号被限制/)).toBeTruthy());
    expect(r.getByText(/不能喜欢别人、不能发消息/)).toBeTruthy();
  });

  it("点「详情」能看到管理员填的原因原话", async () => {
    const r = render(wrap(<RestrictionBanner />));
    await waitFor(() => expect(r.getByText("详情")).toBeTruthy());
    fireEvent.press(r.getByText("详情"));

    expect(r.getByText("限制原因")).toBeTruthy();
    expect(r.getByText(REASON)).toBeTruthy();
    // 说明里要讲明白"还能做什么"，否则用户以为号废了
    expect(r.getByText(/看推荐、看消息、改资料都不受影响/)).toBeTruthy();
  });

  it("没被限制的人什么都看不到", async () => {
    const get = api.get as jest.Mock;
    const original = get.getMockImplementation();
    get.mockImplementation(async () => ({ userId: 7, accountStatus: "active" }));
    try {
      const r = render(wrap(<RestrictionBanner />));
      // 等启动那次 /users/me 落地
      await waitFor(() => expect(get).toHaveBeenCalledWith("/users/me"));
      expect(r.queryByText(/账号被限制/)).toBeNull();
    } finally {
      get.mockImplementation(original);
    }
  });

});
