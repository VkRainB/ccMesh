import { request } from "../request";

export type UsageAppFilter = "all" | "claude" | "codex" | "zcode";

export interface UsageSummary {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
}

/** 按天 × 来源 × 模型聚合（多维合并表：前端按 date 行合并展示）。 */
export interface DayModelUsage {
  date: string;
  appType: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/** 按天 × 来源聚合（热力图/趋势图数据源）。 */
export interface DailyUsage {
  date: string;
  appType: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface UsageSyncResult {
  imported: number;
  filesScanned: number;
  errors: number;
}

interface UsageFilter {
  /** date 闭区间（YYYY-MM-DD，预设周期） */
  start?: string;
  end?: string;
  /** ts 毫秒闭区间（自定义时分范围） */
  startTs?: number;
  endTs?: number;
  appType?: string;
}

const filterArgs = (f: UsageFilter) => ({
  start: f.start,
  end: f.end,
  startTs: f.startTs,
  endTs: f.endTs,
  appType: f.appType,
});

export const usageApi = {
  /** 触发本机用量增量同步。 */
  sync: () => request<UsageSyncResult>("sync_session_usage"),
  getSummary: (f: UsageFilter = {}) =>
    request<UsageSummary>("get_usage_summary", filterArgs(f)),
  /** 按天 × 来源 × 模型聚合（date 倒序、组内 token 降序）。 */
  getByDayModel: (f: UsageFilter = {}) =>
    request<DayModelUsage[]>("get_usage_by_day_model", filterArgs(f)),
  /** 按天 × 来源聚合。 */
  getByDay: (f: UsageFilter = {}) =>
    request<DailyUsage[]>("get_usage_by_day", filterArgs(f)),
  /** 按小时 × 来源聚合。`date` 为 `YYYY-MM-DD HH:00`。 */
  getByHour: (f: UsageFilter = {}) =>
    request<DailyUsage[]>("get_usage_by_hour", filterArgs(f)),
};
