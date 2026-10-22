import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { renderReleaseNotes, sanitizeReleaseNotes } from "@/lib/releaseNotes";

/** 已发布 v0.2.10 的 latest.json notes 样本（下载表略去重复行）。 */
const V0210_NOTES = [
  "### 新增",
  "",
  "- 实时请求：添加速率tok/s 更好查看Agent执行效率",
  "",
  "<!-- 首次发版后根据实际产物名校准文件名 -->",
  "",
  '<div align="center">',
  "",
  "[![Release Downloads](https://img.shields.io/github/downloads/VkRainB/ccMesh/v0.2.10/total?style=flat-square&logo=github)](https://github.com/VkRainB/ccMesh/releases)",
  "",
  "</div>",
  "",
  "**按操作系统选择下载：**",
  "",
  '<div align="left">',
  "<table>",
  '<tr><td>Windows</td><td><img src="https://img.shields.io/badge/Setup-EXE-2d7d9a.svg?logo=windows"></td></tr>',
  "</table>",
  "</div>",
  "",
  "完整更新历史见 [CHANGELOG.md](https://github.com/VkRainB/ccMesh/blob/master/CHANGELOG.md)",
  "",
  "---",
  "",
  "> 💬 **QQ 反馈交流群：1105537401**",
].join("\n");

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return "";
}

describe("sanitizeReleaseNotes", () => {
  it("v0.2.10 只保留 tok/s 说明，去掉下载表、徽章和 QQ", () => {
    const text = sanitizeReleaseNotes(V0210_NOTES);
    expect(text).toBe("### 新增\n\n- 实时请求：添加速率tok/s 更好查看Agent执行效率");
    expect(text).not.toContain("<table");
    expect(text).not.toContain("shields");
    expect(text).not.toContain("QQ 反馈");

    const rendered = textOf(renderReleaseNotes(V0210_NOTES));
    expect(rendered).toContain("新增");
    expect(rendered).toContain("实时请求：添加速率tok/s 更好查看Agent执行效率");
    expect(rendered).not.toContain("<table");
    expect(rendered).not.toContain("shields");
    expect(rendered).not.toContain("QQ 反馈");
  });

  it("没有模板时保留中文标题和列表", () => {
    const notes = "### 新增\n\n- 实时请求：添加速率tok/s 更好查看Agent执行效率";
    expect(sanitizeReleaseNotes(notes)).toBe(notes);
  });

  it("正文里的 script、表格和徽章也会被去掉", () => {
    const notes = [
      "### 修复",
      "",
      "- 保留<script>alert(1)</script>这条",
      "",
      "<style>.x{}</style>",
      "<table><tr><td>TABLECELL</td></tr></table>",
      "![badge](https://img.shields.io/badge/x)",
      "<br>",
    ].join("\n");
    const text = sanitizeReleaseNotes(notes);
    expect(text).toContain("### 修复");
    expect(text).toContain("保留这条");
    expect(text).not.toContain("script");
    expect(text).not.toContain("TABLECELL");
    expect(text).not.toContain("<table");
    expect(text).not.toContain("shields");
    expect(text).not.toContain("<br");
  });
});
