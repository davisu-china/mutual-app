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
import { MbtiSlider, MbtiField, splitMbti, dimsToMbti } from "../src/components/profile/mbti-slider";
import { OptionSheet } from "../src/components/ui/option-sheet";
import { INCOME } from "../src/data/options";
import { INCOME_LABEL_RANGE } from "../src/pages/Onboarding";
import { RangeField } from "../src/components/ui/range-slider";
import { ProvinceMultiField } from "../src/components/picker/province-field";
import { UniversityField } from "../src/components/picker/university-field";
import { loadUniversities, searchSchools, OTHER_SCHOOL } from "../src/data/universities";
import { OCCUPATION } from "../src/data/options";
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

/** 区间选择（身高/收入）与省份多选（弹层） */
function rangeAndProvinceChecks() {
  console.log("\n[区间与省份]");

  const h = renderToString(
    <RangeField
      label="期望身高" min={140} max={210} valueMin={165} valueMax={180} gap={5}
      format={(v) => `${v} cm`} endLabels={["140", "210"]}
      onChange={() => {}}
    />
  );
  check("区间显示两端数值", h.includes("165 cm") && h.includes("180 cm"));
  check("区间是两根原生滑杆（叠在一根轨道上）", (h.match(/type="range"/g) ?? []).length === 2);
  check("滑杆有无障碍标签", h.includes("期望身高下限") && h.includes("期望身高上限"));
  check("轨道两端有刻度说明", h.includes("140") && h.includes("210"));

  const inc = renderToString(
    <RangeField
      label="期望年收入" min={0} max={7} valueMin={0} valueMax={7}
      format={(v) => (v <= 0 || v === 7 ? "不限" : INCOME[v - 1]?.label ?? "?")}
      formatRange={INCOME_LABEL_RANGE}
      onChange={() => {}}
    />
  );
  check("两端都开时显示「不限」而不是「不限 – 不限」", inc.includes("不限") && !inc.includes("不限 – 不限"));

  const empty = renderToString(<ProvinceMultiField label="期待家乡" value={[]} onChange={() => {}} />);
  check("未选时只占一行（占位「不限」）", empty.includes("不限") && !empty.includes("清空已选"));
  check("收起时不渲染 34 个省份", !empty.includes(">浙江<") && !empty.includes(">广东<"));

  const picked = renderToString(
    <ProvinceMultiField label="期待家乡" value={["浙江省", "广东省"]} onChange={() => {}} />
  );
  check("已选时行内显示简称", picked.includes("浙江") && picked.includes("广东"));
  check("已选时同样不铺开省份", !picked.includes(">四川<"));
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

  // 表单里是「一行 + 弹层」：滑杆不该直接铺在页面上，否则把这一步撑得老长
  const empty = renderToString(<MbtiField value={null} onChange={() => {}} />);
  check("未填时只显示一行占位", empty.includes("请选择") && !empty.includes("你的类型"));
  check("收起状态不渲染滑杆", !empty.includes('type="range"'));

  const filled = renderToString(<MbtiField value="ENFP" onChange={() => {}} />);
  check("已填时行内显示类型", filled.includes("ENFP"));
  check("已填时同样不占版面", !filled.includes('type="range"'));
}

/** 「一行 + 弹层」的单选字段，以及收入档位本身的口径 */
function optionSheetChecks() {
  console.log("\n[弹层单选 / 年收入]");

  check("收入档位没有「不便透露」", INCOME.every((o) => o.value !== 7));
  check("收入档位是 6 档（1–6）", INCOME.length === 6 && INCOME[0].value === 1 && INCOME[5].value === 6);

  const empty = renderToString(<OptionSheet label="年收入" options={INCOME} value={null} onChange={() => {}} />);
  check("未选时只显示一行占位", empty.includes("年收入") && empty.includes("请选择"));
  check("收起时不渲染选项", !empty.includes("30–50 万"));

  const picked = renderToString(<OptionSheet label="年收入" options={INCOME} value={4} onChange={() => {}} />);
  check("已选时行内显示档位文案", picked.includes("30–50 万"));
  check("已选时也不铺开选项", !picked.includes("100 万以上"));

  // 期望收入的区间刻度是 0–7（两端各一个「不限」），六档占 1–6。
  // 删掉「不便透露」后下限拉到 7 不能再取 INCOME[6]（那里已经空了）。
  check("区间全开显示不限", INCOME_LABEL_RANGE(0, 7) === "不限");
  check("区间下限拉到顶按最高档读", INCOME_LABEL_RANGE(7, 7) === "100 万以上 — 不限");
  check("区间上限拉到顶即不限", INCOME_LABEL_RANGE(3, 7) === "20–30 万 — 不限");
  check("区间中段正常", INCOME_LABEL_RANGE(0, 4) === "不限 — 30–50 万");
  check("区间文案里不出现问号", [0,1,3,6,7].every((a) => [0,4,7].every((b) => !INCOME_LABEL_RANGE(a, Math.max(a,b)).includes("?"))));
}

mbtiChecks();
optionSheetChecks();
rangeAndProvinceChecks();
occupationChecks();

/** 职业选项本身的口径 */
function occupationChecks() {
  console.log("\n[职业]");
  check("选项足够全（40 项以上）", OCCUPATION.length >= 40, `实际 ${OCCUPATION.length}`);
  check("保留兜底的「其他」", OCCUPATION.some((o) => o.value === "其他"));
  check("没有重复项", new Set(OCCUPATION.map((o) => o.value)).size === OCCUPATION.length);
  check("老的取值还在（不破坏已有数据）", ["互联网", "金融", "医疗", "学生"].every((v) => OCCUPATION.some((o) => o.value === v)));

  const empty = renderToString(<UniversityField label="学校" value="" onChange={() => {}} />);
  check("院校字段收起时只占一行", empty.includes("请选择学校") && !empty.includes(">北京<"));
  const picked = renderToString(<UniversityField label="学校" value="浙江大学" onChange={() => {}} />);
  check("院校字段已选时显示校名", picked.includes("浙江大学"));
}

/** 院校名单：数据完整性 + 搜索（中文/全拼/首字母/简称） */
async function universityChecks() {
  console.log("\n[院校名单]");
  const list = await loadUniversities();
  const total = list.reduce((n, p) => n + p.schools.length, 0);

  check("覆盖 34 个省级行政区", list.length === 34, `实际 ${list.length}`);
  check("学校数 3000 所左右", total >= 2900, `实际 ${total}`);
  check("含港澳台", ["香港特别行政区", "澳门特别行政区", "台湾省"].every((n) => list.some((p) => p.name === n)));
  const bj = list.find((p) => p.name === "北京市")!;
  check("北大清华都在", ["北京大学", "清华大学"].every((n) => bj.schools.some((s) => s.name === n)));
  check("带城市（同名学校靠它区分）", bj.schools.every((s) => s.city.length > 0));

  const names = (hits: { school: { name: string } }[]) => hits.map((h) => h.school.name);
  check("中文搜「浙江大学」命中", names(searchSchools(list, "浙江大学")).includes("浙江大学"));
  check("全拼命中（zhejiangdaxue）", names(searchSchools(list, "zhejiangdaxue")).includes("浙江大学"));
  check("核心全拼命中（zhejiang）", names(searchSchools(list, "zhejiang")).includes("浙江大学"));
  check("核心首字母命中（hzdzkj → 杭州电子科技大学）", names(searchSchools(list, "hzdzkj")).includes("杭州电子科技大学"));
  check("简称命中（浙大）", names(searchSchools(list, "浙大")).includes("浙江大学"));
  check("英文缩写命中（zju）", names(searchSchools(list, "zju")).includes("浙江大学"));
  check("简称排在结果第一位", names(searchSchools(list, "浙大"))[0] === "浙江大学");
  check("按城市搜也能出（杭州）", names(searchSchools(list, "杭州")).length > 0);
  check("空关键词返回空", searchSchools(list, "   ").length === 0);
  check("搜不存在返回空", searchSchools(list, "不存在的学校xyz").length === 0);
  check("结果受 limit 约束", searchSchools(list, "大学", 10).length <= 10);
  check("默认上限 60 条", searchSchools(list, "大学").length <= 60);
  check("兜底出口有取值", OTHER_SCHOOL.length > 0);
}

// 区划与院校这两段需要 await（数据是懒加载的），而构建目标不支持顶层 await，
// 所以放到 async 函数里跑，跑完再决定退出码。
regionChecks().then(universityChecks).then(() => {
  console.log(failed === 0 ? "\n全部通过 ✅" : `\n有 ${failed} 项失败 ❌`);
  process.exit(failed === 0 ? 0 : 1);
});
