import { describe, expect, it } from "vitest";

import {
  circuitBadgeLabel,
  circuitDot,
  circuitRemainingMs,
} from "@/services/modules/health";

describe("circuitDot", () => {
  it("熔断态映射到状态点颜色", () => {
    expect(circuitDot("open")).toBe("danger");
    expect(circuitDot("halfOpen")).toBe("warning");
    expect(circuitDot("closed")).toBe("success");
  });
});

describe("circuitRemainingMs", () => {
  it("按快照锚点扣减本地流逝", () => {
    expect(circuitRemainingMs(60_000, 1_000, 1_000)).toBe(60_000);
    expect(circuitRemainingMs(60_000, 1_000, 11_000)).toBe(50_000);
    expect(circuitRemainingMs(5_000, 1_000, 10_000)).toBe(0);
    expect(circuitRemainingMs(null, 1_000, 2_000)).toBe(0);
  });
});

describe("circuitBadgeLabel", () => {
  it("open 显示倒计时，到期为待探测，halfOpen 为恢复中", () => {
    expect(circuitBadgeLabel("open", 58_200, 0, 0)).toBe("熔断中 59s");
    expect(circuitBadgeLabel("open", 1_000, 0, 0)).toBe("熔断中 1s");
    expect(circuitBadgeLabel("open", 5_000, 0, 5_000)).toBe("待探测");
    expect(circuitBadgeLabel("halfOpen", 0, 0, 0)).toBe("恢复中");
    expect(circuitBadgeLabel("closed", 60_000, 0, 0)).toBe("");
  });
});
