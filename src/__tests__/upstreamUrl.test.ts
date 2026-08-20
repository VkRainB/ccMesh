import { describe, expect, it } from "vitest";

import { joinUpstreamUrl } from "@/lib/upstreamUrl";

describe("joinUpstreamUrl", () => {
  it("默认附加 /v1", () => {
    expect(joinUpstreamUrl("https://api.openai.com", "/v1/chat/completions")).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("智谱 v4 跳过 /v1", () => {
    expect(
      joinUpstreamUrl(
        "https://open.bigmodel.cn/api/coding/paas/v4",
        "/v1/chat/completions",
      ),
    ).toBe("https://open.bigmodel.cn/api/coding/paas/v4/chat/completions");
  });

  it("末尾 # 跳过 /v1", () => {
    expect(joinUpstreamUrl("https://host/openai#", "/v1/chat/completions")).toBe(
      "https://host/openai/chat/completions",
    );
  });

  it("DeepSeek /anthropic 仍拼 /v1", () => {
    expect(joinUpstreamUrl("https://api.deepseek.com/anthropic", "/v1/messages")).toBe(
      "https://api.deepseek.com/anthropic/v1/messages",
    );
  });
});
