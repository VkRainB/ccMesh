import { memo, useState } from "react";
import { ChevronDown, ChevronUp, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ToolSessionMessage } from "@/services/modules/toolSessions";

import {
  formatTimestamp,
  getRoleLabel,
  getRoleTone,
  highlightText,
} from "./utils";

const COLLAPSE_THRESHOLD = 3000;
const COLLAPSED_LENGTH = 1500;

interface SessionMessageItemProps {
  message: ToolSessionMessage;
  isActive?: boolean;
  searchQuery?: string;
  onCopy: (content: string) => void;
}

export const SessionMessageItem = memo(function SessionMessageItem({
  message,
  isActive,
  searchQuery,
  onCopy,
}: SessionMessageItemProps) {
  const [expanded, setExpanded] = useState(false);
  const isLong = message.content.length > COLLAPSE_THRESHOLD;
  const hasSearchMatch =
    isLong &&
    !expanded &&
    !!searchQuery &&
    message.content.toLowerCase().includes(searchQuery.toLowerCase());
  const collapsed = isLong && !expanded && !hasSearchMatch;
  const displayContent = collapsed
    ? `${message.content.slice(0, COLLAPSED_LENGTH)}…`
    : message.content;

  return (
    <div
      className={cn(
        "group relative min-w-0 rounded-lg border px-3 py-2.5 transition-shadow",
        message.role.toLowerCase() === "user"
          ? "ml-8 border-primary/20 bg-primary/5"
          : message.role.toLowerCase() === "assistant"
            ? "mr-8 border-blue-500/20 bg-blue-500/5"
            : "border-border/60 bg-muted/40",
        isActive && "ring-2 ring-primary ring-offset-2",
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 size-6 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={() => onCopy(message.content)}
          >
            <Copy className="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>复制内容</TooltipContent>
      </Tooltip>
      <div className="mb-1.5 flex items-center justify-between pr-6 text-xs">
        <span className={cn("font-semibold", getRoleTone(message.role))}>
          {getRoleLabel(message.role)}
        </span>
        {message.ts ? (
          <span className="text-muted-foreground">
            {formatTimestamp(message.ts)}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 text-sm leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
        {searchQuery
          ? highlightText(displayContent, searchQuery)
          : displayContent}
      </div>
      {isLong && !hasSearchMatch ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? (
            <>
              <ChevronUp className="size-3" />
              收起
            </>
          ) : (
            <>
              <ChevronDown className="size-3" />
              展开完整内容
              <span className="text-muted-foreground/60">
                ({Math.round(message.content.length / 1000)}k)
              </span>
            </>
          )}
        </button>
      ) : null}
    </div>
  );
});
