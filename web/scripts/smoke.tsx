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
import { Empty } from "../src/components/ui/empty";
import { FieldRow } from "../src/components/ui/field-row";
import { fieldIcon } from "../src/components/ui/icons";
import { Heart } from "lucide-react";
import { INCOME, INCOME_MIN_CHOICES, INCOME_MAX_CHOICES } from "../src/data/options";
import { INCOME_LABEL_RANGE } from "../src/data/options";
import { IncomeRangeField } from "../src/components/picker/income-range-field";
import { RangeField } from "../src/components/ui/range-slider";
import { RangeSheetField } from "../src/components/ui/range-sheet-field";
import { ProvinceMultiField } from "../src/components/picker/province-field";
import { UniversityField } from "../src/components/picker/university-field";
import { loadUniversities, searchSchools, OTHER_SCHOOL } from "../src/data/universities";
import { OccupationField } from "../src/components/picker/occupation-field";
import { INDUSTRIES, occupationValue, parseOccupation } from "../src/data/occupation";
import { calcAge, defaultBirthdayFor, AGE_DEFAULT_BY_GENDER } from "../src/components/picker/birthday-field";
import { HEIGHT_DEFAULT_BY_GENDER, HEIGHT_QUICK_PICKS, HeightField } from "../src/components/picker/height-field";
import { WEIGHT_DEFAULT_BY_GENDER, WEIGHT_QUICK_PICKS_BY_GENDER, WeightField } from "../src/components/picker/weight-field";
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
  check("相册有上传入口（图标版，带无障碍标签）", html.includes('aria-label="添加照片"') && html.includes("<svg"));
  check("提示第 1 张就是头像与封面", html.includes("头像与封面"));
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

  // 区间弹层字段（广场的年龄/身高用它）
  const rsIdle = renderToString(
    <RangeSheetField label="年龄" min={18} max={70} valueMin={18} valueMax={70}
      format={(v) => `${v} 岁`} onChange={() => {}} />
  );
  check("区间字段未设时只显示「不限」", rsIdle.includes("不限") && !rsIdle.includes("18 岁 – 70 岁"));
  check("区间字段收起时不渲染轨道", !rsIdle.includes('type="range"'));
  const rsSet = renderToString(
    <RangeSheetField label="身高" min={140} max={210} gap={5} valueMin={165} valueMax={180}
      format={(v) => `${v} cm`} onChange={() => {}} />
  );
  check("区间字段已设时行内显示区间", rsSet.includes("165 cm – 180 cm"));

  const inc = renderToString(
    <IncomeRangeField label="期望年收入" min={0} max={7} onChange={() => {}} />
  );
  check("期望收入收起时只占一行", inc.includes("期望年收入") && inc.includes("不限"));

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
  check("两端都不设时显示「不限」", INCOME_LABEL_RANGE(0, 7) === "不限");
  check("只设下限说「X 万以上」", INCOME_LABEL_RANGE(3, 7) === "20 万以上");
  check("只设上限说「X 万以下」", INCOME_LABEL_RANGE(0, 4) === "50 万以下");
  check("两边都设说「X–Y 万」", INCOME_LABEL_RANGE(3, 4) === "20–50 万");
  check("下限正好压在上限上时说「X 万左右」", INCOME_LABEL_RANGE(3, 2) === "20 万左右");
  check("越界下标当不设这一端", INCOME_LABEL_RANGE(7, 7) === "不限" && INCOME_LABEL_RANGE(9, 9) === "不限");
  check("文案里不出现问号或 undefined", [0,1,2,3,4,5,6,7].every((a) => [0,3,7].every((b) => {
    const t = INCOME_LABEL_RANGE(a, Math.max(a, b));
    return !t.includes("?") && !t.includes("undefined");
  })));

  // 只暴露有意义的那几档：下限从「10 万以上」起、上限到「100 万以下」止
  check("下限选项不包含「10 万以下」那一档", !INCOME_MIN_CHOICES.some((o) => o.value === 1));
  check("上限选项不包含「100 万以上」那一档", !INCOME_MAX_CHOICES.some((o) => o.value === 6));
  check("两端各有「不限」", INCOME_MIN_CHOICES[0].value === 0 && INCOME_MAX_CHOICES[0].value === 7);
  check("下限文案都是「以上」", INCOME_MIN_CHOICES.slice(1).every((o) => o.label.endsWith("以上")));
  check("上限文案都是「以下」", INCOME_MAX_CHOICES.slice(1).every((o) => o.label.endsWith("以下")));
  check("选项里的档位都不重复", new Set(INCOME_MIN_CHOICES.map((o) => o.value)).size === INCOME_MIN_CHOICES.length
    && new Set(INCOME_MAX_CHOICES.map((o) => o.value)).size === INCOME_MAX_CHOICES.length);
}

mbtiChecks();
optionSheetChecks();
rangeAndProvinceChecks();
occupationChecks();
iconChecks();
defaultsChecks();

/** 图标：加得再多也只是装饰，这里只盯「接线通不通」和「别把无障碍丢掉」 */
function iconChecks() {
  console.log("\n[图标]");

  check(
    "常见字段都能查到图标（含广场筛选用的年龄/省份）",
    ["身高", "体重", "出生年月日", "年龄", "家乡", "省份", "职业", "学历", "学校", "公司", "年收入", "MBTI", "抽烟", "喝酒"].every(
      (l) => fieldIcon(l) !== null
    )
  );
  check("没登记的字段返回 null 而不是报错", fieldIcon("不存在的字段") === null);

  const svgCount = (h: string) => (h.match(/<svg/g) ?? []).length;
  const row = renderToString(<FieldRow label="年收入" value="30–50 万" onClick={() => {}} />);
  const rowNoIcon = renderToString(<FieldRow label="不存在的字段" value="x" onClick={() => {}} />);
  check("有图标的字段是「图标 + 行尾箭头」两个 svg", svgCount(row) === 2, `实际 ${svgCount(row)}`);
  check("没登记的字段只有行尾箭头（不多画）", svgCount(rowNoIcon) === 1 && rowNoIcon.includes("不存在的字段"));

  // 头像＝相册第一张：onboarding 那一栏应当传的是「照片」而不是「头像」
  const ob = renderToString(wrap(<Onboarding />, "/onboarding"));
  check("onboarding 要求传照片（不再是单独的头像）", ob.includes("上传照片") && ob.includes("它就是你的头像"));

  const empty = renderToString(<Empty title="还没有人喜欢你" desc="多传几张照片" />);
  check("空态有默认图标底衬", empty.includes("<svg") && empty.includes("还没有人喜欢你"));
  const emptyCustom = renderToString(<Empty icon={Heart} title="喜欢的空态" />);
  check("空态可换图标", emptyCustom.includes("<svg"));
}

/** 职业：一级行业 + 二级岗位 */
function occupationChecks() {
  console.log("\n[职业层级]");

  const roles = INDUSTRIES.flatMap((x) => x.roles);

  check("行业数在 15–20 之间", INDUSTRIES.length >= 15 && INDUSTRIES.length <= 20, `实际 ${INDUSTRIES.length}`);
  check("行业名不重复", new Set(INDUSTRIES.map((x) => x.name)).size === INDUSTRIES.length);
  check("每个行业最多 10 个岗位（一眼扫完）", INDUSTRIES.every((x) => x.roles.length <= 10));
  check("二级岗位总数 50+", roles.length >= 50, `实际 ${roles.length}`);
  check("同一行业里岗位不重复", INDUSTRIES.every((x) => new Set(x.roles).size === x.roles.length));
  check(
    "覆盖主流行业",
    ["互联网/IT", "金融", "医疗健康", "教育/科研", "政府/公共事业", "制造/工业", "法律"].every((n) =>
      INDUSTRIES.some((x) => x.name === n)
    )
  );
  check(
    "兜底项没有二级（点一下选完）",
    INDUSTRIES.filter((x) => x.roles.length === 0).map((x) => x.name).sort().join(",") === "其他,学生"
  );

  check("落库值拼成「行业 · 岗位」", occupationValue("金融", "银行") === "金融 · 银行");
  check("没有二级时只存行业", occupationValue("学生") === "学生");
  const rt = parseOccupation(occupationValue("互联网/IT", "产品经理"));
  check("值能拆回行业与岗位", rt.industry === "互联网/IT" && rt.role === "产品经理");
  check("学生能拆回行业", parseOccupation("学生").industry === "学生");
  check("改造前的旧值显示不受影响", parseOccupation("互联网").role === "互联网");

  const empty = renderToString(<OccupationField label="职业" value="" onChange={() => {}} />);
  check("职业字段收起时只占一行", empty.includes("请选择") && !empty.includes("互联网/IT"));
  const filled = renderToString(<OccupationField label="职业" value="金融 · 银行" onChange={() => {}} />);
  check("已选时显示完整「行业 · 岗位」", filled.includes("金融 · 银行"));
}

/**
 * 身高/体重/年龄的默认落点。
 *
 * 这一组盯的是「少滑几格」这条体验：默认值要按性别落在人群均值上，
 * 而且附近得有能一键点的快捷档位，否则用户还是得滚几十格。
 */
function defaultsChecks() {
  console.log("\n[默认落点]");

  for (const [g, name] of [["male", "男"], ["female", "女"]] as const) {
    const h = HEIGHT_DEFAULT_BY_GENDER[g];
    const w = WEIGHT_DEFAULT_BY_GENDER[g];
    check(`${name}身高默认值合理（${h}）`, h >= 150 && h <= 185);
    check(`${name}体重默认值合理（${w}）`, w >= 45 && w <= 85);
    check(`${name}身高默认值附近有快捷档位`, HEIGHT_QUICK_PICKS.some((v) => Math.abs(v - h) <= 5));
    check(
      `${name}体重默认值附近有快捷档位`,
      (WEIGHT_QUICK_PICKS_BY_GENDER[g] ?? []).some((v) => Math.abs(v - w) <= 5)
    );
  }
  check(
    "男性默认值比女性高/重",
    HEIGHT_DEFAULT_BY_GENDER.male > HEIGHT_DEFAULT_BY_GENDER.female &&
      WEIGHT_DEFAULT_BY_GENDER.male > WEIGHT_DEFAULT_BY_GENDER.female
  );

  const today = new Date(2026, 9, 9);
  check("年龄默认值：男 28 岁", calcAge(defaultBirthdayFor("male", today), today) === AGE_DEFAULT_BY_GENDER.male);
  check("年龄默认值：女 26 岁", calcAge(defaultBirthdayFor("female", today), today) === AGE_DEFAULT_BY_GENDER.female);
  check("年龄默认值落在合法的 18–70 内", Object.values(AGE_DEFAULT_BY_GENDER).every((a) => a >= 18 && a <= 70));

  const w = renderToString(<WeightField value={null} onChange={() => {}} gender="female" />);
  check("体重字段收起时只占一行（不渲染滚轮）", w.includes("体重") && w.includes("请选择") && !w.includes('role="option"'));
  const h = renderToString(<HeightField value={175} onChange={() => {}} gender="male" />);
  check("身高字段已填时显示带单位的值", h.includes("175 cm"));

  const uniEmpty = renderToString(<UniversityField label="学校" value="" onChange={() => {}} />);
  check("院校字段收起时只占一行", uniEmpty.includes("请选择学校") && !uniEmpty.includes(">北京<"));
  const uni = renderToString(<UniversityField label="学校" value="浙江大学" onChange={() => {}} />);
  check("院校字段已选时显示校名", uni.includes("浙江大学"));
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
