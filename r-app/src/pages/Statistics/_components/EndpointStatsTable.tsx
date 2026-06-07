import { TabularText } from "@/components/ui";
import type { EndpointStat } from "@/services/modules/stats";

interface Props {
  rows: EndpointStat[];
}

/** 每端点统计明细表。 */
export function EndpointStatsTable({ rows }: Props) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-mute">该周期暂无数据</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-edge">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-edge text-xs text-ink-secondary">
            <th className="px-4 py-2 text-left font-medium">端点</th>
            <th className="px-4 py-2 text-right font-medium">请求</th>
            <th className="px-4 py-2 text-right font-medium">错误</th>
            <th className="px-4 py-2 text-right font-medium">输入 Token</th>
            <th className="px-4 py-2 text-right font-medium">输出 Token</th>
            <th className="px-4 py-2 text-right font-medium">缓存创建</th>
            <th className="px-4 py-2 text-right font-medium">缓存读取</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.endpointName}
              className="border-b border-edge-subtle last:border-0"
            >
              <td className="px-4 py-2">{r.endpointName}</td>
              <td className="px-4 py-2 text-right">
                <TabularText>{r.requests}</TabularText>
              </td>
              <td className="px-4 py-2 text-right">
                <TabularText>{r.errors}</TabularText>
              </td>
              <td className="px-4 py-2 text-right">
                <TabularText>{r.inputTokens}</TabularText>
              </td>
              <td className="px-4 py-2 text-right">
                <TabularText>{r.outputTokens}</TabularText>
              </td>
              <td className="px-4 py-2 text-right">
                <TabularText>{r.cacheCreationTokens}</TabularText>
              </td>
              <td className="px-4 py-2 text-right">
                <TabularText>{r.cacheReadTokens}</TabularText>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
