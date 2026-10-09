/**
 * 渲染冒烟测试。
 *
 * 构建通过不代表组件能真的渲染出来——类型对了但运行时可能炸
 * （比如 hook 用错、访问了 undefined、SSR 不兼容）。这里用
 * renderToString 把组件树真的走一遍，是比 tsc 强一档的验证。
 */
import { renderToString } from "react-dom/server";
import App from "../src/App";
import { WheelPicker } from "../src/components/picker/wheel-picker";
import { calcAge } from "../src/components/picker/birthday-field";
import { searchCities, shortName, REGIONS } from "../src/data/regions";

let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`  ${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
}

console.log("=== 1. 整页渲染（App）===");
const html = renderToString(<App />);
check("App 渲染无异常", html.length > 0, `${html.length} 字节`);
check("含「先认识一下你」", html.includes("先认识一下你"));
check("含四个字段标签", ["出生年月日", "身高", "家乡", "现居地"].every((t) => html.includes(t)));
check("进度条文案已渲染", /0[^<]*\/ *=?4 已填写|0 \/ 4 已填写/.test(html.replace(/<!--[^>]*-->/g, "")));

console.log("\n=== 2. 滚轮渲染 ===");
const opts = Array.from({ length: 101 }, (_, i) => ({ value: 130 + i, label: String(130 + i) }));
const wheel = renderToString(
  <WheelPicker options={opts} value={175} onChange={() => {}} ariaLabel="身高" />
);
check("滚轮渲染无异常", wheel.length > 0, `${wheel.length} 字节`);
check("含 101 个 option", (wheel.match(/role="option"/g) || []).length === 101);
check("选中项标记正确", wheel.includes('aria-selected="true"'));

console.log("\n=== 3. 生日年龄计算（含闰年与未过生日）===");
check("今年已过生日", calcAge({ year: 1998, month: 1, day: 1 }, new Date(2026, 9, 9)) === 28);
check("今年未过生日要减一岁", calcAge({ year: 1998, month: 12, day: 31 }, new Date(2026, 9, 9)) === 27);
check("生日当天算已过", calcAge({ year: 1998, month: 10, day: 9 }, new Date(2026, 9, 9)) === 28);
check("闰年 2 月 29 日不算过", calcAge({ year: 2000, month: 2, day: 29 }, new Date(2026, 1, 28)) === 25);
check("闰年 3 月 1 日算过了", calcAge({ year: 2000, month: 2, day: 29 }, new Date(2026, 2, 1)) === 26);

console.log("\n=== 4. 省市搜索 ===");
check("中文搜「杭州」命中", searchCities("杭州").some((h) => h.city === "杭州市"));
check("拼音搜「hangzhou」命中", searchCities("hangzhou").some((h) => h.city === "杭州市"));
check("拼音首字母「hz」命中", searchCities("hz").some((h) => h.city === "杭州市"));
check("搜省名「广东」返回省内城市", searchCities("广东").length >= 20);
check("空关键词返回空", searchCities("   ").length === 0);
check("搜不存在的返回空", searchCities("不存在的城市名").length === 0);
check("省份数据 34 个", REGIONS.length === 34, `实际 ${REGIONS.length}`);
check("shortName 去掉「市」", shortName("杭州市") === "杭州");
check("shortName 保留「自治州」", shortName("延边朝鲜族自治州") === "延边朝鲜族自治州");

console.log(failed === 0 ? "\n全部通过 ✅" : `\n有 ${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);
