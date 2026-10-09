import type { Config } from "tailwindcss";

/**
 * 设计令牌 —— 与《技术方案 4.1 色彩》一一对应。
 * 所有颜色都从这里取，组件里不写死色值。
 * 整体走暖调：底色偏暖白、文字带一丝红调的墨色、主色是胭脂红。
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#E4596B",
          dark: "#C9435A",
          soft: "#FDEEF1",
          line: "#F7DDE2",
        },
        ink: { DEFAULT: "#1C1618", 2: "#3D3739" },
        muted: { DEFAULT: "#6B6366", 2: "#9A9296" },
        line: { DEFAULT: "#E2DDE0", soft: "#EDE9EB" },
        paper: "#FAF8F9",
        surface: "#FFFFFF",
      },
      fontFamily: {
        sans: [
          "-apple-system", "BlinkMacSystemFont", "PingFang SC",
          "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei", "Noto Sans SC",
          "sans-serif",
        ],
      },
      borderRadius: { card: "18px", field: "10px" },
      boxShadow: {
        card: "0 2px 8px rgba(28,22,24,.06), 0 12px 30px rgba(28,22,24,.10)",
        brand: "0 6px 18px rgba(228,89,107,.32)",
        sheet: "0 -8px 40px rgba(28,22,24,.16)",
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
