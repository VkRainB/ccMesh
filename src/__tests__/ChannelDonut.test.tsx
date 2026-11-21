import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChannelDonut } from "@/pages/Statistics/_components/cursor/ChannelDonut";
import type { CursorPlanUsage } from "@/services/modules/cursorUsage";

const planUsage: CursorPlanUsage = {
  totalSpend: 2500,
  includedSpend: 2500,
  bonusSpend: 0,
  remaining: 4500,
  limit: 7000,
  totalPercentUsed: 40,
  autoPercentUsed: 40,
  apiPercentUsed: 28.6,
};

describe("ChannelDonut", () => {
  it("保留官方进度，按各通道金额展示预估额度，不混用套餐保底", () => {
    const captured = { ...planUsage, apiPercentUsed: 72.61818181818181 };
    render(
      <ChannelDonut
        planUsage={captured}
        aggregations={[
          { tier: 2, totalCents: 500 },
          { tier: 1, totalCents: 1996.540952 },
        ]}
      />,
    );
    expect(screen.getByText("40.0%")).toBeInTheDocument();
    expect(screen.getByText("72.6%")).toBeInTheDocument();
    expect(screen.getAllByText(/已用/).length).toBe(2);
    expect(screen.getByText("$5.00")).toBeInTheDocument();
    expect(screen.getByText("$12.50")).toBeInTheDocument();
    expect(screen.getByText("$19.9654")).toBeInTheDocument();
    expect(screen.getByText("$27.49")).toBeInTheDocument();
    expect(screen.queryByText("$70.00")).not.toBeInTheDocument();
    expect(screen.getAllByText(/预估额度/)).toHaveLength(2);
  });

  it("无聚合数据时只展示进度百分比", () => {
    render(<ChannelDonut planUsage={planUsage} />);
    expect(screen.getByText("40.0%")).toBeInTheDocument();
    expect(screen.queryByText(/已用/)).not.toBeInTheDocument();
    expect(screen.queryByText(/预估/)).not.toBeInTheDocument();
  });

  it("Auto 占满时预估显示 —", () => {
    render(
      <ChannelDonut
        planUsage={{ ...planUsage, autoPercentUsed: 100 }}
        aggregations={[{ tier: 2, totalCents: 500 }]}
      />,
    );
    expect(screen.getAllByText("—")).toHaveLength(2);
  });
});
