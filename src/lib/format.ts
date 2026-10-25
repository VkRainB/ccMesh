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
 * 生成窗口达到此时长才单独当分母。更短的窗口是时钟噪声：
 * 实测里有 1ms 窗口的 32 token 请求，按窗口算会显示 32000 tok/s。
 */
const TPS_MIN_WINDOW_MS = 200;

/**
 * 输出速度（tok/s）。只要有用时和输出就给值，不再因为窗口短而留空。
 * 有首字且生成窗口 ≥ {@link TPS_MIN_WINDOW_MS}：`output / (用时 - 首字)`，精确值。
 * 其余情况（无首字、窗口过短、首字等于结束）按总用时估算并加 `≈`
 * （等首字的时间算进分母，所以偏低）。
 * `outputEstimated` 为真时分子是字符估算，同样加 `≈`。
 * 输出 ≤ 0 或用时缺失 / 无效时返回 null。
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
  // 只有够长的生成窗口才配当分母；窗口为 0（首字等于结束）或短于门槛时退回总用时，
  // 宁可用端到端平均速度也不留空。
  if (firstByteMs != null && Number.isFinite(firstByteMs) && firstByteMs >= 0) {
    const generateMs = durationMs - firstByteMs;
    if (generateMs >= TPS_MIN_WINDOW_MS) {
      const text = perSecond(generateMs);
      return outputEstimated ? `≈${text}` : text;
    }
  }

  return `≈${perSecond(durationMs)}`;
}
