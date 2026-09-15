import { TabularText } from "@/components/ui";
import type { CursorUsageSnapshot } from "@/services/modules/cursorUsage";

export function DiagnosticsSection({ snapshot }: { snapshot: CursorUsageSnapshot }) {
  const entries = Object.entries(snapshot.interfaces ?? {});
  return (
    <details className="rounded-lg border border-edge p-4 text-sm">
      <summary className="cursor-pointer text-ink-secondary">诊断（接口状态 / 原始 JSON）</summary>
      <div className="mt-3 overflow-hidden rounded-md border border-edge">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-edge text-xs text-ink-secondary">
              <th className="px-3 py-2 text-left font-medium">接口</th>
              <th className="px-3 py-2 text-left font-medium">状态</th>
              <th className="px-3 py-2 text-right font-medium">HTTP</th>
              <th className="px-3 py-2 text-right font-medium">条数</th>
              <th className="px-3 py-2 text-left font-medium">备注</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([name, v]) => (
              <tr key={name} className="border-t border-edge-subtle">
                <td className="px-3 py-2">{name}</td>
                <td className="px-3 py-2">
                  {v.skipped ? (
                    <span className="text-ink-mute">SKIP</span>
                  ) : v.ok ? (
                    <span className="text-primary">OK</span>
                  ) : (
                    <span className="text-destructive">FAIL</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <TabularText>{v.status ?? "-"}</TabularText>
                </td>
                <td className="px-3 py-2 text-right">
                  <TabularText>{v.count ?? "-"}</TabularText>
                </td>
                <td className="px-3 py-2 text-ink-secondary">{v.error || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <pre className="mt-3 max-h-80 overflow-auto rounded-md border border-edge bg-surface-raised p-3 text-xs">
        {JSON.stringify(snapshot, null, 2)}
      </pre>
    </details>
  );
}
