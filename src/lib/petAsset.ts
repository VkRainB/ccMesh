import { convertFileSrc } from "@tauri-apps/api/core";

/** 将宠物精灵图绝对路径转为 WebView 可加载 URL。 */
export function petSpritesheetUrl(absPath: string): string {
  return convertFileSrc(absPath);
}
