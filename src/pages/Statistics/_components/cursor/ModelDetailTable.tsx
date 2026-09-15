import { TabularText } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { getModelIcon } from "@/lib/model-icons";
import type { CursorCategory } from "@/services/modules/cursorUsage";

import { fmtTok, fmtUsd } from "./cursorUsage";

export function ModelDetailTable({ categories }: { categories: CursorCategory[] }) {
  const rows = categories.flatMap((c) =>
    c.models.map((m) => ({ ...m, cat: c.label, isApi: c.id === "api" })),
  );
  if (!rows.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-ink-secondary">分模型明细（本计费周期）</h2>
      <div className="overflow-hidden rounded-lg border border-edge">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-edge text-xs text-ink-secondary">
              <th className="px-3 py-2 text-left font-medium">模型</th>
              <th className="px-3 py-2 text-left font-medium">类别</th>
              <th className="px-3 py-2 text-right font-medium">次数</th>
              <th className="px-3 py-2 text-right font-medium">Tokens</th>
              <th className="px-3 py-2 text-right font-medium">金额</th>
              <th className="px-3 py-2 text-right font-medium">类别内占比</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const Icon = getModelIcon(r.model);
              return (
                <tr key={`${r.model}-${i}`} className="border-t border-edge-subtle">
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon size={14} className="shrink-0" />
                      {r.model}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={r.isApi ? "success" : "info"}>{r.cat}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <TabularText>{r.events.toLocaleString()}</TabularText>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <TabularText>{fmtTok(r.tokens)}</TabularText>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <TabularText>{fmtUsd(r.weight)}</TabularText>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <TabularText>{r.usagePct}%</TabularText>
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
