import { describe, expect, it } from "vitest";

import {
  addOmpModel,
  applyFieldsToOmpProvider,
  emptyOmpModel,
  parseOmpProviderFields,
  parseProviderJsonText,
  removeOmpModel,
  toggleOmpModelInput,
  updateOmpModel,
  type OmpProviderFields,
} from "@/lib/ompConfig";
import {
  buildPiOmpApplyItems,
  canProviderBeDefault,
  detectSubTab,
  formatOmpDefaultSelector,
  getProviderModelIds,
  isSafePiOmpProviderId,
  reorderPiOmpProviders,
} from "@/lib/piOmpCommon";
import type { PiOmpProviderMeta } from "@/lib/piOmpCommon";

const gateway = "http://127.0.0.1:3000/v1";

const provider = (id: string, order: number, enabled = true, modelCount = 1): PiOmpProviderMeta => ({
  id,
  name: id,
  enabled,
  order,
  modelCount,
  isDefault: false,
  updatedAt: "2026-08-10T00:00:00+08:00",
  configuredAt: "2026-08-10T00:00:00+08:00",
  appliedAt: null,
});

describe("ompConfig 公共辅助函数", () => {
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
    expect(getProviderModelIds({ discovery: { type: "proxy" } })).toEqual([]);
  });

  it("只有启用且有模型的渠道才能作为默认模型", () => {
    expect(canProviderBeDefault(provider("enabled", 0, true, 1))).toBe(true);
    expect(canProviderBeDefault(provider("disabled", 0, false, 1))).toBe(false);
    expect(canProviderBeDefault(provider("discovery-only", 0, true, 0))).toBe(false);
  });

  it("按当前顺序构造 apply items", () => {
    expect(buildPiOmpApplyItems([provider("b", 8, false), provider("a", 9, true)])).toEqual([
      { id: "b", enabled: false, order: 0 },
      { id: "a", enabled: true, order: 1 },
    ]);
  });

  it("拖动排序后重算 order", () => {
    const reorderedProviders = reorderPiOmpProviders(
      [provider("a", 0), provider("b", 1), provider("c", 2)],
      "a",
      "c",
    );
    expect(reorderedProviders.map((item) => `${item.id}:${item.order}`)).toEqual([
      "b:0",
      "c:1",
      "a:2",
    ]);
  });

  it("格式化 OMP 默认模型 selector", () => {
    expect(formatOmpDefaultSelector("remote-gpt", "gpt-5.5", "xhigh")).toBe(
      "remote-gpt/gpt-5.5:xhigh",
    );
    expect(formatOmpDefaultSelector("openrouter", "openai/gpt-4o", "")).toBe(
      "openrouter/openai/gpt-4o",
    );
  });
});

describe("ompConfig 表单双向绑定辅助函数", () => {
  it("detectSubTab 按 baseUrl 是否等于网关判定端点/自定义模式", () => {
    expect(detectSubTab("http://127.0.0.1:3000/v1", gateway)).toBe("endpoint");
    expect(detectSubTab("http://127.0.0.1:3000/v1/", gateway)).toBe("endpoint");
    expect(detectSubTab("https://api.deepseek.com", gateway)).toBe("custom");
    expect(detectSubTab("", gateway)).toBe("custom");
  });

  it("parseOmpProviderFields 解析 provider JSON 成表单视图", () => {
    const providerJson = {
      baseUrl: "http://127.0.0.1:3000/v1",
      api: "openai-completions",
      apiKey: "DEEPSEEK_API_KEY",
      models: [{ id: "deepseek-v4-flash", contextWindow: 1000000 }],
    };
    const fields = parseOmpProviderFields(providerJson, gateway);
    expect(fields.api).toBe("openai-completions");
    expect(fields.baseUrl).toBe("http://127.0.0.1:3000/v1");
    expect(fields.apiKey).toBe("DEEPSEEK_API_KEY");
    expect(fields.subTab).toBe("endpoint");
    expect(fields.models).toHaveLength(1);
    expect(fields.models[0].contextWindow).toBe(1000000);
  });

  it("applyFieldsToOmpProvider 保留 headers/compat 等高级字段", () => {
    const base = {
      baseUrl: "https://old.example.com/v1",
      api: "openai-completions",
      headers: { "x-org-id": "myco" },
      compat: { supportsDeveloperRole: false },
      authHeader: true,
    };
    const fields = parseOmpProviderFields(base, gateway);
    fields.baseUrl = gateway;
    fields.apiKey = "$MY_KEY";
    const merged = applyFieldsToOmpProvider(base, fields);
    expect(merged.baseUrl).toBe(gateway);
    expect(merged.apiKey).toBe("$MY_KEY");
    expect(merged.headers).toEqual({ "x-org-id": "myco" });
    expect(merged.compat).toEqual({ supportsDeveloperRole: false });
    expect(merged.authHeader).toBe(true);
  });

  it("applyFieldsToOmpProvider 清空 apiKey 时移除键而非留空串", () => {
    const base = { apiKey: "sk-old" };
    const fields = parseOmpProviderFields(base, gateway);
    fields.apiKey = "";
    const merged = applyFieldsToOmpProvider(base, fields);
    expect(merged).not.toHaveProperty("apiKey");
  });

  it("addOmpModel / updateOmpModel / removeOmpModel 操作模型列表", () => {
    const models = [emptyOmpModel()];
    const withAdded = addOmpModel(models);
    expect(withAdded).toHaveLength(2);
    const updated = updateOmpModel(withAdded, 0, { id: "gpt-5.5" });
    expect(updated[0].id).toBe("gpt-5.5");
    const removed = removeOmpModel(updated, 1);
    expect(removed).toHaveLength(1);
    expect(removed[0].id).toBe("gpt-5.5");
  });

  it("toggleOmpModelInput 切换 image 模态；text 始终保留不可移除", () => {
    const models = [emptyOmpModel()];
    const withImage = toggleOmpModelInput(models, 0, "image", true);
    expect(withImage[0].input).toEqual(["text", "image"]);
    const toggleTextOff = toggleOmpModelInput(withImage, 0, "text", false);
    expect(toggleTextOff[0].input).toEqual(["text", "image"]);
    const withoutImage = toggleOmpModelInput(withImage, 0, "image", false);
    expect(withoutImage[0].input).toEqual(["text"]);
  });

  it("表单 → JSON → 表单 往返保持字段一致", () => {
    const fields: OmpProviderFields = {
      api: "openai-completions",
      baseUrl: "https://api.example.com/v1",
      apiKey: "$KEY",
      headers: {},
      remoteCompaction: null,
      authHeader: false,
      auth: "apiKey",
      discovery: null,
      disableStrictTools: false,
      transport: "",
      models: [
        {
          id: "gpt-5.5",
          name: "GPT 5.5",
          reasoning: true,
          thinking: null,
          input: ["text", "image"],
          supportsTools: null,
          cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
          premiumMultiplier: null,
          contextWindow: 200000,
          maxTokens: 32000,
          omitMaxOutputTokens: false,
          headers: {},
          contextPromotionTarget: "",
          compactionModel: "",
          api: "",
          baseUrl: "",
          remoteCompaction: null,
        },
      ],
      subTab: "custom",
    };
    const json = applyFieldsToOmpProvider({}, fields);
    const reparsed = parseOmpProviderFields(json, gateway);
    expect(reparsed.api).toBe(fields.api);
    expect(reparsed.baseUrl).toBe(fields.baseUrl);
    expect(reparsed.apiKey).toBe(fields.apiKey);
    expect(reparsed.models[0].id).toBe(fields.models[0].id);
    expect(reparsed.models[0].cost).toEqual(fields.models[0].cost);
  });
});
