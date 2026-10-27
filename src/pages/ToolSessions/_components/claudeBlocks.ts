export type ClaudeBlock =
  | { kind: "user" | "assistant"; text: string }
  | { kind: "tool"; name: string; summary: string }
  | { kind: "command"; name: string; detail: string }
  | { kind: "output"; label: string; text: string };

const TOOL_LINE = /^\[Tool: ([^\]]+)\]\s*(.*)$/;

export function isToolishBlock(block: ClaudeBlock) {
  return block.kind === "tool" || block.kind === "command" || block.kind === "output";
}

export type ClaudeSegment =
  | { kind: "text"; index: number; ts?: number; block: Extract<ClaudeBlock, { kind: "user" | "assistant" }> }
  | { kind: "tools"; indexes: number[]; blocks: ClaudeBlock[] };

/** 连续的工具调用、命令和结果并成一段；单独一条不包组。 */
export function groupClaudeSegments(
  items: { index: number; role: string; content: string; ts?: number }[],
): ClaudeSegment[] {
  const segments: ClaudeSegment[] = [];
  let run: { indexes: number[]; blocks: ClaudeBlock[] } | null = null;
  const flush = () => {
    if (!run || run.blocks.length === 0) {
      run = null;
      return;
    }
    if (run.blocks.length === 1) {
      const block = run.blocks[0];
      if (block.kind === "user" || block.kind === "assistant") {
        segments.push({ kind: "text", index: run.indexes[0], block });
      } else {
        segments.push({ kind: "tools", indexes: run.indexes, blocks: run.blocks });
      }
    } else {
      segments.push({ kind: "tools", indexes: [...run.indexes], blocks: run.blocks });
    }
    run = null;
  };

  for (const item of items) {
    const blocks = parseClaudeBlocks(item.role, item.content);
    for (const block of blocks) {
      if (isToolishBlock(block)) {
        run ??= { indexes: [], blocks: [] };
        if (!run.indexes.includes(item.index)) run.indexes.push(item.index);
        run.blocks.push(block);
      } else if (block.kind === "user" || block.kind === "assistant") {
        flush();
        segments.push({ kind: "text", index: item.index, ts: item.ts, block });
      }
    }
  }
  flush();
  return segments;
}

export function stripAnsi(text: string) {
  return text.replace(/\u001b\[[0-9;]*m/g, "").replace(/\[\d+m/g, "");
}

/** 斜杠命令回显和本地命令包装，不是用户自己写的话。 */
export function isClaudeChrome(text: string) {
  return /<local-command-|<command-name>|<command-message>/.test(text);
}

function tag(text: string, name: string) {
  return new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim() ?? "";
}

/** 把 Claude 消息拆成用户原文、助手原文、折叠的工具调用和命令回显。 */
export function parseClaudeBlocks(role: string, content: string): ClaudeBlock[] {
  const cleaned = stripAnsi(content).trim();
  if (!cleaned || cleaned.includes("<local-command-caveat>")) return [];

  const normalized = role.toLowerCase();
  if (normalized === "tool") {
    return [{ kind: "output", label: "工具结果", text: cleaned }];
  }

  const commandName = tag(cleaned, "command-name");
  if (commandName) {
    const detail = [tag(cleaned, "command-message"), tag(cleaned, "command-args")]
      .filter(Boolean)
      .join(" ");
    return [{ kind: "command", name: commandName, detail }];
  }

  const stdout = tag(cleaned, "local-command-stdout");
  if (stdout && cleaned.includes("<local-command-stdout>")) {
    return [{ kind: "output", label: "命令输出", text: stdout }];
  }
  const stderr = tag(cleaned, "local-command-stderr");
  if (stderr && cleaned.includes("<local-command-stderr>")) {
    return [{ kind: "output", label: "命令错误", text: stderr }];
  }

  const blocks: ClaudeBlock[] = [];
  const textLines: string[] = [];
  const flush = () => {
    const text = textLines.join("\n").trim();
    textLines.length = 0;
    if (!text) return;
    blocks.push({
      kind: normalized === "assistant" ? "assistant" : "user",
      text,
    });
  };
  for (const line of cleaned.split("\n")) {
    const match = TOOL_LINE.exec(line.trim());
    if (match) {
      flush();
      blocks.push({ kind: "tool", name: match[1], summary: match[2] });
    } else {
      textLines.push(line);
    }
  }
  flush();
  return blocks;
}
