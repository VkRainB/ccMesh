import {
  BotIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  UserIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { BranchMessage } from "@/services/modules/chat";

function formatMsgTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Props = {
  msg: BranchMessage;
  busy: boolean;
  onRegenerate: (m: BranchMessage) => void;
  onSwitchSibling: (m: BranchMessage, dir: -1 | 1) => void;
};

/** 消息气泡：用户右对齐 / 助手左对齐，带头像、角色名与时间。 */
export function MessageBubble({
  msg,
  busy,
  onRegenerate,
  onSwitchSibling,
}: Props) {
  const isUser = msg.role === "user";
  const isError = msg.status === "error";
  const showBranch = !isUser && msg.siblingCount > 1;
  const showRegen =
    !isUser && (msg.status === "success" || msg.status === "error") && !busy;
  const time = formatMsgTime(msg.createdAt);
  const displayName = isUser ? "我" : "助手";
  const body =
    msg.content ||
    (msg.status === "pending" || msg.status === "streaming" ? "…" : "");

  return (
    <div
      className={cn(
        "flex w-full gap-2.5",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-primary/15 text-primary"
            : "bg-surface-hover text-ink-secondary",
        )}
        aria-hidden
      >
        {isUser ? (
          <UserIcon className="size-4" />
        ) : (
          <BotIcon className="size-4" />
        )}
      </div>

      <div
        className={cn(
          "flex min-w-0 max-w-[75%] flex-col gap-1",
          isUser ? "items-end" : "items-start",
        )}
      >
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-2 gap-y-0.5 px-0.5 text-[11px] text-ink-mute",
            isUser && "flex-row-reverse",
          )}
        >
          <span className="font-medium text-ink-secondary">{displayName}</span>
          {time && <span title={new Date(msg.createdAt).toLocaleString()}>{time}</span>}
        </div>

        <div
          className={cn(
            "rounded-lg px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap",
            isUser
              ? "bg-primary/12 text-ink-primary"
              : "border border-edge bg-surface-card text-ink-primary",
            isError && "border-destructive/40 text-destructive",
          )}
        >
          {body}
        </div>

        {(showBranch || showRegen) && (
          <div className="flex items-center gap-1 px-0.5 text-ink-mute">
            {showBranch && (
              <>
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-surface-hover disabled:opacity-30"
                  disabled={msg.siblingIndex <= 0 || busy}
                  onClick={() => onSwitchSibling(msg, -1)}
                  title="上一分支"
                  aria-label="上一分支"
                >
                  <ChevronLeftIcon className="size-3.5" />
                </button>
                <span className="min-w-[2.5rem] text-center text-[11px] tabular-nums">
                  {msg.siblingIndex + 1}/{msg.siblingCount}
                </span>
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-surface-hover disabled:opacity-30"
                  disabled={msg.siblingIndex >= msg.siblingCount - 1 || busy}
                  onClick={() => onSwitchSibling(msg, 1)}
                  title="下一分支"
                  aria-label="下一分支"
                >
                  <ChevronRightIcon className="size-3.5" />
                </button>
              </>
            )}
            {showRegen && (
              <button
                type="button"
                className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-surface-hover"
                onClick={() => onRegenerate(msg)}
                title="重新生成"
              >
                <RefreshCwIcon className="size-3" />
                重生成
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
