import { TabularText } from "@/components/ui";
import { formatTokenMetric } from "@/lib/format";
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
    <div className="overflow-x-auto rounded-lg border border-edge">
      <table className="w-full text-sm">
        <caption className="caption-bottom border-t border-edge px-4 py-2 text-left text-xs text-ink-mute">仅汇总已计价部分；本地估算，非渠道扣款账单。按每周规则估算，不含节假日例外，以渠道账单为准。费用按尝试开始时费率计算，仍按完成日及端点名归组。</caption>
        <thead>
          <tr className="border-b border-edge text-xs text-ink-secondary">
            <th className="px-4 py-2 text-left font-medium">端点</th>
            <th className="px-4 py-2 text-right font-medium">请求</th>
            <th className="px-4 py-2 text-right font-medium">错误</th>
            <th className="px-4 py-2 text-right font-medium">输入 Token</th>
            <th className="px-4 py-2 text-right font-medium">输出 Token</th>
            <th className="px-4 py-2 text-right font-medium">缓存创建</th>
            <th className="px-4 py-2 text-right font-medium">缓存读取</th>
            <th className="px-4 py-2 text-right font-medium">已计价成本（USD）</th>
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
              <td className="px-4 py-2 text-right" title={r.inputTokens.toLocaleString()}>
                <TabularText>{formatTokenMetric(r.inputTokens)}</TabularText>
              </td>
              <td className="px-4 py-2 text-right" title={r.outputTokens.toLocaleString()}>
                <TabularText>{formatTokenMetric(r.outputTokens)}</TabularText>
              </td>
              <td className="px-4 py-2 text-right" title={r.cacheCreationTokens.toLocaleString()}>
                <TabularText>{formatTokenMetric(r.cacheCreationTokens)}</TabularText>
              </td>
              <td className="px-4 py-2 text-right" title={r.cacheReadTokens.toLocaleString()}>
                <TabularText>{formatTokenMetric(r.cacheReadTokens)}</TabularText>
              </td>
              <td className="px-4 py-2 text-right"><TabularText>{r.pricedRequests > 0 ? r.pricedCost : "—"}</TabularText></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
