import { useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TrendPoint } from "./usageChart";

type Metric = "requests" | "tokens";

const METRIC_TABS: { key: Metric; label: string }[] = [
  { key: "requests", label: "次数" },
  { key: "tokens", label: "Tokens" },
];

const chartConfig = {
  requests: { label: "请求次数", color: "var(--primary)" },
  tokens: { label: "Tokens", color: "var(--primary)" },
} satisfies ChartConfig;

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** 调用趋势图（跟随面板粒度：≤24h 按小时，否则按天；指标可切换 次数/Tokens）。 */
export function UsageTrendChart({ data }: { data: TrendPoint[] }) {
  const [metric, setMetric] = useState<Metric>("requests");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink-secondary">调用趋势</h2>
        <Tabs value={metric} onValueChange={(v) => setMetric(v as Metric)}>
          <TabsList variant="line">
            {METRIC_TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
        <AreaChart accessibilityLayer data={data} margin={{ left: 4, right: 12 }}>
          <defs>
            <linearGradient id="fillTrend" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={`var(--color-${metric})`} stopOpacity={0.4} />
              <stop offset="95%" stopColor={`var(--color-${metric})`} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(v: number) => compact.format(v)}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                indicator="line"
                labelFormatter={(_, payload) =>
                  (payload?.[0]?.payload as TrendPoint | undefined)?.date ?? ""
                }
              />
            }
          />
          <Area
            type="monotone"
            dataKey={metric}
            stroke={`var(--color-${metric})`}
            strokeWidth={2}
            fill="url(#fillTrend)"
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
