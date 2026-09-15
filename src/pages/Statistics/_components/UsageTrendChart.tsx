import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";

import { EChart, useChartTokens } from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TrendPoint } from "./usageChart";

type Metric = "requests" | "tokens";

const METRIC_TABS: { key: Metric; label: string }[] = [
  { key: "requests", label: "次数" },
  { key: "tokens", label: "Tokens" },
];

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** 调用趋势图（跟随面板粒度：≤24h 按小时，否则按天；指标可切换 次数/Tokens）。 */
export function UsageTrendChart({ data }: { data: TrendPoint[] }) {
  const [metric, setMetric] = useState<Metric>("requests");
  const t = useChartTokens();
  const option = useMemo<EChartsOption>(() => {
    const name = metric === "requests" ? "请求次数" : "Tokens";
    return {
      tooltip: {
        trigger: "axis",
        formatter: (ps) => {
          const items = Array.isArray(ps) ? ps : [ps];
          const first = items[0];
          if (!first) return "";
          const row = data[first.dataIndex];
          return `${row?.date ?? first.name}<br/>${first.marker ?? ""}${name}: ${compact.format(Number(first.value))}`;
        },
      },
      grid: { left: 10, right: 14, top: 16, bottom: 10, containLabel: true },
      xAxis: {
        type: "category",
        data: data.map((d) => d.label),
        boundaryGap: false,
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { color: t["ink-secondary"] },
      },
      yAxis: {
        type: "value",
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { color: t["ink-secondary"], formatter: (v: number) => compact.format(v) },
        splitLine: { lineStyle: { color: t["edge-strong"], type: "dashed" } },
      },
      series: [
        {
          type: "line",
          name,
          data: data.map((d) => d[metric]),
          smooth: true,
          symbol: "none",
          lineStyle: { color: t.primary, width: 2 },
          areaStyle: { color: t.primary, opacity: 0.22 },
        },
      ],
    };
  }, [data, metric, t]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink-secondary">调用趋势</h2>
        <Tabs value={metric} onValueChange={(v) => setMetric(v as Metric)}>
          <TabsList variant="line">
            {METRIC_TABS.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="h-56 w-full">
        <EChart option={option} />
      </div>
    </div>
  );
}
