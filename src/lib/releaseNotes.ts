import { createElement, type ReactNode } from "react";

import changelog from "../../CHANGELOG.md?raw";

/** Only return the exact released version; never show unreleased or another version's notes. */
export function getBundledReleaseNotes(version: string): string {
  const target = version.trim().replace(/^v/i, "");
  const lines = changelog.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const heading = /^##\s+\[([^\]]+)\]/.exec(lines[i]);
    if (!heading) continue;
    if (start !== -1) return lines.slice(start, i).join("\n").trim();
    if (heading[1].replace(/^v/i, "") === target) start = i + 1;
  }
  return start === -1 ? "" : lines.slice(start).join("\n").trim();
}

function inlineNotes(text: string): ReactNode[] {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return createElement(
        "code",
        {
          key: index,
          className: "rounded bg-surface-hover px-1 py-0.5 font-mono text-xs text-ink-primary",
        },
        part.slice(1, -1),
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return createElement(
        "strong",
        { key: index, className: "font-medium text-ink-primary" },
        inlineNotes(part.slice(2, -2)),
      );
    }
    return part;
  });
}

/** A deliberately small Markdown subset. HTML, links and images remain inert text. */
export function renderReleaseNotes(notes: string): ReactNode[] {
  const lines = notes.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }
    const heading = /^###\s+(.+)$/.exec(line);
    if (heading) {
      nodes.push(createElement(
        "h3",
        { key: index, className: "pt-1 text-sm font-medium text-ink-primary" },
        inlineNotes(heading[1]),
      ));
      index += 1;
      continue;
    }
    const bullet = /^(?:[-*+]\s+|\d+\.\s+)(.+)$/.exec(line);
    if (bullet) {
      const start = index;
      const ordered = /^\d+\./.test(line);
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = /^(?:[-*+]\s+|\d+\.\s+)(.+)$/.exec(lines[index].trim());
        if (!item || /^\d+\./.test(lines[index].trim()) !== ordered) break;
        const itemKey = index;
        let text = item[1];
        index += 1;
        while (index < lines.length && /^\s+\S/.test(lines[index]) &&
          !/^(?:[-*+]\s+|\d+\.\s+|###\s+)/.test(lines[index].trim())) {
          text += `\n${lines[index].trim()}`;
          index += 1;
        }
        items.push(createElement("li", { key: itemKey, className: "pl-1" }, inlineNotes(text)));
      }
      nodes.push(createElement(
        ordered ? "ol" : "ul",
        { key: start, className: `${ordered ? "list-decimal" : "list-disc"} space-y-2 pl-5` },
        items,
      ));
      continue;
    }
    const start = index;
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() &&
      !/^(?:###\s+|[-*+]\s+|\d+\.\s+)/.test(lines[index].trim())) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    nodes.push(createElement(
      "p",
      { key: start, className: "whitespace-pre-wrap" },
      inlineNotes(paragraph.join("\n")),
    ));
  }
  return nodes;
}
