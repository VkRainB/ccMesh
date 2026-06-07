import { useState } from "react";

import { RequestMonitor } from "@/components/business/RequestMonitor";
import { StatCard } from "@/components/business";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStats } from "@/hooks/useStats";
import type { PeriodStats } from "@/services/modules/stats";
import { EndpointStatsTable } from "./EndpointStatsTable";
import { HistoryDialog } from "./HistoryDialog";
import { TrendBadge } from "./TrendBadge";

const PERIODS = [
  { key: "today", label: "今日" },
  { key: "yesterday", label: "昨日" },
  { key: "thisWeek", label: "本周" },
  { key: "thisMonth", label: "本月" },
] as const;

type PeriodKey = (typeof PERIODS)[number]["key"];

/** 端点统计：周期聚合（含缓存 token）+ 历史记录弹窗 + 实时请求监控（时间段）。 */
export function EndpointStatsPanel() {
  const { data, isLoading } = useStats();
  const [period, setPeriod] = useState<PeriodKey>("today");

  const stats: PeriodStats | undefined = data?.[period];
  const trend = data?.trend;
  const showTrend = period === "today" && trend;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
          <TabsList>
            {PERIODS.map((p) => (
              <TabsTrigger key={p.key} value={p.key}>
                {p.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
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

          <EndpointStatsTable rows={stats?.endpoints ?? []} />
        </>
      )}

      <RequestMonitor mode="ranged" />
    </div>
  );
}
