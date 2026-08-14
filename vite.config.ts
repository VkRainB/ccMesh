import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@codemirror") || id.includes("@uiw/react-codemirror"))
            return "editor-vendor";
          if (id.includes("@dnd-kit")) return "dnd-vendor";
          if (id.includes("@tanstack/react-query")) return "query-vendor";
          // ponytail: react 必须和 radix/lucide 同 chunk。拆成 ui-vendor↔react-vendor
          // 会循环初始化，生产包 forwardRef 为 undefined，整窗白屏；dev 不走 manualChunks。
          if (
            id.includes("radix-ui") ||
            id.includes("lucide-react") ||
            id.includes("/react-dom/") ||
            id.includes("/react/") ||
            id.includes("/scheduler/")
          )
            return "react-vendor";
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
