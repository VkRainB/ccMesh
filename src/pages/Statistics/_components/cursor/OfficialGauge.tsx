import { PolarAngleAxis, RadialBar, RadialBarChart } from "recharts";

import { TabularText } from "@/components/ui";
import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import type { CursorMetrics } from "@/services/modules/cursorUsage";

const chartConfig = {
  value: { label: "用量", color: "var(--primary)" },
} satisfies ChartConfig;

export function OfficialGauge({ metrics }: { metrics: CursorMetrics }) {
  const color = metrics.overPace ? "var(--warning)" : "var(--primary)";
  const data = [{ name: "used", value: metrics.officialTotalPct, fill: color }];
  return (
    <Card className="py-4">
      <CardContent className="flex flex-col items-center gap-1 px-4">
        <span className="self-start text-xs text-ink-secondary">官方综合用量</span>
        <ChartContainer config={chartConfig} className="aspect-square h-36 w-full">
          <RadialBarChart
            data={data}
            startAngle={210}
            endAngle={-30}
            innerRadius="72%"
            outerRadius="100%"
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar dataKey="value" background cornerRadius={8} />
          </RadialBarChart>
        </ChartContainer>
        <TabularText className={`text-2xl ${metrics.overPace ? "text-warning" : "text-primary"}`}>
          {metrics.officialTotalPct}%
        </TabularText>
        <span className="text-xs text-ink-mute">
          日均节奏 {metrics.expectedUsedPct}% · {metrics.overPace ? "超前" : "低于日均"}
        </span>
      </CardContent>
    </Card>
  );
}
