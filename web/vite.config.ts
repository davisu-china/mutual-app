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
  server: { port: 5173 },
});
