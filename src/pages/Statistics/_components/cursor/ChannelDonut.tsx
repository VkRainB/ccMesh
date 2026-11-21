import { TabularText } from "@/components/ui";
import { Card, CardContent } from "@/components/ui/card";
import type { CursorPlanUsage, CursorUsageAggregation } from "@/services/modules/cursorUsage";

import { estimateChannelUsage, fmtUsd } from "./cursorUsage";

/** 进度条颜色：>=100% 红、>80% 橙、否则用通道主色。 */
function barClass(pct: number, normal: string) {
  if (pct >= 100) return "bg-destructive";
  if (pct > 80) return "bg-warning";
  return normal;
}

function ChannelRow({
  name,
  pct,
  normal,
  usedCents,
  estimatedLimitCents,
}: {
  name: string;
  pct: number;
  normal: string;
  usedCents?: number;
  estimatedLimitCents?: number | null;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink-primary">{name}</span>
        <TabularText className="text-sm text-ink-secondary">{pct.toFixed(1)}%</TabularText>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${barClass(pct, normal)}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      {usedCents != null ? (
        <div className="flex items-baseline justify-between gap-2 text-xs text-ink-mute">
          <span>
            已用{" "}
            <TabularText className="text-ink-secondary">{fmtUsd(usedCents)}</TabularText>
          </span>
          <span>
            预估额度{" "}
            <TabularText className="text-ink-secondary">
              {estimatedLimitCents == null ? "—" : fmtUsd(Math.round(estimatedLimitCents))}
            </TabularText>
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function ChannelDonut({
  planUsage,
  aggregations,
}: {
  planUsage: CursorPlanUsage;
  aggregations?: CursorUsageAggregation[] | null;
}) {
  const api = planUsage.apiPercentUsed ?? 0;
  const auto = planUsage.autoPercentUsed ?? 0;
  const est = estimateChannelUsage(aggregations, planUsage);
  return (
    <Card className="h-full gap-0 py-4">
      <CardContent className="flex h-full flex-col justify-center px-4">
        <h3 className="mb-3 text-xs text-ink-secondary">通道用量进度</h3>
        <div className="flex flex-col gap-4">
          <ChannelRow
            name="Auto + Composer"
            pct={auto}
            normal="bg-info"
            usedCents={est?.autoUsedCents}
            estimatedLimitCents={est?.autoEstimatedLimitCents}
          />
          <ChannelRow
            name="API 通道"
            pct={api}
            normal="bg-primary"
            usedCents={est?.apiUsedCents}
            estimatedLimitCents={est?.apiEstimatedLimitCents}
          />
        </div>
      </CardContent>
    </Card>
  );
}
