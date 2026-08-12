import { describe, expect, it } from "vitest";

import {
  applyClaudeCompact,
  applyClaudeToggles,
  claudeOperationFragment,
  DEFAULT_CLAUDE_TOGGLES,
  gatewayBaseUrl,
  mergeClaudeSettings,
  parseClaudeCompact,
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

describe("claude compact", () => {
  it("parse：env 键优先，根字段 autoCompactWindow 兜底，number 容错为字符串", () => {
    expect(
      parseClaudeCompact({
        autoCompactWindow: 500000,
        env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: 1000000 },
      }),
    ).toEqual({ maxContextTokens: "1000000", autoCompactWindow: "500000" });
    expect(
      parseClaudeCompact({
        autoCompactWindow: 500000,
        env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "800000" },
      }).autoCompactWindow,
    ).toBe("800000");
    expect(parseClaudeCompact({})).toEqual({ maxContextTokens: "", autoCompactWindow: "" });
  });

  it("apply：写 env 字符串并清根字段；空值清除对应键，不动其它字段", () => {
    const out = applyClaudeCompact(
      {
        autoCompactWindow: 500000,
        env: { MY_VAR: "keep", CLAUDE_CODE_AUTO_COMPACT_WINDOW: "1" },
      },
      { maxContextTokens: "1000000", autoCompactWindow: "" },
    ) as { autoCompactWindow?: unknown; env: Record<string, string> };
    expect(out.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("1000000");
    // 空值 → 清除 env 键；根字段统一移除避免两处分叉
    expect(out.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined();
    expect(out.autoCompactWindow).toBeUndefined();
    expect(out.env.MY_VAR).toBe("keep");
  });

  it("parse→apply 回环：根字段形式被归一为 env 形式且值不丢", () => {
    const base = { autoCompactWindow: 300000, env: {} };
    const out = applyClaudeCompact(base, parseClaudeCompact(base)) as {
      autoCompactWindow?: unknown;
      env: Record<string, string>;
    };
    expect(out.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("300000");
    expect(out.autoCompactWindow).toBeUndefined();
  });
});
