import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { CursorDailyPoint } from "@/services/modules/cursorUsage";

const chartConfig = {
  cents: { label: "金额", color: "var(--info)" },
  tokens: { label: "Tokens", color: "var(--primary)" },
} satisfies ChartConfig;

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export function DailyTrendChart({ data }: { data: CursorDailyPoint[] }) {
  const rows = data.map((d) => ({
    ...d,
    label: d.date.slice(5),
  }));
  return (
    <section className="rounded-lg border border-edge p-4">
      <h2 className="mb-2 text-sm font-medium text-ink-secondary">每日消耗趋势</h2>
      <ChartContainer config={chartConfig} className="aspect-auto h-52 w-full">
        <ComposedChart data={rows} margin={{ left: 4, right: 12 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis
            yAxisId="cents"
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(v: number) => `$${(v / 100).toFixed(0)}`}
          />
          <YAxis
            yAxisId="tokens"
            orientation="right"
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(v: number) => compact.format(v)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(v, name) =>
                  name === "cents" ? `$${(Number(v) / 100).toFixed(2)}` : compact.format(Number(v))
                }
              />
            }
          />
          <Bar yAxisId="cents" dataKey="cents" fill="var(--color-cents)" barSize={14} radius={[4, 4, 0, 0]} />
          <Line
            yAxisId="tokens"
            type="monotone"
            dataKey="tokens"
            stroke="var(--color-tokens)"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ChartContainer>
    </section>
  );
}
