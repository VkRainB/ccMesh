import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UsageOverviewCards } from "@/pages/Statistics/_components/UsageOverviewCards";
import type { TokenBuckets } from "@/lib/usageMetrics";

const buckets = (
  input: number,
  output: number,
  write: number,
  read: number,
): TokenBuckets => ({
  inputTokens: input,
  outputTokens: output,
  cacheCreationTokens: write,
  cacheReadTokens: read,
});

describe("UsageOverviewCards", () => {
  it("按设计稿展示真实消耗、命中率与五张拆分卡", () => {
    render(
      <UsageOverviewCards
        requests={1248}
        buckets={buckets(3_210_000, 4_860_000, 2_140_000, 8_620_000)}
        yesterdayBuckets={buckets(3_000_000, 4_500_000, 2_000_000, 8_000_000)}
        showTrend
      />,
    );
    expect(screen.getByText("真实消耗 Tokens")).toBeInTheDocument();
    expect(screen.getByText("18.8M")).toBeInTheDocument();
    expect(screen.getByText("缓存命中率")).toBeInTheDocument();
    expect(screen.getByText("61.7%")).toBeInTheDocument();
    expect(screen.getByText("请求数")).toBeInTheDocument();
    expect(screen.getByText("1,248")).toBeInTheDocument();
    expect(screen.getByText("输入")).toBeInTheDocument();
    expect(screen.getByText("3.21M")).toBeInTheDocument();
    expect(screen.getByText("输出")).toBeInTheDocument();
    expect(screen.getByText("4.86M")).toBeInTheDocument();
    expect(screen.getByText("创建缓存")).toBeInTheDocument();
    expect(screen.getByText("2.14M")).toBeInTheDocument();
    expect(screen.getByText("命中缓存")).toBeInTheDocument();
    expect(screen.getByText("8.62M")).toBeInTheDocument();
    expect(screen.getByText(/较昨日/)).toBeInTheDocument();
  });

  it("Claude 例：命中率 50.0%，空 prompt 显示 —", () => {
    const { rerender } = render(
      <UsageOverviewCards requests={1} buckets={buckets(200, 50, 300, 500)} />,
    );
    expect(screen.getByText("50.0%")).toBeInTheDocument();
    rerender(<UsageOverviewCards requests={0} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
    expect(screen.queryByText(/较昨日/)).not.toBeInTheDocument();
  });
});
