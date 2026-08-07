import { ChevronRight, Clock } from "lucide-react";
import { ClaudeCode, Codex } from "@lobehub/icons";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ToolSessionMeta } from "@/services/modules/toolSessions";

import {
  formatRelativeTime,
  formatSessionTitle,
  getProviderLabel,
  getSessionKey,
  highlightText,
} from "./utils";

function ProviderGlyph({ providerId }: { providerId: string }) {
  if (providerId === "claude") {
    return <ClaudeCode.Color size={18} />;
  }
  if (providerId === "codex") {
    return <Codex.Color size={18} />;
  }
  return (
    <span className="inline-flex size-[18px] items-center justify-center rounded-full bg-muted text-[10px]">
      {providerId.slice(0, 1).toUpperCase()}
    </span>
  );
}

interface SessionItemProps {
  session: ToolSessionMeta;
  isSelected: boolean;
  selectionMode: boolean;
  isChecked: boolean;
  searchQuery?: string;
  onSelect: (key: string) => void;
  onToggleChecked: (checked: boolean) => void;
}

export function SessionItem({
  session,
  isSelected,
  selectionMode,
  isChecked,
  searchQuery,
  onSelect,
  onToggleChecked,
}: SessionItemProps) {
  const title = formatSessionTitle(session);
  const lastActive = session.lastActiveAt || session.createdAt;
  const sessionKey = getSessionKey(session);

  return (
    <div
      className={cn(
        "group flex items-start gap-2 rounded-lg border px-3 py-2.5 transition-all",
        isSelected
          ? "border-primary/30 bg-primary/10"
          : "border-transparent hover:bg-muted/60",
      )}
    >
      {selectionMode && (
        <div className="shrink-0 pt-0.5">
          <input
            type="checkbox"
            checked={isChecked}
            aria-label="选择会话"
            className="size-3.5 accent-primary"
            onChange={(e) => onToggleChecked(e.target.checked)}
          />
        </div>
      )}
      <button
        type="button"
        onClick={() => onSelect(sessionKey)}
        className="min-w-0 flex-1 text-left"
      >
        <div className="mb-1 flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="shrink-0">
                <ProviderGlyph providerId={session.providerId} />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {getProviderLabel(session.providerId)}
            </TooltipContent>
          </Tooltip>
          <span className="line-clamp-2 flex-1 text-sm font-medium">
            {searchQuery ? highlightText(title, searchQuery) : title}
          </span>
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground/50 transition-transform",
              isSelected && "rotate-90 text-primary",
            )}
          />
        </div>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="size-3" />
          <span>{formatRelativeTime(lastActive)}</span>
        </div>
      </button>
    </div>
  );
}
