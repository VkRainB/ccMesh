import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { StatCard, TokenHint } from "@/components/business";
import { TabularText } from "@/components/ui";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RANGE_OPTIONS, rangeDates, startOfTodayMs, type RangeKey } from "@/lib/range";
import {
  usageApi,
  type DailyUsage,
  type ModelUsage,
  type UsageAppFilter,
} from "@/services/modules/usage";

const APP_TABS: { key: UsageAppFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "claude", label: "Claude Code" },
  { key: "codex", label: "Codex" },
];

const fmt = (n: number) => n.toLocaleString();

function appLabel(app: string): string {
  if (app === "claude") return "Claude Code";
  if (app === "codex") return "Codex";
  return app;
}

/** 用量统计（MVP）：读取本机 Claude Code / Codex 会话日志，按 app/模型/天汇总 token。 */
export function UsagePanel() {
  const qc = useQueryClient();
  const [app, setApp] = useState<UsageAppFilter>("all");
  const appType = app === "all" ? undefined : app;
  const [range, setRange] = useState<RangeKey>("today");
  // 按天对齐锚点，使 start/end 在同一筛选条件下稳定（不把 Date.now() 放进 queryKey）。
  const todayStart = startOfTodayMs();
  const { start, end } = useMemo(
    () => rangeDates(range, todayStart),
    [range, todayStart],
  );

  const sync = useMutation({
    mutationFn: () => usageApi.sync(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["usage"] });
      if (r.imported > 0) toast.success(`已同步 ${r.imported} 条用量记录`);
    },
    onError: (e) =>
      toast.error(`同步失败：${e instanceof Error ? e.message : String(e)}`),
  });

  // 进入面板自动同步一次
  useEffect(() => {
    sync.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = useQuery({
    queryKey: ["usage", "summary", app, start ?? null, end ?? null],
    queryFn: () => usageApi.getSummary({ appType, start, end }),
  });
  const byModel = useQuery({
    queryKey: ["usage", "model", app, start ?? null, end ?? null],
    queryFn: () => usageApi.getByModel({ appType, start, end }),
  });
  const byDay = useQuery({
    queryKey: ["usage", "day", app, start ?? null, end ?? null],
    queryFn: () => usageApi.getByDay({ appType, start, end }),
  });

  const s = summary.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <Tabs value={app} onValueChange={(v) => setApp(v as UsageAppFilter)}>
          <TabsList variant="line">
            {APP_TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={sync.isPending}
            onClick={() => sync.mutate()}
          >
            <RefreshCwIcon className={sync.isPending ? "size-4 animate-spin" : "size-4"} />
            刷新
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="请求数" value={fmt(s?.totalRequests ?? 0)} />
        <StatCard
          label="输入 Token"
          value={fmt(s?.totalInputTokens ?? 0)}
          hint={<TokenHint value={s?.totalInputTokens ?? 0} />}
        />
        <StatCard
          label="输出 Token"
          value={fmt(s?.totalOutputTokens ?? 0)}
          hint={<TokenHint value={s?.totalOutputTokens ?? 0} />}
        />
        <StatCard
          label="缓存 Token"
          value={fmt(
            (s?.totalCacheCreationTokens ?? 0) + (s?.totalCacheReadTokens ?? 0),
          )}
          hint={
            <TokenHint
              value={
                (s?.totalCacheCreationTokens ?? 0) +
                (s?.totalCacheReadTokens ?? 0)
              }
            />
          }
        />
      </div>

      <ModelTable rows={byModel.data ?? []} />
      <DayTable rows={byDay.data ?? []} />
    </div>
  );
}

function ModelTable({ rows }: { rows: ModelUsage[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-ink-secondary">按模型</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-mute">暂无用量数据</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-edge">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-xs text-ink-secondary">
                <th className="px-3 py-2 text-left font-medium">来源</th>
                <th className="px-3 py-2 text-left font-medium">模型</th>
                <th className="px-3 py-2 text-right font-medium">请求</th>
                <th className="px-3 py-2 text-right font-medium">输入</th>
                <th className="px-3 py-2 text-right font-medium">输出</th>
                <th className="px-3 py-2 text-right font-medium">缓存</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.appType}-${r.model}-${i}`}
                  className="border-b border-edge-subtle last:border-0"
                >
                  <td className="px-3 py-2 text-ink-secondary">
                    {appLabel(r.appType)}
                  </td>
                  <td className="px-3 py-2">{r.model || "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <TabularText>{fmt(r.requests)}</TabularText>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <TabularText>{fmt(r.inputTokens)}</TabularText>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <TabularText>{fmt(r.outputTokens)}</TabularText>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <TabularText>
                      {fmt(r.cacheCreationTokens + r.cacheReadTokens)}
                    </TabularText>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DayTable({ rows }: { rows: DailyUsage[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-ink-secondary">按天</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-mute">暂无用量数据</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-edge">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-xs text-ink-secondary">
                <th className="px-3 py-2 text-left font-medium">日期</th>
                <th className="px-3 py-2 text-left font-medium">来源</th>
                <th className="px-3 py-2 text-right font-medium">请求</th>
                <th className="px-3 py-2 text-right font-medium">输入</th>
                <th className="px-3 py-2 text-right font-medium">输出</th>
                <th className="px-3 py-2 text-right font-medium">缓存</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.date}-${r.appType}-${i}`}
                  className="border-b border-edge-subtle last:border-0"
                >
                  <td className="px-3 py-2">
                    <TabularText>{r.date}</TabularText>
                  </td>
                  <td className="px-3 py-2 text-ink-secondary">
                    {appLabel(r.appType)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <TabularText>{fmt(r.requests)}</TabularText>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <TabularText>{fmt(r.inputTokens)}</TabularText>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <TabularText>{fmt(r.outputTokens)}</TabularText>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <TabularText>
                      {fmt(r.cacheCreationTokens + r.cacheReadTokens)}
                    </TabularText>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
