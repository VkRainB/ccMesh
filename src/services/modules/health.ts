import type { UnlistenFn } from "@tauri-apps/api/event";

import { Events, request, subscribe } from "../request";

export interface MaskedEndpoint {
  name: string;
  apiUrl: string;
  maskedKey: string;
  enabled: boolean;
  testStatus: string;
}

export interface HealthInfo {
  status: string;
  deviceId: string;
  proxyRunning: boolean;
  enabledEndpoints: number;
  endpoints: MaskedEndpoint[];
}

export type CircuitState = "closed" | "open" | "halfOpen";

/** 端点实时健康/熔断态（`get_endpoint_health` 返回，`endpoint-health-changed` 事件触发刷新）。 */
export interface EndpointHealth {
  name: string;
  /** healthy | unhealthy | recovering */
  status: string;
  circuit: CircuitState;
  consecutiveFailures: number;
  successRate: number;
  lastError: string | null;
  lastFailureMs: number | null;
  /** 仅 open：冷却剩余毫秒；到期仍 open（惰性半开）为 0。closed / halfOpen 为 null。 */
  cooldownRemainingMs: number | null;
}

/** 快照剩余毫秒减去本地流逝；非 Open 或无快照返回 0。 */
export function circuitRemainingMs(
  remainingMs: number | null | undefined,
  receivedAt: number,
  now: number = Date.now(),
): number {
  if (remainingMs == null) return 0;
  return Math.max(0, remainingMs - (now - receivedAt));
}

/** 熔断徽章文案：open 倒计时 / 到期待探测；halfOpen 恢复中。 */
export function circuitBadgeLabel(
  circuit: CircuitState,
  remainingMs: number | null | undefined,
  receivedAt: number,
  now: number = Date.now(),
): string {
  if (circuit === "halfOpen") return "恢复中";
  if (circuit !== "open") return "";
  const left = circuitRemainingMs(remainingMs, receivedAt, now);
  if (left <= 0) return "待探测";
  return `熔断中 ${Math.ceil(left / 1000)}s`;
}

/** 熔断态 → 状态点颜色：open 危险、halfOpen 警告、closed 正常。 */
export function circuitDot(
  circuit: CircuitState,
): "success" | "warning" | "danger" {
  if (circuit === "open") return "danger";
  if (circuit === "halfOpen") return "warning";
  return "success";
}

export const healthApi = {
  getHealth: () => request<HealthInfo>("get_health"),
  /** 端点实时健康/熔断态。 */
  getEndpointHealth: () => request<EndpointHealth[]>("get_endpoint_health"),
  /** 订阅熔断状态变化事件（收到后重新拉取 getEndpointHealth）。 */
  onHealthChanged: (cb: () => void): Promise<UnlistenFn> =>
    subscribe(Events.endpointHealthChanged, () => cb()),
};
