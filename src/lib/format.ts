import { ymd } from "./range";

/** 本地时区、24 小时制，午夜显示 00 而非 24。 */
export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtDateTime(ts: number): string {
  return `${ymd(ts)} ${fmtTime(ts)}`;
}

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
 * - |n| ≥ 1000：最多一位小数 → `1k`、`10.4k`、`191k`
 * - 否则：原始整数
 * 用于请求列表和悬停明细。负数保留符号。
 */
export function formatTokenK(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1000) return `${sign}${Math.round(abs / 100) / 10}k`;
  return String(Math.round(n));
}

/** 耗时统一按秒展示（两位小数）：`6458ms → 6.46s`。非有限值按 `0.00s`。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "0.00s";
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * 输出速度（tok/s），对齐 sub2api：`输出 token / 总用时`。
 * 总用时包含等待首字的时间，不扣首字；把 TTFT 从分母剔除会让数值明显偏大。
 * 分子只取输出 token，不含输入、缓存读取或缓存创建。
 * `outputEstimated` 为真时分子是字符估算，加 `≈`。
 * 输出 ≤ 0 或用时缺失 / 无效时返回 null。
 */
export function formatOutputTps(
  outputTokens: number,
  durationMs: number | null,
  outputEstimated = false,
): string | null {
  if (!Number.isFinite(outputTokens) || outputTokens <= 0) return null;
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs <= 0) return null;

  const text = `${(outputTokens / (durationMs / 1000)).toFixed(1)} tok/s`;
  return outputEstimated ? `≈${text}` : text;
}
