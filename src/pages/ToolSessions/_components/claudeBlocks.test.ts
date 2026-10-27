import { describe, expect, it } from "vitest";

import { groupClaudeSegments, isClaudeChrome, parseClaudeBlocks, stripAnsi } from "./claudeBlocks";

describe("parseClaudeBlocks", () => {
  it("命令包装折成一行，caveat 丢弃", () => {
    expect(parseClaudeBlocks("user", "<local-command-caveat>skip</local-command-caveat>")).toEqual(
      [],
    );
    expect(
      parseClaudeBlocks(
        "user",
        "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>",
      ),
    ).toEqual([{ kind: "command", name: "/model", detail: "model" }]);
  });

  it("工具调用和用户原文分开，并去掉 ANSI", () => {
    expect(stripAnsi("Set model to \u001b[1mgpt-5.5\u001b[22m")).toBe("Set model to gpt-5.5");
    expect(
      parseClaudeBlocks("assistant", "Let me help.\n[Tool: Read] src/main.ts"),
    ).toEqual([
      { kind: "assistant", text: "Let me help." },
      { kind: "tool", name: "Read", summary: "src/main.ts" },
    ]);
    expect(parseClaudeBlocks("user", "hi")).toEqual([{ kind: "user", text: "hi" }]);
  });

  it("连续工具调用和结果并成一组", () => {
    const segments = groupClaudeSegments([
      {
        index: 0,
        role: "assistant",
        content: "我来查一下。\n[Tool: Bash] systeminfo\n[Tool: Bash] echo $SHELL",
      },
      { index: 1, role: "tool", content: "unavailable" },
      { index: 2, role: "tool", content: "unavailable" },
      { index: 3, role: "assistant", content: "Bash 暂时不可用。" },
    ]);
    expect(segments.map((s) => s.kind)).toEqual(["text", "tools", "text"]);
    expect(segments[1]).toMatchObject({
      kind: "tools",
      indexes: [0, 1, 2],
    });
    if (segments[1].kind === "tools") expect(segments[1].blocks).toHaveLength(4);
  });

  it("命令输出不当作用户气泡", () => {
    expect(isClaudeChrome("<local-command-stdout>Set model</local-command-stdout>")).toBe(true);
    expect(
      parseClaudeBlocks("user", "<local-command-stdout>Set model to gpt-5.5</local-command-stdout>"),
    ).toEqual([{ kind: "output", label: "命令输出", text: "Set model to gpt-5.5" }]);
  });
});
