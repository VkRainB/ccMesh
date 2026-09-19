/**
 * 统计概览：真实消耗与 prompt 侧缓存命中率。
 * 公式见 docs/task-plan/keyQuery/缓存命中率计算公式说明.md §1 / §6。
 * 入参必须是本仓库已归一的互不重叠四桶（input = 净输入，不含 cache）。
 */

export interface TokenBuckets {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export const EMPTY_BUCKETS: TokenBuckets = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
};

/** 四桶合计：真实消耗 Tokens（含输出；命中率分母不含输出）。 */
export function realConsumption(b: TokenBuckets): number {
  return (
    b.inputTokens +
    b.outputTokens +
    b.cacheCreationTokens +
    b.cacheReadTokens
  );
}

/** prompt 侧分母：净输入 + 命中 + 写入。 */
export function cachePromptDenom(b: TokenBuckets): number {
  return b.inputTokens + b.cacheReadTokens + b.cacheCreationTokens;
}

/**
 * token 加权命中率。分母为 0（尚无 prompt）时返回 null，不要展示成 0%。
 * rate = cache_read / (input_net + cache_read + cache_write)
 */
export function cacheHitRate(b: TokenBuckets): number | null {
  const denom = cachePromptDenom(b);
  if (denom <= 0) return null;
  return b.cacheReadTokens / denom;
}

/**
 * 命中率展示：一位小数。接近但不是 100% 时不四舍五入成 100%（dsh formatCacheHitPercent）。
 * null → "—"。
 */
export function formatCacheHitPercent(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  const pct = rate * 100;
  if (pct >= 100) return "100%";
  if (pct <= 0) return "0.0%";
  if (pct >= 99.95) return "99.9%";
  return `${pct.toFixed(1)}%`;
}

/** 昨日对比百分比；previous<=0 无法对比，返回 null（不展示假的 +100%）。 */
export function trendPct(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) {
    return null;
  }
  return ((current - previous) / previous) * 100;
}

export function fromUsageSummary(s: {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
}): TokenBuckets {
  return {
    inputTokens: s.totalInputTokens,
    outputTokens: s.totalOutputTokens,
    cacheCreationTokens: s.totalCacheCreationTokens,
    cacheReadTokens: s.totalCacheReadTokens,
  };
}
