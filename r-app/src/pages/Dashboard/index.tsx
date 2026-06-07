import { StatCard, TokenHint } from "@/components/business";
import { RequestMonitor } from "@/components/business/RequestMonitor";
import { useStats } from "@/hooks/useStats";
import { ServiceCard } from "./_components/ServiceCard";

export function Dashboard() {
  const { data } = useStats();
  const today = data?.today;
  const tokens =
    (today?.inputTokens ?? 0) +
    (today?.outputTokens ?? 0) +
    (today?.cacheCreationTokens ?? 0) +
    (today?.cacheReadTokens ?? 0);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="text-[10px] font-medium tracking-[0.06em] text-ink-secondary uppercase">
          Dashboard
        </span>
        <h1 className="text-2xl font-light tracking-tight">仪表盘</h1>
      </header>

      <ServiceCard />

      {/* 今日请求 / 失败 / Token，随 stats-updated 实时更新 */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="请求数（今日）" value={today?.requests ?? 0} />
        <StatCard label="失败数（今日）" value={today?.errors ?? 0} />
        <StatCard
          label="Token（今日）"
          value={tokens.toLocaleString()}
          hint={<TokenHint value={tokens} />}
        />
      </div>

      <RequestMonitor mode="live" pageSize={10} />
    </div>
  );
}
