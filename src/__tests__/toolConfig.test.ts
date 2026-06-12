import { describe, expect, it } from "vitest";

import {
  applyClaudeToggles,
  claudeOperationFragment,
  DEFAULT_CLAUDE_TOGGLES,
  gatewayBaseUrl,
  mergeClaudeSettings,
  parseClaudeToggles,
  splitOneM,
  withOneM,
} from "@/lib/toolConfig";
import type { ClaudeOperationFields } from "@/services/modules/tool_config";

const fields: ClaudeOperationFields = {
  baseUrl: "https://cc",
  apiKey: "sk-1",
  sonnetModel: "mimo[1m]",
  opusModel: "mimo-pro",
  haikuModel: "mimo-fast",
  defaultModel: "",
};

describe("gatewayBaseUrl", () => {
  it("claude 用裸地址", () => {
    expect(gatewayBaseUrl(3000, "claude")).toBe("http://127.0.0.1:3000");
  });
  it("codex 末尾补 /v1", () => {
    expect(gatewayBaseUrl(3000, "codex")).toBe("http://127.0.0.1:3000/v1");
  });
});

describe("withOneM / splitOneM", () => {
  it("勾选追加 [1m]，幂等", () => {
    expect(withOneM("mimo", true)).toBe("mimo[1m]");
    expect(withOneM("mimo[1m]", true)).toBe("mimo[1m]");
  });
  it("取消去掉 [1m]", () => {
    expect(withOneM("mimo[1m]", false)).toBe("mimo");
  });
  it("空模型返回空", () => {
    expect(withOneM("  ", true)).toBe("");
  });
  it("split 拆解基名与标志", () => {
    expect(splitOneM("mimo[1m]")).toEqual({ base: "mimo", is1m: true });
    expect(splitOneM("mimo")).toEqual({ base: "mimo", is1m: false });
  });
});

describe("mergeClaudeSettings", () => {
  it("保留非操作字段，写入操作字段，空字段清除", () => {
    const base = {
      env: { MY_VAR: "keep", ANTHROPIC_MODEL: "old" },
      permissions: { allow: ["*"] },
    };
    const merged = mergeClaudeSettings(base, fields) as {
      env: Record<string, string>;
      permissions: unknown;
    };
    expect(merged.env.ANTHROPIC_BASE_URL).toBe("https://cc");
    expect(merged.env.ANTHROPIC_API_KEY).toBe("sk-1");
    expect(merged.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("mimo[1m]");
    expect(merged.env.MY_VAR).toBe("keep");
    expect(merged.permissions).toEqual({ allow: ["*"] });
    // 空 defaultModel → 清除
    expect(merged.env.ANTHROPIC_MODEL).toBeUndefined();
  });

  it("operation fragment 只含 env 操作字段", () => {
    const frag = claudeOperationFragment(fields) as { env: Record<string, string> };
    expect(Object.keys(frag)).toEqual(["env"]);
    expect(frag.env.ANTHROPIC_BASE_URL).toBe("https://cc");
  });
});

describe("claude toggles", () => {
  it("applyClaudeToggles 开启写入对应键", () => {
    const out = applyClaudeToggles(
      {},
      {
        hideAttribution: true,
        teammates: true,
        toolSearch: true,
        effortMax: true,
        disableAutoUpdate: true,
      },
    ) as { attribution?: unknown; env: Record<string, string> };
    expect(out.attribution).toEqual({ commit: "", pr: "" });
    expect(out.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBe("1");
    expect(out.env.ENABLE_TOOL_SEARCH).toBe("true");
    expect(out.env.CLAUDE_CODE_EFFORT_LEVEL).toBe("max");
    expect(out.env.DISABLE_AUTOUPDATER).toBe("1");
  });

  it("applyClaudeToggles 关闭移除对应键且不动其它字段", () => {
    const base = {
      attribution: { commit: "", pr: "" },
      env: { CLAUDE_CODE_EFFORT_LEVEL: "max", MY_VAR: "keep" },
    };
    const out = applyClaudeToggles(base, DEFAULT_CLAUDE_TOGGLES) as {
      attribution?: unknown;
      env: Record<string, string>;
    };
    expect(out.attribution).toBeUndefined();
    expect(out.env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
    expect(out.env.MY_VAR).toBe("keep");
  });

  it("parseClaudeToggles 回显", () => {
    const t = parseClaudeToggles({
      attribution: { commit: "", pr: "" },
      env: { ENABLE_TOOL_SEARCH: "true", DISABLE_AUTOUPDATER: "1" },
    });
    expect(t.hideAttribution).toBe(true);
    expect(t.toolSearch).toBe(true);
    expect(t.disableAutoUpdate).toBe(true);
    expect(t.teammates).toBe(false);
    expect(t.effortMax).toBe(false);
  });
});
