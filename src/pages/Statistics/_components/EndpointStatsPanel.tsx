import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { RequestMonitor } from "@/components/business/RequestMonitor";
import { DateRangePicker, StatCard } from "@/components/business";
import type { RangePreset } from "@/components/business/DateRangePicker";
import { useStats } from "@/hooks/useStats";
import { rangeValueEquals, startOfTodayMs, ymd, type RangeValue } from "@/lib/range";
import {
  statsApi,
  type DailyStat,
  type EndpointStat,
  type PeriodStats,
} from "@/services/modules/stats";
import { EndpointStatsTable } from "./EndpointStatsTable";
import { HistoryDialog } from "./HistoryDialog";
import { TrendBadge } from "./TrendBadge";
import { UsageHeatmap } from "./UsageHeatmap";
import { UsageTrendChart } from "./UsageTrendChart";
import { mergeByDate, sliceTrend } from "./usageChart";

const PERIODS = [
  { key: "today", label: "今日" },
  { key: "yesterday", label: "昨日" },
  { key: "thisWeek", label: "本周" },
  { key: "thisMonth", label: "本月" },
] as const;

type PeriodKey = (typeof PERIODS)[number]["key"];

const DAY_MS = 86_400_000;

/** 日期选择器快捷项：四个周期（点击即生效，命中时统计卡走 get_stats 的实时聚合）。 */
const PERIOD_PRESETS: RangePreset[] = PERIODS.map((p) => ({
  key: p.key,
  label: p.label,
  value: (todayStartMs) => periodRange(p.key, todayStartMs),
}));

/** 周期 Tab → 趋势图日期区间（周一为一周起点，与后端周聚合一致）。 */
export function periodRange(period: PeriodKey, todayStartMs: number): RangeValue {
  switch (period) {
    case "today":
      return { kind: "preset", key: "today" };
    case "yesterday": {
      const y = todayStartMs - DAY_MS;
      return { kind: "custom", startMs: y, endMs: y };
    }
    case "thisWeek": {
      const dow = (new Date(todayStartMs).getDay() + 6) % 7;
      return { kind: "custom", startMs: todayStartMs - dow * DAY_MS, endMs: todayStartMs };
    }
    case "thisMonth": {
      const d = new Date(todayStartMs);
      return {
        kind: "custom",
        startMs: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
        endMs: todayStartMs,
      };
    }
  }
}

/** 按日期区间（YYYY-MM-DD 闭区间）从历史行聚合出周期统计（自定义范围用，天粒度）。 */
export function aggregateRange(
  rows: DailyStat[],
  startDate: string,
  endDate: string,
): PeriodStats {
  const totals: PeriodStats = {
    requests: 0,
    errors: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    endpoints: [],
  };
  const byEndpoint = new Map<string, EndpointStat>();
  for (const r of rows) {
    if (r.date < startDate || r.date > endDate) continue;
    totals.requests += r.requests;
    totals.errors += r.errors;
    totals.inputTokens += r.inputTokens;
    totals.outputTokens += r.outputTokens;
    totals.cacheCreationTokens += r.cacheCreationTokens;
    totals.cacheReadTokens += r.cacheReadTokens;
    const ep = byEndpoint.get(r.endpointName) ?? {
      endpointName: r.endpointName,
      requests: 0,
      errors: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
    ep.requests += r.requests;
    ep.errors += r.errors;
    ep.inputTokens += r.inputTokens;
    ep.outputTokens += r.outputTokens;
    ep.cacheCreationTokens += r.cacheCreationTokens;
    ep.cacheReadTokens += r.cacheReadTokens;
    byEndpoint.set(r.endpointName, ep);
  }
  totals.endpoints = [...byEndpoint.values()].sort((a, b) => b.requests - a.requests);
  return totals;
}

/** 端点统计：日期选择器（四周期快捷项 + 自定义区间）+ 历史记录弹窗 + 实时请求监控。 */
export function EndpointStatsPanel() {
  const { data, isLoading } = useStats();
  const [range, setRange] = useState<RangeValue>({ kind: "preset", key: "today" });

  const todayStart = startOfTodayMs();
  // ponytail: 复用分页接口一次拉全（端点×日行数量级为千，无需新命令）；
  // queryKey 带 "stats" 前缀，useStats 的 stats-updated 订阅会一并失效刷新
  const history = useQuery({
    queryKey: ["stats", "history-all"],
    queryFn: () => statsApi.getStatsHistory(1, 100_000),
  });
  const dayTotals = useMemo(
    () => mergeByDate(history.data?.items ?? []),
    [history.data],
  );
  const trendData = useMemo(
    () => sliceTrend(dayTotals, range, todayStart),
    [dayTotals, range, todayStart],
  );

  // 命中四周期快捷项 → 用 get_stats 的实时聚合；自定义区间 → 从历史行按天聚合
  const activePeriod = PERIODS.map((p) => p.key).find((k) =>
    rangeValueEquals(range, periodRange(k, todayStart)),
  );
  const stats: PeriodStats | undefined = useMemo(() => {
    if (activePeriod) return data?.[activePeriod];
    if (range.kind !== "custom") return undefined;
    return aggregateRange(history.data?.items ?? [], ymd(range.startMs), ymd(range.endMs));
  }, [activePeriod, data, history.data, range]);
  const trend = data?.trend;
  const showTrend = activePeriod === "today" && trend;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-end gap-2">
        <DateRangePicker value={range} onChange={setRange} presets={PERIOD_PRESETS} />
        <HistoryDialog />
      </div>

      {isLoading ? (
        <p className="text-sm text-ink-mute">加载中…</p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-4">
            <StatCard
              label="请求"
              value={stats?.requests ?? 0}
              hint={showTrend ? <TrendBadge pct={trend.requestsPct} /> : undefined}
            />
            <StatCard label="错误" value={stats?.errors ?? 0} />
            <StatCard
              label="输入 Token"
              value={stats?.inputTokens ?? 0}
              hint={showTrend ? <TrendBadge pct={trend.inputTokensPct} /> : undefined}
            />
            <StatCard
              label="输出 Token"
              value={stats?.outputTokens ?? 0}
              hint={showTrend ? <TrendBadge pct={trend.outputTokensPct} /> : undefined}
            />
          </div>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-ink-secondary">调用热力图</h2>
            <div className="rounded-lg border border-edge p-4">
              <UsageHeatmap totals={dayTotals} />
            </div>
          </section>

          <section className="rounded-lg border border-edge p-4">
            <UsageTrendChart data={trendData} />
          </section>

          {(stats?.endpoints.length ?? 0) > 0 && (
            <EndpointStatsTable rows={stats?.endpoints ?? []} />
          )}
        </>
      )}

      <RequestMonitor mode="ranged" range={range} hideWhenEmpty />
    </div>
  );
}
