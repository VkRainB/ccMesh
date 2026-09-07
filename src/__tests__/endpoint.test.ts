import { describe, expect, it } from "vitest";

import {
  advertisedModels,
  extractTestError,
  extractTestReply,
  litOutboundModels,
  outboundModels,
} from "@/services/modules/endpoint";

const ep = (over: {
  model?: string;
  models?: string[];
  activeModels?: string[];
  modelMappings?: { from: string; to: string }[];
  modelMappingsEnabled?: boolean;
}) => ({
  model: over.model ?? "",
  models: over.models ?? [],
  activeModels: over.activeModels ?? [],
  modelMappings: over.modelMappings ?? [],
  modelMappingsEnabled: over.modelMappingsEnabled ?? true,
});

describe("advertisedModels 点亮过滤", () => {
  it("空点亮集 → 全量公布（兼容旧端点）", () => {
    expect(advertisedModels(ep({ models: ["a", "b", "c"] }))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("非空点亮集 → 仅公布点亮子集并入映射入站名", () => {
    const adv = advertisedModels(
      ep({
        models: ["a", "b", "c"],
        activeModels: ["a", "c"],
        modelMappings: [{ from: "alias", to: "a" }],
      }),
    );
    expect(adv).toContain("a");
    expect(adv).toContain("c");
    expect(adv).toContain("alias");
    expect(adv).not.toContain("b");
  });

  it("锁定 model 优先于点亮子集", () => {
    const adv = advertisedModels(
      ep({ model: "locked", models: ["a", "b"], activeModels: ["a"] }),
    );
    expect(adv).toEqual(["locked"]);
  });

  it("大小写去重保留首次出现", () => {
    const adv = advertisedModels(
      ep({ models: ["GPT-5", "gpt-5"], activeModels: ["GPT-5", "gpt-5"] }),
    );
    expect(adv).toEqual(["GPT-5"]);
  });

  it("关闭映射总开关 → 不并入入站别名（配置仍在）", () => {
    const adv = advertisedModels(
      ep({
        models: ["claude-opus-4-8"],
        modelMappings: [{ from: "gpt-5", to: "claude-opus-4-8" }],
        modelMappingsEnabled: false,
      }),
    );
    expect(adv).toEqual(["claude-opus-4-8"]);
    expect(adv).not.toContain("gpt-5");
  });
});

describe("outboundModels 不受点亮影响", () => {
  it("锁定优先，否则全量 models（测试连通性用真实模型）", () => {
    expect(outboundModels({ model: "", models: ["a", "b"] })).toEqual([
      "a",
      "b",
    ]);
    expect(outboundModels({ model: "x", models: ["a", "b"] })).toEqual(["x"]);
  });
});

describe("litOutboundModels 按点亮过滤（模型映射出站候选）", () => {
  it("空点亮集 → 全量 models（兼容旧端点）", () => {
    expect(litOutboundModels(ep({ models: ["a", "b", "c"] }))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("非空点亮集 → 仅点亮子集并保持 models 顺序", () => {
    expect(
      litOutboundModels(ep({ models: ["a", "b", "c"], activeModels: ["c", "a"] })),
    ).toEqual(["a", "c"]);
  });

  it("锁定 model 优先于点亮子集", () => {
    expect(
      litOutboundModels(ep({ model: "locked", models: ["a", "b"], activeModels: ["a"] })),
    ).toEqual(["locked"]);
  });
});

describe("extractTestReply 只取回复文本", () => {
  it("OpenAI chat content 字符串", () => {
    expect(
      extractTestReply(
        JSON.stringify({ choices: [{ message: { content: "Hi there" } }] }),
      ),
    ).toBe("Hi there");
  });

  it("Claude content[].text", () => {
    expect(
      extractTestReply(
        JSON.stringify({ content: [{ type: "text", text: "pong" }] }),
      ),
    ).toBe("pong");
  });

  it("Responses output_text", () => {
    expect(extractTestReply(JSON.stringify({ output_text: "ok" }))).toBe("ok");
  });

  it("非 JSON 短正文原样返回", () => {
    expect(extractTestReply("plain pong")).toBe("plain pong");
  });
});

describe("extractTestError", () => {
  it("抽出 error.message", () => {
    expect(
      extractTestError(
        JSON.stringify({ error: { message: "model not found" } }),
      ),
    ).toBe("model not found");
  });
});
