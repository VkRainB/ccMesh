import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { CursorCategory } from "@/services/modules/cursorUsage";

import { topModels } from "./cursorUsage";

const chartConfig = {
  weight: { label: "金额", color: "var(--primary)" },
} satisfies ChartConfig;

export function ModelTopBar({ categories }: { categories: CursorCategory[] }) {
  const top = topModels(categories, 10).slice().reverse();
  return (
    <Card className="py-4">
      <CardContent className="px-4">
        <h3 className="mb-2 text-xs text-ink-secondary">分模型消耗 TOP10</h3>
        <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
          <BarChart data={top} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="model"
              width={140}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(v) => `$${(Number(v) / 100).toFixed(2)}`}
                />
              }
            />
            <Bar dataKey="weight" fill="var(--color-weight)" radius={[0, 4, 4, 0]} barSize={12} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
