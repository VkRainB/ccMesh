import { Grok, Zhipu } from "@lobehub/icons";
import { describe, expect, it } from "vitest";

import { getModelIcon } from "@/lib/model-icons";

describe("getModelIcon", () => {
  it("cursor-grok 走 Grok 而不是 Cursor 前缀", () => {
    expect(getModelIcon("cursor-grok-4.6-xhigh-fast")).toBe(Grok);
  });

  it("glm 分段仍匹配智谱", () => {
    expect(getModelIcon("glm-5.2-max")).toBe(Zhipu.Color);
  });
});
