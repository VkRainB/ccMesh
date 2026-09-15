import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { CursorHourlyPoint } from "@/services/modules/cursorUsage";

import { hourlyStackSeries } from "./cursorUsage";

const PALETTE = [
  "var(--primary)",
  "var(--info)",
  "var(--warning)",
  "var(--destructive)",
  "var(--primary-soft)",
  "var(--ink-secondary)",
];

export function HourlyStackChart({ data }: { data: CursorHourlyPoint[] }) {
  if (!data.some((h) => h.events > 0)) return null;
  const { rows, keys } = hourlyStackSeries(data);
  const chartConfig = Object.fromEntries(
    keys.map((k, i) => [k, { label: k, color: PALETTE[i % PALETTE.length] }]),
  ) satisfies ChartConfig;
  return (
    <section className="rounded-lg border border-edge p-4">
      <h2 className="mb-2 text-sm font-medium text-ink-secondary">今日逐小时分布</h2>
      <ChartContainer config={chartConfig} className="aspect-auto h-48 w-full">
        <BarChart data={rows} margin={{ left: 4, right: 12 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(v: number) => `$${(v / 100).toFixed(0)}`}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(v) => `$${(Number(v) / 100).toFixed(2)}`}
              />
            }
          />
          {keys.map((k, i) => (
            <Bar key={k} dataKey={k} stackId="a" fill={PALETTE[i % PALETTE.length]} barSize={18} />
          ))}
        </BarChart>
      </ChartContainer>
    </section>
  );
}
