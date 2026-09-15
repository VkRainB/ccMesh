import { useMemo } from "react";
import type { EChartsOption } from "echarts";

import { Card, CardContent } from "@/components/ui/card";
import { EChart, useChartTokens } from "@/components/ui/chart";
import type { CursorCategory } from "@/services/modules/cursorUsage";

import { fmtUsd, topModels } from "./cursorUsage";

export function ModelTopBar({ categories }: { categories: CursorCategory[] }) {
  const t = useChartTokens();
  const option = useMemo<EChartsOption>(() => {
    const top = topModels(categories, 10).slice().reverse();
    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (ps) => {
          const x = (Array.isArray(ps) ? ps : [ps])[0];
          if (!x) return "";
          return `${x.name}<br/>金额 ${fmtUsd(Number(x.data))}`;
        },
      },
      grid: { left: 8, right: 36, top: 10, bottom: 10, containLabel: true },
      xAxis: {
        type: "value",
        axisLabel: {
          color: t["ink-secondary"],
          formatter: (v: number) => `$${(v / 100).toFixed(0)}`,
        },
        splitLine: { lineStyle: { color: t["edge-strong"] } },
      },
      yAxis: {
        type: "category",
        data: top.map((r) => r.model),
        axisLabel: {
          color: t["ink-primary"],
          fontSize: 11,
          width: 180,
          overflow: "truncate",
        },
      },
      series: [
        {
          type: "bar",
          data: top.map((r) => r.weight),
          barMaxWidth: 16,
          itemStyle: { color: t["primary-soft"], borderRadius: [0, 4, 4, 0] },
          label: {
            show: true,
            position: "right",
            color: t["ink-secondary"],
            fontSize: 11,
            formatter: (p) => `$${(Number(p.value) / 100).toFixed(2)}`,
          },
        },
      ],
    };
  }, [categories, t]);
  return (
    <Card className="py-4">
      <CardContent className="px-4">
        <h3 className="mb-1 text-xs text-ink-secondary">分模型消耗 TOP10（按金额 $）</h3>
        <div className="h-56 w-full">
          <EChart option={option} />
        </div>
      </CardContent>
    </Card>
  );
}
