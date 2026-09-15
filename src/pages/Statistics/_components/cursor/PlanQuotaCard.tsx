import { TabularText } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { CursorMetrics, CursorPlanInfo, CursorPeriod } from "@/services/modules/cursorUsage";

import { fmtCycleDay, fmtUsd } from "./cursorUsage";

export function PlanQuotaCard({
  plan,
  period,
  metrics,
}: {
  plan: CursorPlanInfo;
  period: CursorPeriod;
  metrics: CursorMetrics;
}) {
  const used = metrics.quotaUsedPct;
  const expected = metrics.expectedUsedPct;
  const barColor =
    used >= 100 ? "bg-destructive" : used > 80 ? "bg-warning" : "bg-primary";
  return (
    <Card className="col-span-2 py-4">
      <CardContent className="flex flex-col gap-3 px-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">{plan.planName || "-"}</Badge>
          {plan.price ? (
            <span className="text-xs text-ink-secondary">{plan.price}</span>
          ) : null}
          <span className="text-xs text-ink-mute">
            {fmtCycleDay(period.cycleStartMs)} →{" "}
            {fmtCycleDay(period.cycleEndMs)} · 剩 {metrics.daysLeft}/{metrics.cycleTotalDays} 天
          </span>
        </div>
        <TabularText className="text-2xl text-foreground">
          {fmtUsd(metrics.cycleUsedCents)}
          <span className="text-base text-ink-secondary"> / {fmtUsd(metrics.cycleLimitCents)}</span>
        </TabularText>
        <div className="relative h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={`absolute inset-y-0 left-0 rounded-full ${barColor}`}
            style={{ width: `${Math.min(100, used)}%` }}
          />
          <div
            className="absolute top-0 h-full w-px bg-foreground/50"
            style={{ left: `${Math.min(100, expected)}%` }}
            title={`期望进度 ${expected}%`}
          />
        </div>
        <p className="text-xs text-ink-secondary">
          剩余 {fmtUsd(metrics.cycleRemainingCents)}
          {metrics.cycleBonusCents > 0 ? ` · 赠送已用 ${fmtUsd(metrics.cycleBonusCents)}` : ""}
          {metrics.cycleSpendCents > 0 ? ` · 总消耗 ${fmtUsd(metrics.cycleSpendCents)}` : ""}
          {` · 额度 ${used}%`}
        </p>
      </CardContent>
    </Card>
  );
}
