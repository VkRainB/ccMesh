/**
 * 纯浏览器（`npm run dev` / `vite preview`）没有 WebView 注入。
 * `tauri dev` 和打包 exe 会在任何页面脚本之前写入真的 __TAURI_INTERNALS__，
 * 这里检测到已有注入就立刻返回，不会覆盖真 IPC。
 *
 * 不要用 TAURI_ENV_* 判断：`tauri dev` 的 Vite 进程也带这些变量，
 * 但页面仍然由 WebView 加载、自带真注入；用 env 会误伤。
 */
if (typeof window !== "undefined" && !window.__TAURI_INTERNALS__) {
  let cbId = 1;
  window.__TAURI_INTERNALS__ = {
    invoke: (cmd: string) => {
      if (cmd === "plugin:event|listen") return Promise.resolve(0);
      if (cmd.startsWith("plugin:event|")) return Promise.resolve();
      if (cmd.startsWith("plugin:window|")) {
        if (cmd.includes("is_")) return Promise.resolve(false);
        return Promise.resolve();
      }
      if (cmd === "plugin:app|version" || cmd === "plugin:app|name") {
        return Promise.resolve("browser");
      }
      return Promise.reject(new Error(`browser-mock: ${cmd}`));
    },
    transformCallback: () => cbId++,
    unregisterCallback: () => {},
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    convertFileSrc: (p: string) => p,
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: () => {},
  };
}
