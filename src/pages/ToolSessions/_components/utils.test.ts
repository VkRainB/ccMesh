import { describe, expect, it } from "vitest";

import {
  formatSessionTitle,
  getSessionKey,
  groupSessionsByProviderAndDirectory,
  matchesSessionSearch,
} from "./utils";
import type { ToolSessionMeta } from "@/services/modules/toolSessions";

const sample = (partial: Partial<ToolSessionMeta>): ToolSessionMeta => ({
  providerId: "codex",
  sessionId: "019fb8ae-8989-7012-b48a-78d71375f231",
  ...partial,
});

describe("toolSessions utils", () => {
  it("getSessionKey joins provider session and path", () => {
    expect(
      getSessionKey(
        sample({ sourcePath: "C:\\\\a\\\\rollout.jsonl", title: "t" }),
      ),
    ).toContain("codex:019fb8ae");
  });

  it("formatSessionTitle prefers title then project basename", () => {
    expect(formatSessionTitle(sample({ title: "生成图片" }))).toBe("生成图片");
    expect(
      formatSessionTitle(
        sample({ title: undefined, projectDir: "E:\\\\work\\\\demo" }),
      ),
    ).toBe("demo");
  });

  it("matchesSessionSearch checks metadata fields", () => {
    const s = sample({
      title: "生成蓝色繁体贰佰七十图片",
      projectDir: "E:\\\\imgs",
    });
    expect(matchesSessionSearch(s, "蓝色")).toBe(true);
    expect(matchesSessionSearch(s, "claude")).toBe(false);
  });

  it("groupSessionsByProviderAndDirectory groups by provider", () => {
    const groups = groupSessionsByProviderAndDirectory(
      [
        sample({ providerId: "claude", sessionId: "c1" }),
        sample({ providerId: "codex", sessionId: "x1" }),
        sample({ providerId: "codex", sessionId: "x2" }),
      ],
      "未知项目",
    );
    expect(groups).toHaveLength(2);
    const codex = groups.find((g) => g.providerId === "codex");
    expect(codex?.sessions).toHaveLength(2);
  });
});
