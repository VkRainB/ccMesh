import { invoke } from "@tauri-apps/api/core";
import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * 统一调用后端命令。约定：命令名 snake_case，参数键 camelCase（Tauri 自动转换）。
 * 后端 AppError 已序列化为字符串，这里归一为 Error 抛出，供 TanStack Query / try-catch 处理。
 */
export async function request<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    const message =
      typeof e === "string"
        ? e
        : e instanceof Error
          ? e.message
          : JSON.stringify(e);
    throw new Error(message);
  }
}

/** 订阅后端事件，返回取消订阅函数。事件名 kebab-case。 */
export function subscribe<T>(
  event: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  return listen<T>(event, handler);
}

/** 后端事件名常量（kebab-case），随阶段补充。 */
export const Events = {
  statsUpdated: "stats-updated",
  requestLogged: "request-logged",
  proxyStatusChanged: "proxy-status-changed",
  endpointHealthChanged: "endpoint-health-changed",
  endpointsChanged: "endpoints-changed",
  logLine: "log-line",
  updateProgress: "update-progress",
  chatChunk: "chat-chunk",
  chatDone: "chat-done",
  chatError: "chat-error",
} as const;
