import { TabularText } from "@/components/ui";
import { Card, CardContent } from "@/components/ui/card";
import type { CursorMetrics } from "@/services/modules/cursorUsage";

import { fmtUsd } from "./cursorUsage";

export function TodayBudgetCard({
  metrics,
  todayRequests,
}: {
  metrics: CursorMetrics;
  todayRequests: number;
}) {
  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-2 px-5">
        <span className="text-xs text-ink-secondary">今日已用</span>
        <TabularText className="text-2xl text-info">{fmtUsd(metrics.todayUsedCents)}</TabularText>
        <p className="text-xs text-ink-secondary">
          {todayRequests} 次
          {metrics.dailyBudgetCents > 0
            ? ` · 日预算 ${fmtUsd(metrics.dailyBudgetCents)} · ${metrics.todayUsedPct}%`
            : ""}
        </p>
      </CardContent>
    </Card>
  );
}
