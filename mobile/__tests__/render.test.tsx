/**
 * 渲染冒烟测试。
 *
 * 和 Web 版同一个思路：类型对、打包过，都不代表运行时不会炸（hook 用错、
 * 访问 undefined、图标名写错）。这里把每个页面**真的渲染一遍**，
 * 只在渲染期出错就会被抓住。
 *
 * 网络全部打桩：测试不该依赖线上接口是否可用。
 */
import { render, screen } from "@testing-library/react-native";

// 接口层整体打桩：页面挂载时会拉数据，真打网络会让测试又慢又不稳
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
      get: jest.fn(async () => ({})),
      post: jest.fn(ok),
      patch: jest.fn(ok),
      put: jest.fn(ok),
      del: jest.fn(ok),
      postPublic: jest.fn(ok),
    },
    mediaImage: () => ({ uri: "https://example.test/x.jpg" }),
    tokens: { access: "", load: async () => {}, save: async () => {}, clear: async () => {} },
    setUnauthorizedHandler: () => {},
    setOnboardingRequiredHandler: () => {},
  };
});

// 整体替身：不去 requireActual，真实模块会拉进未转译的 ESM（standard-navigation）
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: "1" }),
  useFocusEffect: (cb: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const React = require("react");
    React.useEffect(cb, []);
  },
  Redirect: () => null,
  Stack: () => null,
  Tabs: () => null,
  Link: () => null,
}));

import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/ui/feedback";
import { Button } from "@/ui/button";
import { Choice, Chip } from "@/ui/chip";
import { FieldRow } from "@/ui/field-row";
import { Input } from "@/ui/input";
import { Sheet } from "@/ui/sheet";
import { WheelPicker } from "@/ui/wheel-picker";
import { Empty, Skeleton } from "@/ui/feedback";
import { ProfileCard } from "@/components/profile-card";
import { RecommendCard } from "@/components/recommend-card";
import { MatchOverlay } from "@/components/match-overlay";
import Login from "../app/login";
import Onboarding from "../app/onboarding";
import Discover from "../app/(tabs)/index";
import Plaza from "../app/(tabs)/plaza";
import Likes from "../app/(tabs)/likes";
import ChatList from "../app/(tabs)/chat";
import ChatRoom from "../app/chat/[id]";
import UserDetail from "../app/user/[id]";
import Me from "../app/(tabs)/me";
import { api } from "@/lib/api";
import type { Card } from "@/lib/types";

const card: Card = {
  userId: 2, nickname: "小晴", age: 24, gender: 2, heightCm: 165,
  city: "上海市", cityProvince: "上海市", occupation: "互联网/IT · 产品经理",
  education: 3, distanceKm: 4, hasDistance: true,
  avatarUrl: "/api/v1/media/photos/2/a.jpg", photos: ["/api/v1/media/photos/2/a.jpg"],
  hobbies: ["摄影", "美食"], completeness: 92, softMismatch: ["收入"],
};

function wrap(ui: React.ReactElement) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider
        initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}
      >
        <AuthProvider>
          <ToastProvider>{ui}</ToastProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  // eslint-disable-next-line no-console
  console.log(`  ${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
}

function renderScreen(name: string, ui: React.ReactElement) {
  try {
    const r = render(wrap(ui));
    check(`${name} 渲染无异常`, !!r);
    return r;
  } catch (e) {
    check(`${name} 渲染无异常`, false, String(e).slice(0, 180));
    return null;
  }
}

describe("页面与组件渲染", () => {
  it("所有页面都能渲染出来", () => {
    renderScreen("登录页", <Login />);
    renderScreen("推荐（划卡）", <Discover />);
    renderScreen("恋爱广场", <Plaza />);
    renderScreen("心动", <Likes />);
    renderScreen("消息列表", <ChatList />);
    renderScreen("聊天室", <ChatRoom />);
    renderScreen("我的", <Me />);
    renderScreen("TA 的主页", <UserDetail />);
    renderScreen("资料向导", <Onboarding />);
    expect(failed).toBe(0);
  });

  it("推荐页的卡栈：一次只画三张，滑卡提示与按钮都在", async () => {
    // 上面那条用例里 /cards 返回空对象 → 走的是"没有推荐"的空态，
    // 卡栈那一整块（手势、纵深、提示）根本没被执行到。这里给它真的卡片。
    const get = api.get as jest.Mock;
    const original = get.getMockImplementation();
    const deck: Card[] = [
      // 最上面这张带上"推荐理由"三件套，好把卡片下半部分也跑到
      { ...card, reasons: ["身高合适", "学历达标"], sharedHobbies: ["摄影"], aboutMe: "写代码也写字，周末不是在山里就是在咖啡馆。" },
      { ...card, userId: 3, nickname: "阿雅" },
      { ...card, userId: 4, nickname: "林深" },
      { ...card, userId: 5, nickname: "多余的第四张" },
    ];
    get.mockImplementation(async (url: string) =>
      String(url).startsWith("/cards") ? { cards: deck, quota: { used: 0, limit: 10, remain: 10 } } : {}
    );

    try {
      const r = render(wrap(<Discover />));
      await r.findByText("小晴");

      // 后面两张是"露出一点点"的预览，对无障碍是隐藏的，所以要显式带上
      expect(r.getByText("阿雅", { includeHiddenElements: true })).toBeTruthy();
      expect(r.getByText("林深", { includeHiddenElements: true })).toBeTruthy();
      // 第四张不进栈
      expect(r.queryByText("多余的第四张", { includeHiddenElements: true })).toBeNull();

      // 滑动是加成，按钮是兜底——屏幕阅读器用户只有按钮可用，不能少
      expect(r.getByLabelText("喜欢")).toBeTruthy();
      expect(r.getByLabelText("跳过")).toBeTruthy();
      expect(r.getByText("左滑跳过 · 右滑喜欢 · 点一下看资料")).toBeTruthy();
      // 卡片本身现在可点开了，得让屏幕阅读器知道（原来只有滑动手势，卡是"死"的）
      expect(r.getByHintText("打开 TA 的主页")).toBeTruthy();
      // 额度充足时头部只有标题——常驻一个"今日还可喜欢 N 人"会把划卡页变成记账本
      expect(r.queryByText(/今日还可喜欢/)).toBeNull();

      // 卡片下半部分：为什么推荐给你（这是从参考图借来的那块）
      expect(r.getByText("契合点")).toBeTruthy();
      expect(r.getByText("身高合适")).toBeTruthy();
      expect(r.getByText("你们的共同兴趣")).toBeTruthy();
      expect(r.getByText(/写代码也写字/)).toBeTruthy();

    } finally {
      get.mockImplementation(original);
    }
  });

  it("推荐页额度快用完时，头部才冒出提示", async () => {
    const get = api.get as jest.Mock;
    const original = get.getMockImplementation();
    get.mockImplementation(async (url: string) =>
      String(url).startsWith("/cards") ? { cards: [card], quota: { used: 8, limit: 10, remain: 2 } } : {}
    );
    try {
      const r = render(wrap(<Discover />));
      await r.findByText("小晴");
      expect(r.getByText("今日还可喜欢 2 人")).toBeTruthy();
    } finally {
      get.mockImplementation(original);
    }
  });

  it("推荐页这一批划完了：能给一个「再看一批」", async () => {
    // 一次只取 10 张（服务端 cardBatchSize 也是 10），划完必须能续上。
    // 这一页不像 chat/likes/me 那样用 useFocusEffect，切走再切回来不刷新，
    // 所以没有这个按钮就只能退出重进 App。
    const r = render(wrap(<Discover />));
    await r.findByText("这一批看完了");
    expect(r.getByText("再看一批")).toBeTruthy();
    expect(r.getByText("去广场")).toBeTruthy();
  });

  it("关键组件渲染出该有的东西", () => {
    const c = render(wrap(<ProfileCard card={card} />));
    check("卡片显示昵称", !!c.getByText("小晴"));
    check("卡片显示年龄与城市", !!c.getByText(/24 岁 · 上海市 · 165cm/));
    check("卡片显示职业", !!c.getByText(/互联网\/IT · 产品经理/));
    check("卡片显示兴趣标签", !!c.getByText("摄影"));
    check("软条件不符有提示", !!c.getByText("部分条件不符"));

    // 推荐卡：没有理由时不该硬凑，而是给一句说明
    const rc = render(wrap(<RecommendCard card={card} />));
    check("推荐卡显示名字", !!rc.getByText("小晴"));
    check("推荐卡显示年龄", !!rc.getByText("24"));
    check("没有推荐理由时给出说明而不是空着", !!rc.getByText(/多填几项偏好/));
    check("推荐卡显示对方兴趣", !!rc.getByText("摄影"));

    const b = render(wrap(<Button label="喜欢" onPress={() => {}} />));
    check("按钮显示文案", !!b.getByText("喜欢"));

    const f = render(wrap(<FieldRow label="职业" value="互联网/IT · 产品经理" onPress={() => {}} />));
    check("字段行显示标签与值", !!f.getByText("职业") && !!f.getByText("互联网/IT · 产品经理"));

    const ch = render(wrap(<Choice label="学历" options={[{ value: 3, label: "本科" }]} value={3} onChange={() => {}} />));
    check("选项组渲染标签", !!ch.getByText("学历") && !!ch.getByText("本科"));

    const w = render(wrap(<WheelPicker options={[{ value: 170, label: "170" }, { value: 171, label: "171" }]} value={170} onChange={() => {}} />));
    check("滚轮渲染出选项", !!w.getByText("170"));

    const s = render(wrap(<Sheet open onClose={() => {}} title="身高" confirmText="确定"><Chip label="不限" on onPress={() => {}} /></Sheet>));
    check("弹层渲染标题与内容", !!s.getByText("身高") && !!s.getByText("不限"));

    const e = render(wrap(<Empty title="还没有人喜欢你" desc="多传几张照片" />));
    check("空态渲染标题与说明", !!e.getByText("还没有人喜欢你"));

    const sk = render(wrap(<Skeleton height={20} />));
    check("骨架屏渲染", !!sk);

    const i = render(wrap(<Input label="手机号" value="" onChangeText={() => {}} />));
    check("输入框渲染标签", !!i.getByText("手机号"));

    const m = render(
      wrap(
        <MatchOverlay
          visible
          myAvatar="/a.jpg"
          peerAvatar="/b.jpg"
          peerNickname="小晴"
          onChat={() => {}}
          onClose={() => {}}
        />
      )
    );
    check("配对页文案说人话", !!m.getByText("你们互相喜欢"));
    check("配对页有去聊天入口", !!m.getByText("去打个招呼"));

    expect(failed).toBe(0);
  });
});
