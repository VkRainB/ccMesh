import { describe, expect, it } from "vitest";

import {
  buildDefaultClaudeDesktopProfile,
  mergeClaudeDesktopOperationFields,
  parseClaudeDesktopOperationFields,
  replaceEditableFileJson,
  type ClaudeDesktopOperationFields,
} from "./claudeDesktopConfig";

describe("claudeDesktopConfig", () => {
  it("mergeClaudeDesktopOperationFields keeps unknown fields", () => {
    const base = {
      coworkEgressAllowedHosts: ["example.com"],
      customFlag: true,
    };
    const fields: ClaudeDesktopOperationFields = {
      baseUrl: "http://127.0.0.1:3000",
      apiKey: "sk-test",
      authScheme: "x-api-key",
      sonnetModel: "claude-sonnet-5[1m]",
      opusModel: "claude-opus-5",
      haikuModel: "",
      modelDiscoveryEnabled: true,
    };
    const merged = mergeClaudeDesktopOperationFields(base, fields);
    expect(merged.coworkEgressAllowedHosts).toEqual(["example.com"]);
    expect(merged.customFlag).toBe(true);
    expect(merged.inferenceGatewayBaseUrl).toBe("http://127.0.0.1:3000");
    expect(merged.inferenceProvider).toBe("gateway");
    const models = merged.inferenceModels as Array<Record<string, unknown>>;
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({
      name: "claude-sonnet-5",
      labelOverride: "claude-sonnet-5",
      supports1m: true,
      anthropicFamilyTier: "sonnet",
    });
  });

  it("parseClaudeDesktopOperationFields round-trips model 1M flag", () => {
    const profile = buildDefaultClaudeDesktopProfile("http://127.0.0.1:3000");
    const fields = parseClaudeDesktopOperationFields(profile);
    expect(fields.baseUrl).toBe("http://127.0.0.1:3000");
    expect(fields.sonnetModel).toContain("claude-sonnet-5");
    const again = mergeClaudeDesktopOperationFields(profile, {
      ...fields,
      sonnetModel: "my-sonnet[1m]",
    });
    const parsed = parseClaudeDesktopOperationFields(again);
    expect(parsed.sonnetModel).toBe("my-sonnet[1m]");
  });

  it("replaceEditableFileJson only swaps the selected file", () => {
    const data = {
      meta: {
        id: "a",
        name: "A",
        fileName: "a.json",
        path: "/a.json",
        registered: true,
        active: false,
        exists: true,
        validJson: true,
      },
      profileJson: { a: 1 },
      metaJson: { appliedId: "" },
      developerSettingsJson: {},
      desktopConfigJson: { deploymentMode: "1p" },
      paths: {
        supported: true,
        platform: "windows",
        resolutionSource: "test",
        isMsixVirtualized: false,
        candidates: [],
      },
    };
    const next = replaceEditableFileJson(data, "desktopConfig", { deploymentMode: "3p" });
    expect(next.desktopConfigJson).toEqual({ deploymentMode: "3p" });
    expect(next.profileJson).toEqual({ a: 1 });
  });
});
