import { MinusIcon } from "lucide-react";

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
  const barColor =
    used >= 100 ? "bg-destructive" : used > 80 ? "bg-warning" : "bg-primary";
  return (
    <Card className="col-span-2 h-full gap-0 py-3">
      <CardContent className="flex h-full flex-col gap-2 px-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="success">{plan.planName || "-"}</Badge>
            {plan.price ? (
              <TabularText className="text-sm text-ink-secondary">{plan.price}</TabularText>
            ) : null}
          </div>
          <p className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-mute">
            {fmtCycleDay(period.cycleStartMs)}
            <MinusIcon className="size-3 opacity-60" />
            {fmtCycleDay(period.cycleEndMs)}
            <span>· 剩余 {metrics.daysLeft} 天</span>
          </p>
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
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div title="套餐额度用完后，Cursor 额外给的免费用量（bonusSpend）">
            <p className="text-xs text-ink-mute">额外赠送</p>
            <TabularText className="text-lg text-foreground">
              {fmtUsd(metrics.cycleBonusCents)}
            </TabularText>
          </div>
          <div className="border-l border-edge pl-4">
            <p className="text-xs text-ink-mute">总消耗</p>
            <TabularText className="text-lg text-foreground">
              {fmtUsd(metrics.cycleSpendCents)}
            </TabularText>
          </div>
        </div>
        {period.displayMessage ? (
          <p className="text-xs text-warning">官方提示：{period.displayMessage}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
