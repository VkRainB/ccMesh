/**
 * Token 数量的辅助单位文案：就近取量级，约等号 + 两位小数 + 中文单位。
 * - ≥ 1 亿：`≈1.25亿`
 * - ≥ 1 万：`≈900.00万`
 * - 否则：原始数字（千分位），不加单位与约等号
 *
 * 主数值仍应展示精确值，本函数仅产出"辅助小字"文案。
 * 非有限值按 `"0"` 处理；负数取绝对值折算并保留负号。
 */
export function formatTokenCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${sign}≈${(abs / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${sign}≈${(abs / 1e4).toFixed(2)}万`;
  return n.toLocaleString();
}

/**
 * 统计页 Token 主数值（端点/用量卡片与表格共用）：
 * - ≥ 1 亿：`2.0亿`
 * - ≥ 1 万：`321.0万`
 * - 否则：千分位整数
 */
export function formatTokenMetric(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}亿`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(1)}万`;
  return `${sign}${Math.round(abs).toLocaleString()}`;
}

/**
 * Token 数量紧凑展示（千位 k 单位）：
 * - |n| ≥ 1000：取整千 → `1k`、`102k`、`110k`
 * - 否则：原始整数
 * 用于悬停明细等空间紧凑处。负数保留符号。
 */
export function formatTokenK(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1000) return `${sign}${Math.round(abs / 1000)}k`;
  return String(Math.round(n));
}

/** 耗时统一按秒展示（两位小数）：`6458ms → 6.46s`。非有限值按 `0.00s`。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "0.00s";
  return `${(ms / 1000).toFixed(2)}s`;
}

/** 有首字计时时，输出少于此值不算速度。 */
const TPS_MIN_OUTPUT = 100;
/** 没有首字、只能按总用时估算时，输出少于此值不算。 */
const TPS_MIN_ESTIMATE_OUTPUT = 200;

/**
 * 输出速度（tok/s），从首字算到结束：`output / (用时 - 首字)`。
 * 有首字且输出 ≥ 100 时给精确值。没有首字、输出 ≥ 200 时按总用时估算并加 `≈`
 * （等首字的时间也算进去，所以偏低）。时间无效或不够门槛时返回 null。
 * ponytail: 思考过程不单独记账，无法区分「思考不外露」的模型，那种请求仍按输出 token 计。
 */
export function formatOutputTps(
  outputTokens: number,
  durationMs: number | null,
  firstByteMs: number | null,
): string | null {
  if (!Number.isFinite(outputTokens) || outputTokens <= 0) return null;
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs <= 0) return null;

  const perSecond = (ms: number) => `${(outputTokens / (ms / 1000)).toFixed(1)} tok/s`;

  if (firstByteMs != null && Number.isFinite(firstByteMs)) {
    if (outputTokens < TPS_MIN_OUTPUT) return null;
    const generateMs = durationMs - firstByteMs;
    if (generateMs <= 0) return null;
    return perSecond(generateMs);
  }

  if (outputTokens < TPS_MIN_ESTIMATE_OUTPUT) return null;
  return `≈${perSecond(durationMs)}`;
}
