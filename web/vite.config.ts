import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  // 部署到子路径时通过 VITE_BASE 覆盖（如 /mutual/），
  // 这样预览站可以复用主站 jianjiange.site 的证书，不必新签 DNS
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
  resolve: {
    // ESM 下没有 __dirname，用 import.meta.url 推导路径
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      // 开发时把 /api 转到本地后端，前端代码里不需要写死后端地址。
      // WebSocket 也要走这个代理（ws: true），否则聊天连不上。
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://127.0.0.1:8080",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
