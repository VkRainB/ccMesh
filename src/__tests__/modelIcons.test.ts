import { Grok, Kimi, OpenAI, Zhipu } from "@lobehub/icons";
import { describe, expect, it } from "vitest";

import { getModelIcon } from "@/lib/model-icons";

describe("getModelIcon", () => {
  it("cursor-grok 走 Grok 而不是 Cursor 前缀", () => {
    expect(getModelIcon("cursor-grok-4.6-xhigh-fast")).toBe(Grok);
  });

  it("glm 分段仍匹配智谱", () => {
    expect(getModelIcon("glm-5.2-max")).toBe(Zhipu.Color);
  });

  it("gpt 暗色走白色包装，不直接用原始单色", () => {
    expect(getModelIcon("gpt-5.5")).not.toBe(OpenAI);
    expect(getModelIcon("codex-auto-review")).not.toBe(OpenAI);
  });

  it("kimi 不用写死白字的 Color", () => {
    expect(getModelIcon("kimi-k3")).not.toBe(Kimi.Color);
    expect(getModelIcon("moonshot-v1")).not.toBe(Kimi.Color);
  });
});
