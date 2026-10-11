/**
 * 兴趣清单。
 *
 * 这张表有两个容易坏、但**运行时不会报错**的地方：
 *   1. 图标名写错——底图上就是一个空方块，肉眼不盯着看根本发现不了；
 *   2. 和 Web 端的词表不一致——兴趣名是**存进库**的（`user_hobbies.name`，
 *      卡片的"共同兴趣"也按它匹配），一边有、另一边没有，用户就会觉得
 *      "我在网页上选的标签怎么在 App 里找不到"。
 *
 * 所以这里既对图标库的 glyphMap，也对 Web 那份文件本身。
 */
import { readFileSync } from "fs";
import { join } from "path";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { HOBBIES, hobbyIcon } from "@/lib/labels";

describe("兴趣清单", () => {
  it("每个图标名都真实存在", () => {
    const missing = HOBBIES.filter((h) => !(h.icon in MaterialCommunityIcons.glyphMap));
    expect(missing.map((h) => `${h.name}→${h.icon}`)).toEqual([]);
  });

  it("名字不重复、不为空", () => {
    const names = HOBBIES.map((h) => h.name);
    expect(names.filter((n) => !n.trim())).toEqual([]);
    expect(names.length).toBe(new Set(names).size);
  });

  it("清单里没有的值也给一个存在的图标（老数据 / 别的端加的词）", () => {
    const icon = hobbyIcon("某个老数据里的词");
    expect(MaterialCommunityIcons.glyphMap[icon]).toBeDefined();
  });

  it("与 Web 端的词表完全一致（名字是存库的，两边必须同一份）", () => {
    const path = join(__dirname, "../../web/src/data/options.ts");
    const src = readFileSync(path, "utf8");
    const from = src.indexOf("export const HOBBIES = [");
    expect(from).toBeGreaterThan(-1);
    const block = src.slice(from, src.indexOf("];", from));
    const web = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

    const app = HOBBIES.map((h) => h.name);
    expect(web.length).toBe(app.length);
    expect(new Set(web)).toEqual(new Set(app));
    // 顺序也一起对：两端按同一个顺序铺标签，用户换端不会觉得"位置全变了"
    expect(web).toEqual(app);
  });
});
