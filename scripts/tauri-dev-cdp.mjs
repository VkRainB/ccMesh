#!/usr/bin/env node
// 给 tauri dev 的 WebView 打开 CDP，便于 edge://inspect 或脚本抓控制台。
// 用法: pnpm tauri:dev:cdp
// 端口: CCMESH_CDP_PORT（默认 9229，避开 Chrome/Edge 常用的 9222）

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.CCMESH_CDP_PORT || "9229";
const args = `--remote-debugging-port=${port} --remote-allow-origins=*`;

process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = [
  process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,
  args,
]
  .filter(Boolean)
  .join(" ");
process.env.WEBKIT_INSPECTOR_SERVER = `127.0.0.1:${port}`;

console.log(`[cdp] http://127.0.0.1:${port}/json/list`);
console.log(`[cdp] Edge 打开 edge://inspect → Configure 填 127.0.0.1:${port}`);

const child = spawn(
  "pnpm",
  ["exec", "tauri", "dev", ...process.argv.slice(2)],
  { cwd: root, stdio: "inherit", shell: true, env: process.env },
);
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
