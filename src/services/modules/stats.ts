import type { UnlistenFn } from "@tauri-apps/api/event";

import { Events, request, subscribe } from "../request";

export interface EndpointStat {
  endpointName: string;
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface PeriodStats {
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  endpoints: EndpointStat[];
}

export interface TrendCompare {
  requestsPct: number;
  inputTokensPct: number;
  outputTokensPct: number;
}

export interface StatsOverview {
  today: PeriodStats;
  yesterday: PeriodStats;
  thisWeek: PeriodStats;
  thisMonth: PeriodStats;
  trend: TrendCompare;
}

export interface DailyStat {
  endpointName: string;
  date: string;
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/** 逐条请求明细。事件推送时 id 为 0（尚未落库），列表以 ts 作为 key。 */
export interface RequestLog {
  id: number;
  /** 请求时间（Unix 毫秒，UTC）。 */
  ts: number;
  endpointName: string;
  inboundFormat: string;
  /** 端点 transformer 快照（claude/openai/codex 等）。旧行/未记录为 null，前端回退 inboundFormat。 */
  transformer: string | null;
  upstreamUrl: string;
  /** 真实入站路由路径（如 /v1/messages）。旧行为空串。 */
  inboundPath: string;
  /** 真实出站路由路径（如 /v1/chat/completions）。旧行为空串。 */
  upstreamPath: string;
  statusCode: number | null;
  isError: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  model: string | null;
  durationMs: number | null;
  /** 首字节延迟（毫秒）：流式为首个内容分片到达耗时，缓冲为响应头到达耗时。旧行/无数据为 null。 */
  firstByteMs: number | null;
  /** 实际(出站)模型：映射/锁定改写后与请求模型不同才有值；透传/旧行为 null。 */
  actualModel: string | null;
  /** 错误响应体（仅错误请求，限长写入）。旧行/无响应体为 null。 */
  errorBody: string | null;
}

export interface RequestLogPage {
  items: RequestLog[];
  total: number;
}

export interface StatsHistoryPage {
  items: DailyStat[];
  total: number;
}

/** 按本地小时聚合（跨端点）。`date` 为 `YYYY-MM-DD HH:00`。 */
export interface HourlyStat {
  date: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface RequestLogQuery {
  startMs?: number;
  endMs?: number;
  endpoint?: string;
  page: number;
  pageSize: number;
}

export const statsApi = {
  getStats: () => request<StatsOverview>("get_stats"),
  /** 请求明细分页查询（时间段 + 可选端点过滤）。 */
  getRequestLogs: (q: RequestLogQuery) =>
    request<RequestLogPage>("get_request_logs", {
      startMs: q.startMs,
      endMs: q.endMs,
      endpoint: q.endpoint,
      page: q.page,
      pageSize: q.pageSize,
    }),
  /** 请求明细按本地小时聚合（跨端点求和）。 */
  getRequestLogsHourly: (q: { startMs?: number; endMs?: number }) =>
    request<HourlyStat[]>("get_request_logs_hourly", {
      startMs: q.startMs,
      endMs: q.endMs,
    }),
  /** 请求明细保留天数。 */
  getRetentionDays: () => request<number>("get_retention_days"),
  /** 立即清理超过保留期限的请求明细。 */
  pruneRequestLogs: () => request<number>("prune_request_logs"),
  /** 清空全部请求明细，不影响 daily_stats 聚合统计。 */
  clearRequestLogs: () => request<number>("clear_request_logs"),
  /** 历史记录分页（跨全时间，按端点×日聚合行）。 */
  getStatsHistory: (page: number, pageSize: number) =>
    request<StatsHistoryPage>("get_stats_history", { page, pageSize }),
  /** 删除单端点单日历史记录。 */
  deleteDailyStat: (endpointName: string, date: string) =>
    request<number>("delete_daily_stat", { endpointName, date }),
  /** 删除某一天全部历史记录。 */
  deleteStatsByDate: (date: string) =>
    request<number>("delete_stats_by_date", { date }),
  /** 订阅统计更新事件（零延迟刷新）。 */
  onUpdated: (cb: () => void): Promise<UnlistenFn> =>
    subscribe(Events.statsUpdated, () => cb()),
  /** 订阅单条请求明细事件（实时监控 live 模式追加）。 */
  onRequestLogged: (cb: (log: RequestLog) => void): Promise<UnlistenFn> =>
    subscribe<RequestLog>(Events.requestLogged, (e) => cb(e.payload)),
};
