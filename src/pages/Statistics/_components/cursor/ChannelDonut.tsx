import { Cell, Pie, PieChart } from "recharts";

import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { CursorPlanUsage } from "@/services/modules/cursorUsage";

const chartConfig = {
  api: { label: "API", color: "var(--info)" },
  auto: { label: "Auto + Composer", color: "var(--primary)" },
} satisfies ChartConfig;

export function ChannelDonut({ planUsage }: { planUsage: CursorPlanUsage }) {
  const data = [
    { name: "API", key: "api", value: +(planUsage.apiPercentUsed ?? 0).toFixed(1) },
    { name: "Auto + Composer", key: "auto", value: +(planUsage.autoPercentUsed ?? 0).toFixed(1) },
  ];
  return (
    <Card className="py-4">
      <CardContent className="px-4">
        <h3 className="mb-2 text-xs text-ink-secondary">通道占比</h3>
        <ChartContainer config={chartConfig} className="mx-auto aspect-square h-48">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} strokeWidth={2}>
              {data.map((d) => (
                <Cell key={d.key} fill={`var(--color-${d.key})`} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
