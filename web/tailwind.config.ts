import type { Config } from "tailwindcss";

/**
 * 设计令牌 —— 与《技术方案 4.1 色彩》对应（2026-10-09 整体重调）。
 *
 * 调色方向：**干玫瑰 + 暖白 + 香槟金点缀**。
 *
 * 上一版是「糖果粉 + 冷灰」：主色 #E4596B 饱和度偏高、又在按钮/选中态/气泡上
 * 反复出现，整屏都在喊；中性色带紫调，和暖调的粉凑在一起发浑。高级感的来源
 * 其实是克制与层次，所以这一版做了三件事：
 *   1. 主色降饱和、往深里走（胭脂红 → 干玫瑰），并给它配深色档，
 *      渐变改成「中调 → 深调」而不是「亮 → 暗」，避免塑料感；
 *   2. 中性色全部转暖（墨色带一点红棕、纸色带一点米），与前色同源才不脏；
 *   3. 加一个香槟金作**第二强调色**，只用在仪式感的地方（配对成功、心动标记），
 *      用得少才显贵。
 *
 * 所有颜色都从这里取，组件里不写死色值（历史上漏过 11 处，已清理）。
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#A32E4E", // 深酒红：脱离"糖果粉"，成年人的玫瑰色
          dark: "#86243F", // 按下态 / 深色文字
          deep: "#61182C", // 渐变的深端
          soft: "#F9EEF1", // 极浅底（选中态背景）
          line: "#EED8DE", // 浅描边
          glow: "rgba(163,46,78,.26)",
        },
        // 香槟金：只给仪式感的地方用（配对、心动标记、少量点缀）
        gold: { DEFAULT: "#A8763E", soft: "#F6EFE4", line: "#E6D6BE" }, // 香槟金（只用于仪式感）
        ink: { DEFAULT: "#1A1512", 2: "#46403A" }, // 暖墨（带红棕，不是冷黑）
        muted: { DEFAULT: "#6B615A", 2: "#8C8178" }, // 2 是 12–13px 的提示文字，压深保证可读
        line: { DEFAULT: "#E7DDD2", soft: "#F1EAE1" }, // 暖沙色描边
        paper: "#F7F3EE", // **象牙白**：明显比近白纸暖，卡片才在底上"浮"得起来
        surface: "#FFFFFF",
      },
      fontFamily: {
        sans: [
          "-apple-system", "BlinkMacSystemFont", "PingFang SC",
          "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei", "Noto Sans SC",
          "sans-serif",
        ],
      },
      borderRadius: { card: "20px", field: "12px" },
      boxShadow: {
        // 卡片用暖调中性阴影（原来是纯黑，压在暖白底上发灰）
        card: "0 1px 2px rgba(26,21,18,.05), 0 12px 30px rgba(26,21,18,.08)",
        // 主按钮的柔光；亮粉色影会显得廉价，改成克制的酒红光
        brand: "0 6px 18px rgba(163,46,78,.26)",
        gold: "0 6px 18px rgba(168,118,62,.22)",
        sheet: "0 -8px 40px rgba(27,22,20,.14)",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(.22,1,.36,1)",
      },
      keyframes: {
        "sheet-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
      },
      animation: {
        "sheet-up": "sheet-up .28s cubic-bezier(.22,1,.36,1)",
        "fade-in": "fade-in .2s ease-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
