import { useMemo } from "react";
import type { EChartsOption } from "echarts";

import { EChart, useChartTokens } from "@/components/ui/chart";
import type { CursorDailyPoint } from "@/services/modules/cursorUsage";

import { fmtTok, fmtUsd } from "./cursorUsage";

export function DailyTrendChart({ data }: { data: CursorDailyPoint[] }) {
  const t = useChartTokens();
  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: {
        trigger: "axis",
        formatter: (ps) => {
          const items = Array.isArray(ps) ? ps : [ps];
          const date = items[0]?.name ? `${items[0].name}<br/>` : "";
          let amount = "";
          let tokens = "";
          for (const x of items) {
            const val = Number(x.value);
            if (x.seriesName === "金额") amount = `${x.marker ?? ""}金额 ${fmtUsd(val)}`;
            else tokens = `${x.marker ?? ""}Token ${fmtTok(val)}`;
          }
          return date + [amount, tokens].filter(Boolean).join("<br/>");
        },
      },
      legend: { top: 0, textStyle: { color: t["ink-secondary"] } },
      grid: { left: 24, right: 36, top: 40, bottom: 16, containLabel: true },
      xAxis: {
        type: "category",
        data: data.map((r) => r.date.slice(5)),
        axisLabel: { color: t["ink-secondary"] },
        boundaryGap: true,
      },
      yAxis: [
        {
          type: "value",
          name: "金额",
          nameGap: 10,
          nameTextStyle: { color: t["ink-secondary"] },
          axisLabel: {
            color: t["ink-secondary"],
            formatter: (v: number) => `$${(v / 100).toFixed(0)}`,
          },
          splitLine: { lineStyle: { color: t["edge-strong"] } },
        },
        {
          type: "value",
          name: "Token",
          nameGap: 10,
          nameTextStyle: { color: t["ink-secondary"] },
          axisLabel: { color: t["ink-secondary"], formatter: (v: number) => fmtTok(v) },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "金额",
          type: "bar",
          yAxisIndex: 0,
          data: data.map((r) => r.cents),
          itemStyle: { color: t.info },
          barMaxWidth: 14,
        },
        {
          name: "Token",
          type: "line",
          yAxisIndex: 1,
          data: data.map((r) => r.tokens),
          smooth: true,
          symbol: "none",
          lineStyle: { color: t.primary },
        },
      ],
    }),
    [data, t],
  );
  return (
    <section className="rounded-lg border border-edge p-4">
      <h2 className="mb-2 text-sm font-medium text-ink-secondary">每日消耗趋势（金额 / tokens）</h2>
      <div className="h-50 w-full">
        <EChart option={option} />
      </div>
    </section>
  );
}
