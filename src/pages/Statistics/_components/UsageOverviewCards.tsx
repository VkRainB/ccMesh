import type { ReactNode } from "react";

import { TabularText } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatTokenMetric } from "@/lib/format";
import {
  cacheHitRate,
  EMPTY_BUCKETS,
  formatCacheHitPercent,
  realConsumption,
  trendPct,
  type TokenBuckets,
} from "@/lib/usageMetrics";
import { cn } from "@/lib/utils";

const METRICS: {
  key: keyof TokenBuckets;
  label: string;
  dotClass: string;
}[] = [
  { key: "inputTokens", label: "输入", dotClass: "bg-success" },
  { key: "outputTokens", label: "输出", dotClass: "bg-info" },
  { key: "cacheCreationTokens", label: "创建缓存", dotClass: "bg-warning" },
  { key: "cacheReadTokens", label: "命中缓存", dotClass: "bg-teal-400" },
];

function YesterdayBadge({ pct }: { pct: number }) {
  const variant = pct > 0 ? "success" : pct < 0 ? "danger" : "muted";
  const sign = pct > 0 ? "+" : "";
  return (
    <Badge variant={variant}>{`较昨日 ${sign}${pct.toFixed(1)}%`}</Badge>
  );
}

function HeroCard({ children }: { children: ReactNode }) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex h-full min-h-[8.5rem] flex-col gap-3 px-5 py-5">
        {children}
      </CardContent>
    </Card>
  );
}

function MiniCard({
  label,
  value,
  exact,
  dotClass,
}: {
  label: string;
  value: string;
  exact: number;
  dotClass?: string;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-2 px-4 py-4">
        <span className="text-xs text-ink-secondary">{label}</span>
        <div className="flex items-center gap-2" title={exact.toLocaleString()}>
          {dotClass ? (
            <span className={cn("inline-block size-2 shrink-0 rounded-full", dotClass)} />
          ) : null}
          <TabularText className="text-2xl text-foreground">{value}</TabularText>
        </div>
      </CardContent>
    </Card>
  );
}

interface Props {
  requests: number;
  buckets?: TokenBuckets;
  yesterdayBuckets?: TokenBuckets;
  showTrend?: boolean;
}

/** 统计概览：真实消耗 + 缓存命中率 + 五张拆分卡。端点统计 / 用量统计共用。 */
export function UsageOverviewCards({
  requests,
  buckets = EMPTY_BUCKETS,
  yesterdayBuckets,
  showTrend = false,
}: Props) {
  const consumed = realConsumption(buckets);
  const rate = cacheHitRate(buckets);
  const ratePct = rate == null ? 0 : Math.min(100, Math.max(0, rate * 100));
  const yesterday = yesterdayBuckets ? realConsumption(yesterdayBuckets) : 0;
  const delta = showTrend ? trendPct(consumed, yesterday) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <HeroCard>
          <span className="text-sm text-ink-secondary">真实消耗 Tokens</span>
          <span title={consumed.toLocaleString()}>
            <TabularText className="text-5xl font-light tracking-tight text-foreground">
              {formatTokenMetric(consumed)}
            </TabularText>
          </span>
          {delta != null ? <YesterdayBadge pct={delta} /> : null}
        </HeroCard>
        <HeroCard>
          <span className="text-sm text-ink-secondary">缓存命中率</span>
          <span title="命中 / (净输入 + 命中 + 写入)">
            <TabularText className="text-5xl font-light tracking-tight text-foreground">
              {formatCacheHitPercent(rate)}
            </TabularText>
          </span>
          <div className="mt-auto h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${ratePct}%` }}
            />
          </div>
        </HeroCard>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <MiniCard
          label="请求数"
          value={requests.toLocaleString()}
          exact={requests}
        />
        {METRICS.map((m) => (
          <MiniCard
            key={m.key}
            label={m.label}
            value={formatTokenMetric(buckets[m.key])}
            exact={buckets[m.key]}
            dotClass={m.dotClass}
          />
        ))}
      </div>
    </div>
  );
}
