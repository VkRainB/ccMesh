import { request } from "../request";

export interface InterfaceStatus {
  ok: boolean;
  status?: number;
  count?: number;
  error?: string;
  skipped?: boolean;
}

export interface CursorPlanInfo {
  planName: string;
  price: string;
  includedAmountCents: number;
  membershipType?: string;
}

export interface CursorPlanUsage {
  totalSpend: number;
  includedSpend: number;
  bonusSpend: number;
  remaining: number;
  limit: number;
  totalPercentUsed: number;
  apiPercentUsed?: number;
  autoPercentUsed?: number;
}

export interface CursorPeriod {
  cycleStartMs: number;
  cycleEndMs: number;
  displayMessage?: string;
  autoBucketModels: string[];
  planUsage: CursorPlanUsage;
}

export interface CursorMetrics {
  quotaUsedPct: number;
  officialTotalPct: number;
  expectedUsedPct: number;
  overPace: boolean;
  daysLeft: number;
  cycleTotalDays: number;
  dailyBudgetCents: number;
  todayUsedCents: number;
  todayUsedPct: number;
  cycleSpendCents: number;
  cycleBonusCents: number;
  cycleRemainingCents: number;
  cycleUsedCents: number;
  cycleLimitCents: number;
}

export interface CursorModelRow {
  model: string;
  events: number;
  tokens: number;
  weight: number;
  usagePct: number;
}

export interface CursorCategory {
  id: string;
  label: string;
  usagePct: number;
  tokens: number;
  weight: number;
  models: CursorModelRow[];
}

export interface CursorDailyPoint {
  date: string;
  cents: number;
  tokens: number;
  events: number;
}

export interface CursorHourlyModel {
  model: string;
  cents: number;
}

export interface CursorHourlyPoint {
  hour: number;
  label: string;
  cents: number;
  tokens: number;
  events: number;
  models: CursorHourlyModel[];
}

export interface CursorRecentRow {
  time: string;
  model: string;
  tokens: number;
  costCents: number;
}

export interface CursorUsageSnapshot {
  fetchedAt: number;
  email?: string;
  dbPath: string;
  plan: CursorPlanInfo;
  period: CursorPeriod;
  metrics: CursorMetrics;
  categories: CursorCategory[];
  daily: CursorDailyPoint[];
  hourly: CursorHourlyPoint[];
  recent: CursorRecentRow[];
  interfaces: Record<string, InterfaceStatus>;
  warnings: string[];
}

export const cursorUsageApi = {
  get: () => request<CursorUsageSnapshot | null>("get_cursor_usage"),
  refresh: () => request<CursorUsageSnapshot>("refresh_cursor_usage"),
};
