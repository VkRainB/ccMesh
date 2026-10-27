import { memo, useState, type ReactNode } from "react";
import { ChevronRight, Terminal, Wrench } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ToolSessionMessage } from "@/services/modules/toolSessions";

import {
  groupClaudeSegments,
  parseClaudeBlocks,
  type ClaudeBlock,
  type ClaudeSegment,
} from "./claudeBlocks";
import { clipMarkdown, MarkdownText } from "./MarkdownText";
import { formatTimestamp, highlightText } from "./utils";

const PREVIEW_CHARS = 500;

function Fold({
  icon,
  label,
  summary,
  body,
  searchQuery,
}: {
  icon: ReactNode;
  label: string;
  summary?: string;
  body?: string;
  searchQuery?: string;
}) {
  const searchable = `${summary ?? ""}\n${body ?? ""}`;
  const forceOpen = !!searchQuery && searchable.toLowerCase().includes(searchQuery.toLowerCase());
  const [open, setOpen] = useState(false);
  const expanded = open || forceOpen;
  const extra = body && body !== summary ? body : "";
  return (
    <div className="min-w-0">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted/70"
        aria-expanded={extra ? expanded : undefined}
        onClick={() => extra && setOpen((v) => !v)}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && extra && "rotate-90",
            !extra && "invisible",
          )}
        />
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span className="shrink-0 font-medium">{label}</span>
        {summary ? (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {searchQuery ? highlightText(summary, searchQuery) : summary}
          </span>
        ) : (
          <span className="flex-1" />
        )}
      </button>
      {expanded && extra ? (
        <pre className="max-h-64 overflow-auto px-8 pb-2 font-sans text-xs leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
          {searchQuery ? highlightText(extra, searchQuery) : extra}
        </pre>
      ) : null}
    </div>
  );
}

function TextBlock({
  kind,
  text,
  ts,
  searchQuery,
  speaker = "Claude",
}: {
  kind: "user" | "assistant";
  text: string;
  ts?: number;
  searchQuery?: string;
  speaker?: string;
}) {
  const [open, setOpen] = useState(false);
  const long = text.length > PREVIEW_CHARS;
  const shown = long && !open ? clipMarkdown(text, PREVIEW_CHARS) : text;
  const user = kind === "user";
  return (
    <div className={cn("flex", user ? "justify-end" : "justify-start")}>
      <div className={cn("min-w-0 max-w-[92%]", user ? "items-end" : "items-start")}>
        <div
          className={cn(
            "mb-1 flex items-center gap-2 text-[11px] text-muted-foreground",
            user && "justify-end",
          )}
        >
          <span className={cn("font-medium", user ? "text-emerald-600" : "text-blue-600")}>
            {user ? "用户" : speaker}
          </span>
          {ts ? <span>{formatTimestamp(ts)}</span> : null}
        </div>
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2.5 text-sm break-words text-foreground",
            user
              ? "rounded-br-sm bg-primary/10"
              : "rounded-bl-sm bg-muted",
          )}
        >
          <MarkdownText text={shown} query={searchQuery} />
          {long ? (
            <button
              type="button"
              className="mt-1 block text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "收起" : "展开"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function BlockView({
  block,
  ts,
  searchQuery,
}: {
  block: ClaudeBlock;
  ts?: number;
  searchQuery?: string;
}) {
  if (block.kind === "user" || block.kind === "assistant") {
    return (
      <TextBlock kind={block.kind} text={block.text} ts={ts} searchQuery={searchQuery} />
    );
  }
  if (block.kind === "tool") {
    return (
      <Fold
        icon={<Wrench className="size-3.5" />}
        label={block.name}
        summary={block.summary}
        searchQuery={searchQuery}
      />
    );
  }
  if (block.kind === "command") {
    return (
      <Fold
        icon={<Terminal className="size-3.5" />}
        label={block.name}
        summary={block.detail}
        searchQuery={searchQuery}
      />
    );
  }
  if (block.kind !== "output") return null;
  const first = block.text.split("\n")[0] ?? "";
  return (
    <Fold
      icon={<Terminal className="size-3.5" />}
      label={block.label}
      summary={first}
      body={block.text}
      searchQuery={searchQuery}
    />
  );
}

function toolLabel(block: ClaudeBlock) {
  if (block.kind === "tool" || block.kind === "command") return block.name;
  if (block.kind === "output") return block.label;
  return "";
}

function toolSummary(block: ClaudeBlock) {
  if (block.kind === "tool") return block.summary;
  if (block.kind === "command") return block.detail;
  if (block.kind === "output") return block.text.split("\n")[0] ?? "";
  return "";
}

function ToolGroup({
  blocks,
  searchQuery,
}: {
  blocks: ClaudeBlock[];
  searchQuery?: string;
}) {
  const [open, setOpen] = useState(false);
  const preview = blocks
    .map((block) => [toolLabel(block), toolSummary(block)].filter(Boolean).join(" "))
    .join("\n");
  const forceOpen =
    !!searchQuery && preview.toLowerCase().includes(searchQuery.toLowerCase());
  const expanded = open || forceOpen;
  if (blocks.length < 2) {
    return (
      <>
        {blocks.map((block, i) => (
          <BlockView key={i} block={block} searchQuery={searchQuery} />
        ))}
      </>
    );
  }
  return (
    <div className="min-w-0">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted/70"
        aria-expanded={expanded}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
        <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium">工具调用 {blocks.length}</span>
      </button>
      {expanded ? (
        <div className="space-y-0.5 pl-2">
          {blocks.map((block, i) => (
            <BlockView key={i} block={block} searchQuery={searchQuery} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SegmentView({
  segment,
  searchQuery,
  speaker,
}: {
  segment: ClaudeSegment;
  searchQuery?: string;
  speaker: string;
}) {
  if (segment.kind === "text") {
    return (
      <TextBlock
        kind={segment.block.kind}
        text={segment.block.text}
        ts={segment.ts}
        searchQuery={searchQuery}
        speaker={speaker}
      />
    );
  }
  return <ToolGroup blocks={segment.blocks} searchQuery={searchQuery} />;
}

export const ClaudeTranscript = memo(function ClaudeTranscript({
  items,
  searchQuery,
  registerRef,
  speaker = "Claude",
}: {
  items: { index: number; role: string; content: string; ts?: number }[];
  searchQuery?: string;
  registerRef?: (index: number, el: HTMLDivElement | null) => void;
  speaker?: string;
}) {
  const segments = groupClaudeSegments(items);
  return (
    <>
      {segments.map((segment, i) => {
        const indexes = segment.kind === "text" ? [segment.index] : segment.indexes;
        return (
          <div
            key={i}
            ref={(el) => indexes.forEach((index) => registerRef?.(index, el))}
          >
            <SegmentView segment={segment} searchQuery={searchQuery} speaker={speaker} />
          </div>
        );
      })}
    </>
  );
});

export const ClaudeMessageItem = memo(function ClaudeMessageItem({
  message,
  searchQuery,
}: {
  message: ToolSessionMessage;
  searchQuery?: string;
}) {
  const blocks = parseClaudeBlocks(message.role, message.content);
  if (blocks.length === 0) return null;
  return (
    <div className="min-w-0 space-y-1">
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} ts={message.ts} searchQuery={searchQuery} />
      ))}
    </div>
  );
});
