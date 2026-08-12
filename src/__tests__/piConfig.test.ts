import { describe, expect, it } from "vitest";

import {
  addPiModel,
  applyFieldsToPiProvider,
  emptyPiModel,
  parsePiProviderFields,
  parseProviderJsonText,
  removePiModel,
  togglePiModelInput,
  updatePiModel,
  type PiProviderFields,
} from "@/lib/piConfig";
import {
  detectSubTab,
  getProviderModelIds,
  isSafePiOmpProviderId,
} from "@/lib/piOmpCommon";

const gateway = "http://127.0.0.1:3000/v1";

describe("piConfig 表单辅助函数", () => {
  it("校验 provider id 的安全文件名约束", () => {
    expect(isSafePiOmpProviderId("remote-gpt_1.0")).toBe(true);
    expect(isSafePiOmpProviderId("../remote")).toBe(false);
    expect(isSafePiOmpProviderId("remote/gpt")).toBe(false);
    expect(isSafePiOmpProviderId("  ")).toBe(false);
  });

  it("解析 provider JSON 时要求根节点是对象", () => {
    expect(parseProviderJsonText('{"models":[{"id":"gpt-5.5"}]}')).toEqual({
      models: [{ id: "gpt-5.5" }],
    });
    expect(() => parseProviderJsonText("[]")).toThrow("provider 必须是 JSON 对象");
  });

  it("提取 provider.models[].id", () => {
    expect(getProviderModelIds({ models: [{ id: "gpt-5.5" }, { name: "missing" }] })).toEqual([
      "gpt-5.5",
    ]);
  });

  it("detectSubTab 按 baseUrl 是否等于网关判定端点/自定义模式", () => {
    expect(detectSubTab("http://127.0.0.1:3000/v1", gateway)).toBe("endpoint");
    expect(detectSubTab("http://127.0.0.1:3000/v1/", gateway)).toBe("endpoint");
    expect(detectSubTab("https://api.deepseek.com", gateway)).toBe("custom");
    expect(detectSubTab("", gateway)).toBe("custom");
  });

  it("parsePiProviderFields 解析 provider JSON 成表单视图", () => {
    const providerJson = {
      baseUrl: "http://127.0.0.1:3000/v1",
      api: "openai-responses",
      apiKey: "DEEPSEEK_API_KEY",
      models: [{ id: "deepseek-v4-flash", contextWindow: 1000000 }],
    };
    const fields = parsePiProviderFields(providerJson, gateway);
    expect(fields.api).toBe("openai-responses");
    expect(fields.baseUrl).toBe("http://127.0.0.1:3000/v1");
    expect(fields.apiKey).toBe("DEEPSEEK_API_KEY");
    expect(fields.subTab).toBe("endpoint");
    expect(fields.models).toHaveLength(1);
    expect(fields.models[0].contextWindow).toBe(1000000);
  });

  it("applyFieldsToPiProvider 保留 headers/compat 等高级字段", () => {
    const base = {
      baseUrl: "https://old.example.com/v1",
      api: "openai-responses",
      headers: { "x-org-id": "myco" },
      compat: { supportsDeveloperRole: false },
      authHeader: true,
    };
    const fields = parsePiProviderFields(base, gateway);
    fields.baseUrl = gateway;
    fields.apiKey = "$MY_KEY";
    const merged = applyFieldsToPiProvider(base, fields);
    expect(merged.baseUrl).toBe(gateway);
    expect(merged.apiKey).toBe("$MY_KEY");
    expect(merged.headers).toEqual({ "x-org-id": "myco" });
    expect(merged.compat).toEqual({ supportsDeveloperRole: false });
    expect(merged.authHeader).toBe(true);
  });

  it("applyFieldsToPiProvider 清空 apiKey 时移除键而非留空串", () => {
    const base = { apiKey: "sk-old" };
    const fields = parsePiProviderFields(base, gateway);
    fields.apiKey = "";
    const merged = applyFieldsToPiProvider(base, fields);
    expect(merged).not.toHaveProperty("apiKey");
  });

  it("addPiModel / updatePiModel / removePiModel 操作模型列表", () => {
    const models = [emptyPiModel()];
    const withAdded = addPiModel(models);
    expect(withAdded).toHaveLength(2);
    const updated = updatePiModel(withAdded, 0, { id: "gpt-5.5" });
    expect(updated[0].id).toBe("gpt-5.5");
    const removed = removePiModel(updated, 1);
    expect(removed).toHaveLength(1);
    expect(removed[0].id).toBe("gpt-5.5");
  });

  it("togglePiModelInput 切换 image 模态；text 始终保留不可移除", () => {
    const models = [emptyPiModel()];
    const withImage = togglePiModelInput(models, 0, "image", true);
    expect(withImage[0].input).toEqual(["text", "image"]);
    const toggleTextOff = togglePiModelInput(withImage, 0, "text", false);
    expect(toggleTextOff[0].input).toEqual(["text", "image"]);
    const withoutImage = togglePiModelInput(withImage, 0, "image", false);
    expect(withoutImage[0].input).toEqual(["text"]);
  });

  it("表单 → JSON → 表单 往返保持字段一致", () => {
    const fields: PiProviderFields = {
      name: "",
      api: "openai-responses",
      baseUrl: "https://api.example.com/v1",
      apiKey: "$KEY",
      oauth: "",
      headers: {},
      authHeader: false,
      models: [
        {
          id: "gpt-5.5",
          name: "GPT 5.5",
          reasoning: true,
          thinkingLevelMap: {},
          input: ["text", "image"],
          contextWindow: 200000,
          maxTokens: 32000,
          cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
          costTiers: [],
          samplingParams: {},
          headers: {},
          api: "",
          baseUrl: "",
        },
      ],
      subTab: "custom",
    };
    const json = applyFieldsToPiProvider({}, fields);
    const reparsed = parsePiProviderFields(json, gateway);
    expect(reparsed.api).toBe(fields.api);
    expect(reparsed.baseUrl).toBe(fields.baseUrl);
    expect(reparsed.apiKey).toBe(fields.apiKey);
    expect(reparsed.models[0].id).toBe(fields.models[0].id);
    expect(reparsed.models[0].cost).toEqual(fields.models[0].cost);
  });
});
