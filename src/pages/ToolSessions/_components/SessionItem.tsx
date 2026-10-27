import { memo } from "react";
import { ClaudeCode, Codex, OpenCode } from "@lobehub/icons";

import ompLogoUrl from "@/assets/svg/about/omp-logo.svg";
import piLogoUrl from "@/assets/svg/about/pi-logo.svg";
import { cn } from "@/lib/utils";
import type { ToolSessionMeta } from "@/services/modules/toolSessions";

import {
  formatRelativeTime,
  formatSessionTitle,
  getProviderLabel,
  getSessionKey,
  highlightText,
} from "./utils";

export function ProviderLogo({
  providerId,
  size = 18,
}: {
  providerId: string;
  size?: number;
}) {
  const isPi = providerId === "pi";
  return (
    <img
      src={isPi ? piLogoUrl : ompLogoUrl}
      alt=""
      className={cn(
        "shrink-0 object-contain",
        // pi.svg 用 currentColor，作为 <img> 固定为黑；深色主题反色成白。omp 是品牌渐变，不反色。
        isPi && "dark:invert",
      )}
      style={{ width: size, height: size }}
    />
  );
}

function ProviderGlyph({ providerId }: { providerId: string }) {
  if (providerId === "claude") {
    return <ClaudeCode.Color size={18} />;
  }
  if (providerId === "codex") {
    return <Codex.Color size={18} />;
  }
  if (providerId === "opencode") {
    return <OpenCode size={18} />;
  }
  if (providerId === "pi" || providerId === "omp") {
    return <ProviderLogo providerId={providerId} size={18} />;
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
  onToggleChecked: (sessionKey: string, checked: boolean) => void;
}

export const SessionItem = memo(function SessionItem({
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
        "[content-visibility:auto] [contain-intrinsic-size:auto_2.75rem]",
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
            onChange={(e) => onToggleChecked(sessionKey, e.target.checked)}
          />
        </div>
      )}
      <button
        type="button"
        onClick={() => onSelect(sessionKey)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span className="shrink-0" title={getProviderLabel(session.providerId)}>
          <ProviderGlyph providerId={session.providerId} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">
          {searchQuery ? highlightText(title, searchQuery) : title}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatRelativeTime(lastActive)}
        </span>
      </button>
    </div>
  );
});
