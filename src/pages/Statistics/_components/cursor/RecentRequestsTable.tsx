import { TabularText } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { getModelIcon } from "@/lib/model-icons";
import type { CursorRecentRow } from "@/services/modules/cursorUsage";

import { effortLevel } from "./cursorUsage";

const EFFORT_VARIANT = {
  xhigh: "danger",
  high: "warning",
  medium: "info",
  low: "success",
} as const;

export function RecentRequestsTable({ rows }: { rows: CursorRecentRow[] }) {
  if (!rows.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-ink-secondary">最近请求</h2>
      <div className="max-h-[420px] overflow-auto rounded-lg border border-edge">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-edge text-xs text-ink-secondary">
              <th className="px-3 py-2 text-left font-medium">请求时刻</th>
              <th className="px-3 py-2 text-left font-medium">模型</th>
              <th className="px-3 py-2 text-left font-medium">推理强度</th>
              <th className="px-3 py-2 text-right font-medium">Token 数</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const Icon = getModelIcon(r.model);
              const lv = effortLevel(r.model);
              return (
                <tr key={`${r.time}-${r.model}-${i}`} className="border-t border-edge-subtle">
                  <td className="px-3 py-2">
                    <TabularText>{r.time}</TabularText>
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon size={14} className="shrink-0" />
                      {r.model}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {lv ? (
                      <Badge variant={EFFORT_VARIANT[lv]}>{lv}</Badge>
                    ) : (
                      <span className="text-ink-mute">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <TabularText>{r.tokens.toLocaleString()}</TabularText>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
