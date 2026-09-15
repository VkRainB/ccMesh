import { EyeIcon, EyeOffIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CursorUsageSnapshot } from "@/services/modules/cursorUsage";

import { ChannelDonut } from "./ChannelDonut";
import { DailyTrendChart } from "./DailyTrendChart";
import { DiagnosticsSection } from "./DiagnosticsSection";
import { HourlyStackChart } from "./HourlyStackChart";
import { ModelDetailTable } from "./ModelDetailTable";
import { ModelTopBar } from "./ModelTopBar";
import { OfficialGauge } from "./OfficialGauge";
import { PlanQuotaCard } from "./PlanQuotaCard";
import { RecentRequestsTable } from "./RecentRequestsTable";
import { TodayBudgetCard } from "./TodayBudgetCard";
import { maskEmail } from "./cursorUsage";

export const CURSOR_AUTO_KEY = "ccmesh-cursor-autorefresh";
export const CURSOR_MASK_KEY = "ccmesh-cursor-account-masked";

export function CursorUsageToolbar({
  snapshot,
  refreshing,
  onRefresh,
  autoSec,
  onAutoSec,
  masked,
  onMasked,
  loading,
}: {
  snapshot: CursorUsageSnapshot | null;
  refreshing: boolean;
  onRefresh: () => void;
  autoSec: number;
  onAutoSec: (n: number) => void;
  masked: boolean;
  onMasked: (v: boolean) => void;
  loading: boolean;
}) {
  const email = snapshot?.email || "";
  const age = snapshot?.fetchedAt
    ? Math.max(0, Math.round((Date.now() - snapshot.fetchedAt) / 1000))
    : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-secondary">
        {masked ? maskEmail(email) : email || (loading ? "加载中…" : "未登录")}
        {snapshot?.fetchedAt
          ? ` · ${new Date(snapshot.fetchedAt).toLocaleString()} · ${age}s 前`
          : ""}
      </span>
      <button
        type="button"
        className="text-ink-mute hover:text-foreground"
        title={masked ? "显示完整账号" : "脱密展示账号"}
        onClick={() => onMasked(!masked)}
      >
        {masked ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </button>
      <Select
        value={String(autoSec)}
        onValueChange={(v) => onAutoSec(parseInt(v, 10) || 0)}
      >
        <SelectTrigger size="sm" className="w-28">
          <SelectValue placeholder="自动刷新" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="0">不刷新</SelectItem>
          <SelectItem value="5">5 秒</SelectItem>
          <SelectItem value="60">1 分钟</SelectItem>
          <SelectItem value="300">5 分钟</SelectItem>
          <SelectItem value="1800">30 分钟</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" disabled={refreshing} onClick={onRefresh}>
        <RefreshCwIcon className={refreshing ? "size-4 animate-spin" : "size-4"} />
        刷新
      </Button>
    </div>
  );
}

export function CursorUsagePanel({
  snapshot,
  loading,
  error,
  refreshing,
}: {
  snapshot: CursorUsageSnapshot | null;
  loading: boolean;
  error: Error | null;
  refreshing: boolean;
}) {
  if (loading && !snapshot) {
    return <p className="py-16 text-center text-sm text-ink-secondary">正在读取用量快照…</p>;
  }
  if (error && !snapshot) {
    return <p className="py-16 text-center text-sm text-destructive">{error.message}</p>;
  }
  if (!snapshot) {
    return (
      <p className="py-16 text-center text-sm text-ink-secondary">
        {refreshing ? "正在查询 Cursor 官方接口…" : "暂无快照。请确认已登录 Cursor 后点击刷新。"}
      </p>
    );
  }

  const today = snapshot.hourly.reduce(
    (s, h) => ({ requests: s.requests + h.events, tokens: s.tokens + h.tokens }),
    { requests: 0, tokens: 0 },
  );

  return (
    <div className="flex flex-col gap-6">
      {snapshot.warnings.length > 0 ? (
        <p className="text-sm text-warning">{snapshot.warnings.join(" · ")}</p>
      ) : null}

      <div className="grid grid-cols-4 gap-4">
        <PlanQuotaCard
          plan={snapshot.plan}
          period={snapshot.period}
          metrics={snapshot.metrics}
        />
        <OfficialGauge metrics={snapshot.metrics} />
        <TodayBudgetCard
          cents={snapshot.metrics.todayUsedCents}
          requests={today.requests}
          tokens={today.tokens}
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <ChannelDonut planUsage={snapshot.period.planUsage} />
        <div className="col-span-2">
          <ModelTopBar categories={snapshot.categories} />
        </div>
      </div>

      <DailyTrendChart data={snapshot.daily} />
      <HourlyStackChart data={snapshot.hourly} />
      <RecentRequestsTable rows={snapshot.recent} />
      <ModelDetailTable categories={snapshot.categories} />
      <DiagnosticsSection snapshot={snapshot} />
    </div>
  );
}
