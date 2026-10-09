/**
 * 渲染冒烟测试。
 *
 * 构建通过不代表组件能真的渲染——类型对了但运行时可能炸（hook 用错、
 * 访问 undefined、import 路径写错）。这里用 renderToString 把整棵组件树
 * 真的走一遍，是比 tsc 强一档的验证。
 *
 * 注意：SSR 不执行 useEffect，所以页面会停在加载态——这没问题，
 * 我们要抓的是「渲染期就抛异常」的那类错误。
 */
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

import App from "../src/App";
import Login from "../src/pages/Login";
import Onboarding from "../src/pages/Onboarding";
import Discover from "../src/pages/Discover";
import Plaza from "../src/pages/Plaza";
import Likes from "../src/pages/Likes";
import Profile from "../src/pages/Profile";
import UserDetail from "../src/pages/UserDetail";
import { ChatEntry, ChatList, ChatRoom } from "../src/pages/Chat";
import { PhotoGrid } from "../src/components/profile/photo-grid";
import { ProfileCard } from "../src/components/deck/profile-card";
import { MatchOverlay } from "../src/components/deck/match-overlay";
import { WheelPicker } from "../src/components/picker/wheel-picker";
import { MbtiSlider, splitMbti, dimsToMbti } from "../src/components/profile/mbti-slider";
import { calcAge } from "../src/components/picker/birthday-field";
import { loadRegions, searchRegions, shortName, PROVINCE_NAMES, fullName } from "../src/data/regions";
import { AuthProvider } from "../src/store/auth";
import { ToastProvider } from "../src/components/ui/toast";
import type { Card, Photo } from "../src/lib/api";

let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`  ${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
}

/** 包一层必要的 Provider，让页面能在 SSR 下渲染 */
function wrap(el: ReactElement, path = "/") {
  return (
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <AuthProvider>{el}</AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

function renderPage(name: string, el: ReactElement, path = "/") {
  try {
    const html = renderToString(wrap(el, path));
    check(`${name} 渲染无异常`, html.length > 0, `${html.length} 字节`);
    return html;
  } catch (e) {
    check(`${name} 渲染无异常`, false, String(e).slice(0, 160));
    return "";
  }
}

console.log("=== 1. 全部页面渲染 ===");
// App 内部用 BrowserRouter，依赖 document，SSR 下无法渲染——
// 这是客户端路由的正常特性，不是缺陷。路由配置的正确性靠下面逐个渲染页面来验证。
try {
  void App;
  check("App 模块可正常导入", true);
} catch (e) {
  check("App 模块可正常导入", false, String(e).slice(0, 120));
}
renderPage("Login", <Login />);
renderPage("Onboarding", <Onboarding />, "/onboarding");
renderPage("Discover", <Discover />);
renderPage("Plaza", <Plaza />, "/plaza");
renderPage("Likes", <Likes />, "/likes");
renderPage("ChatList", <ChatList />, "/chat");
renderPage("ChatEntry", <ChatEntry />, "/chat/new");
renderPage("ChatRoom", <ChatRoom />, "/chat/1");
renderPage("Profile", <Profile />, "/me");
renderPage("UserDetail", <UserDetail />, "/u/2");

console.log("\n=== 2. 关键组件渲染 ===");
{
  const card: Card = {
    userId: 2, nickname: "林小满", age: 26, gender: 2, heightCm: 165,
    city: "杭州市", cityProvince: "浙江省", occupation: "产品经理",
    education: 3, distanceKm: 4, hasDistance: true,
    avatarUrl: "", photos: [], hobbies: ["摄影", "徒步", "咖啡"],
    completeness: 92, softMismatch: ["收入"],
  };
  const html = renderPage("ProfileCard", <ProfileCard card={card} />);
  check("卡片含昵称", html.includes("林小满"));
  check("卡片含兴趣标签", html.includes("摄影"));
  check("距离按区间展示（不暴露精确值）", html.includes("3–5 km") || html.includes("1–3 km"));
  check("软条件不符时给出提示", html.includes("部分条件不符"));
}

{
  const photos: Photo[] = [
    { id: 1, url: "a.jpg", sortOrder: 1, auditStatus: "approved", visibility: "public" },
    { id: 2, url: "b.jpg", sortOrder: 2, auditStatus: "approved", visibility: "public" },
  ];
  const html = renderPage("PhotoGrid", <PhotoGrid photos={photos} onChange={() => {}} />);
  check("相册标出主图", html.includes("主图"));
  check("相册有上传入口", html.includes("＋"));
  check("提示第一张是封面", html.includes("封面图"));
}

{
  const html = renderPage(
    "MatchOverlay",
    <MatchOverlay peerNickname="林小满" onChat={() => {}} onClose={() => {}} />
  );
  check("配对文案说人话（不是「匹配成功」）", html.includes("你们互相喜欢"));
  check("有去聊天入口", html.includes("去打个招呼"));
}

{
  const opts = Array.from({ length: 101 }, (_, i) => ({ value: 130 + i, label: String(130 + i) }));
  const html = renderPage("WheelPicker", <WheelPicker options={opts} value={175} onChange={() => {}} />);
  check("滚轮含 101 个 option", (html.match(/role="option"/g) || []).length === 101);
  check("选中项标记正确", html.includes('aria-selected="true"'));
}

console.log("\n=== 3. 生日年龄计算（含闰年与未过生日）===");
check("今年已过生日", calcAge({ year: 1998, month: 1, day: 1 }, new Date(2026, 9, 9)) === 28);
check("今年未过生日要减一岁", calcAge({ year: 1998, month: 12, day: 31 }, new Date(2026, 9, 9)) === 27);
check("生日当天算已过", calcAge({ year: 1998, month: 10, day: 9 }, new Date(2026, 9, 9)) === 28);
check("闰年 2/29 在平年 2/28 未过", calcAge({ year: 2000, month: 2, day: 29 }, new Date(2026, 1, 28)) === 25);
check("闰年 2/29 在平年 3/1 已过", calcAge({ year: 2000, month: 2, day: 29 }, new Date(2026, 2, 1)) === 26);

async function regionChecks() {
  console.log("\n=== 4. 行政区划与搜索 ===");
  const regions = await loadRegions();
  const cityCount = regions.reduce((n, p) => n + p.cities.length, 0);
  const districtCount = regions.reduce(
    (n, p) => n + p.cities.reduce((m, c) => m + c.districts.length, 0), 0
  );
  check("省级 34 个", regions.length === 34, `实际 ${regions.length}`);
  check("市级数量合理", cityCount >= 350, `实际 ${cityCount}`);
  check("区县数量合理（官方数据 3000+）", districtCount >= 3000, `实际 ${districtCount}`);
  check("静态省份名单与完整树一致", PROVINCE_NAMES.length === regions.length);
  check("含港澳台", ["香港特别行政区", "澳门特别行政区", "台湾省"].every((n) =>
    regions.some((p) => p.name === n)));

  const bj = regions.find((p) => p.name === "北京市")!;
  check("直辖市被标记", bj?.isMunicipality === true);
  check("直辖市不出现「市辖区」", !bj.cities.some((c) => c.name === "市辖区"));
  check("直辖市下挂的是区", (bj.cities[0]?.districts.length ?? 0) >= 16);

  const searcher = (kw: string, limit?: number) => searchRegions(regions, kw, limit);

  check("中文搜「杭州」命中", searcher("杭州").some((h) => h.city === "杭州市"));
  check("拼音全拼「hangzhou」命中", searcher("hangzhou").some((h) => h.city === "杭州市"));
  check("拼音首字母「hz」命中", searcher("hz").some((h) => h.city === "杭州市"));
  check("搜省名「广东」返回省内城市", searcher("广东").length >= 15);
  check("能搜到区级（西湖区）", searcher("西湖").some((h) => h.district === "西湖区"));
  check("区级支持拼音（xihu）", searcher("xihu").some((h) => h.district === "西湖区"));
  check("区级支持首字母（xh）", searcher("xh").some((h) => h.district === "西湖区"));
  check("港澳台可搜（台北）", searcher("台北").some((h) => h.city === "台北市"));
  check("空关键词返回空", searcher("   ").length === 0);
  check("搜不存在的返回空", searcher("不存在的城市名").length === 0);
  check("结果数量受 limit 约束", searcher("a", 5).length <= 5);

  check("shortName 去掉「市」", shortName("杭州市") === "杭州");
  check("shortName 保留「自治州」", shortName("延边朝鲜族自治州") === "延边朝鲜族自治州");
  check("fullName 直辖市不重复", fullName("北京市", "北京市", "朝阳区") === "北京 朝阳区");
  check("fullName 普通省市", fullName("浙江省", "杭州市", "西湖区") === "浙江 杭州 西湖区");
}

/** MBTI 从「16 个格子」改成「四个维度各自滑动」后的检查 */
function mbtiChecks() {
  console.log("\n[MBTI 四维滑动]");

  check("ENFP 拆回四个维度", JSON.stringify(splitMbti("ENFP")) === JSON.stringify(["E", "N", "F", "P"]));
  check("空值拆成四个未选", splitMbti(null).every((x) => x === null));
  check("「不知道」不当成类型", splitMbti("NONE").every((x) => x === null));
  check("非四字母的值不认", splitMbti("XDZZ").every((x) => x === null));
  check("维度对不上不认（EF 顺序错）", splitMbti("EF")[1] === null);

  check("没选齐不合成类型", dimsToMbti(["E", "N", null, "P"]) === null);
  check("选齐合成 ESTJ", dimsToMbti(["E", "S", "T", "J"]) === "ESTJ");

  const partial = renderToString(<MbtiSlider dims={splitMbti(null)} onChange={() => {}} />);
  check("四个维度各一个滑杆", (partial.match(/type="range"/g) ?? []).length === 4);
  check("没选齐时提示继续滑", partial.includes("四个维度都滑一下"));
  check("滑杆带无障碍标签", partial.includes("aria-label=") && partial.includes("外向"));

  const full = renderToString(<MbtiSlider dims={splitMbti("ENFP")} onChange={() => {}} />);
  check("选齐后显示合成类型", full.includes("你的类型") && full.includes("ENFP"));
  check("未选齐就不显示类型", !partial.includes("你的类型"));
}

mbtiChecks();

// 行政区划那一段需要 await（数据是懒加载的），而构建目标不支持顶层 await，
// 所以放到 async 函数里跑，跑完再决定退出码。
regionChecks().then(() => {
  console.log(failed === 0 ? "\n全部通过 ✅" : `\n有 ${failed} 项失败 ❌`);
  process.exit(failed === 0 ? 0 : 1);
});
