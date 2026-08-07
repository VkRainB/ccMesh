import { useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUpIcon,
  Maximize2Icon,
  Minimize2Icon,
  SquareIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores";

import {
  COMPOSER_EXPAND_RATIO,
  COMPOSER_MAX_PX,
  COMPOSER_MIN_PX,
  clampComposerHeight,
  shellFromContent,
} from "./composerLayout";

type Props = {
  value: string;
  disabled?: boolean;
  busy: boolean;
  /** Chat 主列容器，用于计算展开高度。 */
  columnEl: HTMLElement | null;
  onChange: (v: string) => void;
  onSend: () => void;
  onAbort: () => void;
};

export function ComposerBar({
  value,
  disabled,
  busy,
  columnEl,
  onChange,
  onSend,
  onAbort,
}: Props) {
  const heightPx = useLayoutStore((s) => s.chatComposerHeightPx);
  const expanded = useLayoutStore((s) => s.chatComposerExpanded);
  const setHeightPx = useLayoutStore((s) => s.setChatComposerHeightPx);
  const setExpanded = useLayoutStore((s) => s.setChatComposerExpanded);

  const cardRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    startH: number;
  } | null>(null);
  const prevValueRef = useRef(value);

  const [dragH, setDragH] = useState<number | null>(null);
  const [columnH, setColumnH] = useState(0);
  const [resizeHover, setResizeHover] = useState(false);
  const [expandHover, setExpandHover] = useState(false);

  useLayoutEffect(() => {
    if (!columnEl) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      setColumnH(h);
    });
    ro.observe(columnEl);
    setColumnH(columnEl.clientHeight);
    return () => ro.disconnect();
  }, [columnEl]);

  // 仅在输入变化时增高；收缩到 MIN 后不会被已有内容顶回去
  useLayoutEffect(() => {
    const valueChanged = prevValueRef.current !== value;
    prevValueRef.current = value;
    if (!valueChanged) return;
    const ta = taRef.current;
    if (!ta || expanded || dragH != null) return;
    const prev = ta.style.height;
    ta.style.height = "0px";
    const needed = shellFromContent(ta.scrollHeight);
    ta.style.height = prev;
    const current = useLayoutStore.getState().chatComposerHeightPx;
    if (needed > current) setHeightPx(needed);
  }, [value, expanded, dragH, setHeightPx]);

  const expandH = Math.round(Math.max(columnH, 320) * COMPOSER_EXPAND_RATIO);
  const shellPx = expanded
    ? expandH
    : (dragH ?? clampComposerHeight(heightPx));

  const onDragPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (expanded) return;
    e.preventDefault();
    const startH = cardRef.current?.offsetHeight ?? shellPx;
    dragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startH,
    };
    setDragH(startH);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDragPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    // 手往上 → 变高；用起始差值，避免用不断变化的 bottom 造成抖动
    const next = clampComposerHeight(
      d.startH + (d.startY - e.clientY),
      COMPOSER_MAX_PX,
    );
    setDragH(next);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    // 用事件坐标结算，避免闭包里的 dragH 过期
    const finalH = clampComposerHeight(
      d.startH + (d.startY - e.clientY),
      COMPOSER_MAX_PX,
    );
    dragRef.current = null;
    setDragH(null);
    setHeightPx(finalH);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    // 捕获结束后清 hover，避免顶中指示条粘住
    setResizeHover(false);
  };

  const toggleExpand = () => {
    if (expanded) {
      // 收缩：回到底部单行最小值（内容超出则内部滚动）
      setExpanded(false);
      setHeightPx(COMPOSER_MIN_PX);
    } else {
      setExpanded(true);
    }
    setExpandHover(false);
  };

  const canSend = !!value.trim() && !disabled && !busy;
  const ExpandIcon = expanded ? Minimize2Icon : Maximize2Icon;
  const resizing = dragH != null;

  return (
    <div className="px-5 pb-4 pt-2">
      <div
        ref={cardRef}
        className={cn(
          "relative mx-auto flex max-w-3xl flex-col overflow-hidden rounded-2xl border border-edge bg-surface-card shadow-sm",
          // 拖拽时关掉过渡，否则必然不跟手
          !resizing && "transition-[height] duration-200",
        )}
        style={{ height: shellPx }}
      >
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="拖拽调整输入框高度"
          title={expanded ? "展开时不可拖拽" : "拖拽调整高度"}
          className={cn(
            "flex h-3 shrink-0 items-center justify-center",
            expanded ? "cursor-default" : "cursor-ns-resize",
          )}
          onPointerEnter={() => !expanded && setResizeHover(true)}
          onPointerLeave={() => {
            if (!dragRef.current) setResizeHover(false);
          }}
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {/* 顶中指示条：仅 hover/拖拽时显示，离开即隐 */}
          <span
            className={cn(
              "h-1 w-8 rounded-full bg-ink-mute/35 transition-opacity duration-150",
              resizeHover || resizing ? "opacity-100" : "opacity-0",
            )}
          />
        </div>

        {/* Cherry 式右上角：默认 L 描边；hover 隐藏 L、露出圆钮 */}
        <div
          data-composer-expand-corner=""
          className="absolute top-px right-px z-10 size-8"
          onPointerEnter={() => setExpandHover(true)}
          onPointerLeave={() => setExpandHover(false)}
        >
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute top-1 right-1 size-3 origin-top-right rounded-tr-[14px]",
              "border-t-[1.5px] border-r-[1.5px] border-ink-mute/55",
              "transition-[opacity,transform] duration-150 ease-out",
              expandHover
                ? "scale-50 opacity-0"
                : "scale-100 opacity-70",
            )}
          />
          <button
            type="button"
            onClick={toggleExpand}
            onBlur={() => setExpandHover(false)}
            aria-pressed={expanded}
            aria-label={expanded ? "收起输入框" : "展开输入框"}
            className={cn(
              "absolute top-1 right-1 flex size-[22px] items-center justify-center rounded-full",
              "text-ink-mute transition-[opacity,transform,background-color,color] duration-150 ease-out",
              "hover:bg-surface-hover hover:text-ink-primary focus-visible:outline-none",
              expandHover
                ? "pointer-events-auto translate-x-0 translate-y-0 scale-100 bg-surface-hover/80 text-ink-primary opacity-100"
                : "pointer-events-none translate-x-2 -translate-y-2 scale-75 opacity-0",
            )}
          >
            <ExpandIcon className="size-3" />
          </button>
        </div>

        <textarea
          ref={taRef}
          className="scrollbar-none min-h-0 w-full flex-1 resize-none overflow-y-auto bg-transparent px-3 py-1 pr-8 text-sm text-ink-primary outline-none placeholder:text-ink-mute disabled:opacity-50"
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            window.setTimeout(() => {
              composingRef.current = false;
            }, 0);
          }}
          onKeyDown={(e) => {
            if (
              e.nativeEvent.isComposing ||
              e.keyCode === 229 ||
              composingRef.current
            ) {
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
        />

        <div className="flex shrink-0 items-center justify-end gap-1 px-2 pb-2">
          {busy ? (
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              onClick={onAbort}
              title="停止"
              aria-label="停止生成"
            >
              <SquareIcon className="size-3" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon-xs"
              disabled={!canSend}
              onClick={onSend}
              title="发送"
              aria-label="发送"
            >
              <ArrowUpIcon className="size-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
