import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlanQuotaCard } from "@/pages/Statistics/_components/cursor/PlanQuotaCard";
import type { CursorMetrics, CursorPlanInfo, CursorPeriod } from "@/services/modules/cursorUsage";

const plan: CursorPlanInfo = {
  planName: "Pro+",
  price: "$60/mo",
  includedAmountCents: 7000,
};

const period: CursorPeriod = {
  cycleStartMs: Date.parse("2026-08-28T00:00:00Z"),
  cycleEndMs: Date.parse("2026-09-28T00:00:00Z"),
  autoBucketModels: [],
  planUsage: {
    totalSpend: 89317,
    includedSpend: 7000,
    bonusSpend: 82317,
    remaining: 0,
    limit: 7000,
    totalPercentUsed: 100,
  },
};

const metrics: CursorMetrics = {
  quotaUsedPct: 100,
  officialTotalPct: 100,
  expectedUsedPct: 60,
  overPace: true,
  daysLeft: 11,
  cycleTotalDays: 31,
  dailyBudgetCents: 0,
  todayUsedCents: 0,
  todayUsedPct: 0,
  cycleSpendCents: 89317,
  cycleBonusCents: 82317,
  cycleRemainingCents: 0,
  cycleUsedCents: 7000,
  cycleLimitCents: 7000,
};

describe("PlanQuotaCard", () => {
  it("总消耗下方展示本周期 Token，按亿缩写", () => {
    render(
      <PlanQuotaCard plan={plan} period={period} metrics={metrics} cycleTokens={200_000_000} />,
    );
    expect(screen.getByText("总消耗")).toBeInTheDocument();
    expect(screen.getByText("总Token消耗")).toBeInTheDocument();
    expect(screen.getByText("2.0亿")).toBeInTheDocument();
  });

  it("不足万时展示原值", () => {
    render(<PlanQuotaCard plan={plan} period={period} metrics={metrics} cycleTokens={123} />);
    expect(screen.getByText("123")).toBeInTheDocument();
  });
});
