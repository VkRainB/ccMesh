import { useMemo } from "react";
import type { EChartsOption } from "echarts";

import { EChart, useChartTokens } from "@/components/ui/chart";
import type { CursorHourlyPoint } from "@/services/modules/cursorUsage";

import { fmtTok, fmtUsd, hourlyStackSeries } from "./cursorUsage";

export function HourlyStackChart({ data }: { data: CursorHourlyPoint[] }) {
  const t = useChartTokens();
  const hasEvents = data.some((h) => h.events > 0);
  const option = useMemo<EChartsOption>(() => {
    const { rows, keys } = hourlyStackSeries(data);
    const palette = [
      t["primary-soft"],
      t.info,
      t.primary,
      t.warning,
      t.destructive,
      t["ink-secondary"],
    ];
    return {
      tooltip: {
        trigger: "axis",
        formatter: (ps) => {
          const items = Array.isArray(ps) ? ps : [ps];
          const first = items[0];
          if (!first) return "";
          const row = data[first.dataIndex];
          const lines = items.map(
            (x) => `${x.marker ?? ""}${x.seriesName}: ${fmtUsd(Number(x.value))}`,
          );
          if (row) {
            lines.push(`请求次数: ${row.events} 次`);
            lines.push(`tokens: ${fmtTok(row.tokens)}`);
          }
          return `${first.name}<br/>${lines.join("<br/>")}`;
        },
      },
      legend: {
        top: 0,
        left: 4,
        right: 4,
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 10,
        textStyle: { color: t["ink-secondary"], fontSize: 11 },
      },
      grid: { left: 8, right: 12, top: 68, bottom: 8, containLabel: true },
      xAxis: {
        type: "category",
        data: rows.map((r) => r.label),
        axisLabel: { color: t["ink-secondary"], interval: 0, rotate: 45, fontSize: 10 },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          color: t["ink-secondary"],
          formatter: (v: number) => `$${(v / 100).toFixed(0)}`,
        },
        splitLine: { lineStyle: { color: t["edge-strong"] } },
      },
      series: keys.map((k, i) => ({
        name: k,
        type: "bar" as const,
        stack: "amount",
        barMaxWidth: 18,
        itemStyle: { color: palette[i % palette.length] },
        data: rows.map((r) => Number(r[k] ?? 0)),
      })),
    };
  }, [data, t]);
  if (!hasEvents) return null;
  return (
    <section className="rounded-lg border border-edge p-4">
      <h2 className="mb-2 text-sm font-medium text-ink-secondary">今日用量</h2>
      <div className="h-60 w-full">
        <EChart option={option} />
      </div>
    </section>
  );
}
