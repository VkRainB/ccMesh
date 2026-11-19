import { TabularText } from "@/components/ui";
import { formatTokenMetric } from "@/lib/format";
import type { EndpointStat, ModelRequestStat } from "@/services/modules/stats";

interface Props {
  rows: EndpointStat[];
  /** 同一时间范围内、按端点拆开的模型用量。有明细时不再显示端点合计。 */
  models?: ModelRequestStat[];
}

interface Line {
  key: string;
  model: string;
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost: string;
}

function modelsByEndpoint(models: ModelRequestStat[]): Map<string, ModelRequestStat[]> {
  const map = new Map<string, ModelRequestStat[]>();
  for (const item of models) {
    const list = map.get(item.endpointName) ?? [];
    list.push(item);
    map.set(item.endpointName, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => b.requests - a.requests || a.model.localeCompare(b.model, "zh"));
  }
  return map;
}

function costText(pricedRequests: number, pricedCost: string): string {
  return pricedRequests > 0 ? pricedCost : "—";
}

function fromModel(m: ModelRequestStat): Line {
  return {
    key: m.model,
    model: m.model,
    requests: m.requests,
    errors: m.errors,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cacheReadTokens: m.cacheReadTokens,
    cost: costText(m.pricedRequests, m.pricedCost),
  };
}

function fromEndpoint(r: EndpointStat): Line {
  return {
    key: "total",
    model: "",
    requests: r.requests,
    errors: r.errors,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheReadTokens: r.cacheReadTokens,
    cost: costText(r.pricedRequests, r.pricedCost),
  };
}

/** 每端点一行组。能按模型拆开时只显示模型行，各列都是该模型自己的用量。 */
export function EndpointStatsTable({ rows, models = [] }: Props) {
  const byEndpoint = modelsByEndpoint(models);
  const showModel = byEndpoint.size > 0;
  if (rows.length === 0) {
    return <p className="text-sm text-ink-mute">该周期暂无数据</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-edge">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-edge text-xs text-ink-secondary">
            <th className="px-4 py-2 text-left font-medium">端点</th>
            {showModel && <th className="px-4 py-2 text-left font-medium">模型</th>}
            <th className="px-4 py-2 text-right font-medium">请求</th>
            <th className="px-4 py-2 text-right font-medium">错误</th>
            <th className="px-4 py-2 text-right font-medium">输入 Token</th>
            <th className="px-4 py-2 text-right font-medium">输出 Token</th>
            <th className="px-4 py-2 text-right font-medium">缓存读取</th>
            <th className="px-4 py-2 text-right font-medium">已计价成本（USD）</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const detail = byEndpoint.get(r.endpointName) ?? [];
            const lines = detail.length > 0 ? detail.map(fromModel) : [fromEndpoint(r)];
            return lines.map((line, index) => (
              <tr
                key={`${r.endpointName}-${line.key}`}
                className={index === lines.length - 1 ? "border-b border-edge-subtle last:border-0" : undefined}
              >
                {index === 0 && (
                  <td rowSpan={lines.length} className="px-4 py-2 align-top">
                    {r.endpointName}
                  </td>
                )}
                {showModel && <td className="px-4 py-2">{line.model}</td>}
                <td className="px-4 py-2 text-right"><TabularText>{line.requests}</TabularText></td>
                <td className="px-4 py-2 text-right"><TabularText>{line.errors}</TabularText></td>
                <td className="px-4 py-2 text-right" title={line.inputTokens.toLocaleString()}>
                  <TabularText>{formatTokenMetric(line.inputTokens)}</TabularText>
                </td>
                <td className="px-4 py-2 text-right" title={line.outputTokens.toLocaleString()}>
                  <TabularText>{formatTokenMetric(line.outputTokens)}</TabularText>
                </td>
                <td className="px-4 py-2 text-right" title={line.cacheReadTokens.toLocaleString()}>
                  <TabularText>{formatTokenMetric(line.cacheReadTokens)}</TabularText>
                </td>
                <td className="px-4 py-2 text-right"><TabularText>{line.cost}</TabularText></td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}
