import { useMemo } from "react";
import type { EChartsOption } from "echarts";

import { Card, CardContent } from "@/components/ui/card";
import { EChart, useChartTokens } from "@/components/ui/chart";
import { TabularText } from "@/components/ui";
import type { CursorMetrics } from "@/services/modules/cursorUsage";

export function OfficialGauge({ metrics }: { metrics: CursorMetrics }) {
  const t = useChartTokens();
  const color = metrics.overPace ? t.warning : t.info;
  const pct = Number((metrics.officialTotalPct ?? 0).toFixed(1));
  const option = useMemo<EChartsOption>(
    () => ({
      series: [
        {
          type: "gauge",
          min: 0,
          max: 100,
          startAngle: 210,
          endAngle: -30,
          center: ["50%", "50%"],
          radius: "88%",
          progress: { show: true, width: 12, itemStyle: { color } },
          axisLine: { lineStyle: { width: 12, color: [[1, t["edge-strong"]]] } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          pointer: { show: false },
          anchor: { show: false },
          title: { show: false },
          detail: { show: false },
          data: [{ value: pct }],
        },
      ],
    }),
    [color, pct, t],
  );
  return (
    <Card className="h-full gap-0 py-3">
      <CardContent className="flex h-full flex-col px-4">
        <h3 className="text-xs text-ink-secondary">已用额度</h3>
        <div className="flex min-h-0 flex-1 items-center justify-center py-1">
          <div className="relative mx-auto aspect-square w-full max-w-36">
            <EChart option={option} />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <TabularText
                className={
                  metrics.overPace
                    ? "text-2xl leading-none text-warning"
                    : "text-2xl leading-none text-info"
                }
              >
                {pct}%
              </TabularText>
            </div>
          </div>
        </div>
        <p className="text-center text-xs text-ink-mute">
          建议用量 {metrics.expectedUsedPct}%
        </p>
      </CardContent>
    </Card>
  );
}
