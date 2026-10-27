import { describe, expect, it } from "vitest";

import { clipMarkdown } from "./MarkdownText";

describe("clipMarkdown", () => {
  it("短文本原样返回", () => {
    expect(clipMarkdown("你好", 500)).toBe("你好");
  });

  it("在段落处截断，不切在加粗中间", () => {
    const text = `${"甲".repeat(200)}\n\n**未完**${"乙".repeat(400)}`;
    const clipped = clipMarkdown(text, 250);
    expect(clipped.endsWith("…")).toBe(true);
    expect(clipped.includes("**未完**")).toBe(false);
  });
});
