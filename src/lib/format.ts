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

/**
 * 生成窗口短于此时钟误差会把速率放大，不展示。
 * 200ms 能盖住「你好」这种短回复，又挡掉只有下载尾巴的假速度。
 */
const TPS_MIN_WINDOW_MS = 200;

/**
 * 输出速度（tok/s）。
 * 有首字：`output / (用时 - 首字)`，窗口是真正在吐 token 的时间。
 * 没有首字（非流式，或流里没看到可见 token）：按总用时估算，前面加 `≈`
 * （等首字的时间算进分母，所以偏低）。
 * `outputEstimated` 为真时分子是字符估算，同样加 `≈`。
 * 窗口短于 {@link TPS_MIN_WINDOW_MS}、输出 ≤ 0、或生成时间为 0 时不展示。
 */
export function formatOutputTps(
  outputTokens: number,
  durationMs: number | null,
  firstByteMs: number | null,
  outputEstimated = false,
): string | null {
  if (!Number.isFinite(outputTokens) || outputTokens <= 0) return null;
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs <= 0) return null;

  const perSecond = (ms: number) => `${(outputTokens / (ms / 1000)).toFixed(1)} tok/s`;
  // 有首字时间戳时只认生成窗口。窗口为 0（首字等于结束）或短于门槛都不展示，
  // 避免退回总用时把「已经结束的生成」再算一遍。
  if (firstByteMs != null && Number.isFinite(firstByteMs) && firstByteMs >= 0) {
    const generateMs = durationMs - firstByteMs;
    if (generateMs < TPS_MIN_WINDOW_MS) return null;
    const text = perSecond(generateMs);
    return outputEstimated ? `≈${text}` : text;
  }

  if (durationMs < TPS_MIN_WINDOW_MS) return null;
  return `≈${perSecond(durationMs)}`;
}
