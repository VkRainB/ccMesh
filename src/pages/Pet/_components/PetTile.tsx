import { useEffect, useRef, useState } from "react";
import { CheckIcon, PawPrintIcon, Trash2Icon } from "lucide-react";

import { petSpritesheetUrl } from "@/lib/petAsset";
import {
  containSize,
  FALLBACK_FRAMES,
  frameAspectRatio,
  frameSheetStyle,
} from "@/lib/petSprite";
import { cn } from "@/lib/utils";
import type { PetListItem } from "@/services/modules/pet";

interface Props {
  pet: PetListItem;
  selected?: boolean;
  onSelect?: () => void;
  onDelete?: () => void;
}

/** 宠物卡片：整体 2:3 竖卡，图片区显示精灵图首帧（无 frames 时用 Codex 默认 8×9）。 */
export function PetTile({
  pet,
  selected = false,
  onSelect,
  onDelete,
}: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const [frameAr, setFrameAr] = useState<number | null>(null);
  const [frameBox, setFrameBox] = useState<{ w: number; h: number } | null>(
    null,
  );
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setImgFailed(false);
    setFrameAr(null);
    setFrameBox(null);
  }, [pet.spritesheetPath]);

  // 按预览区实测尺寸做 contain，避免 CSS aspect-ratio + maxWidth 在窄高盒子里失效变形
  useEffect(() => {
    const el = previewRef.current;
    if (!el || frameAr == null) return;
    const update = () => {
      const { clientWidth: cw, clientHeight: ch } = el;
      setFrameBox(containSize(cw, ch, frameAr));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [frameAr]);

  const url = petSpritesheetUrl(pet.spritesheetPath);
  // 缺省 frames 时用 Codex 默认 8×9（与后端 load_pet_item 一致）
  const frames = pet.frames ?? FALLBACK_FRAMES;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`选择宠物 ${pet.displayName}`}
      className={cn(
        "group relative flex aspect-[2/3] w-full cursor-pointer flex-col overflow-hidden rounded-lg",
        "bg-surface-card text-left transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        selected
          ? "border-2 border-primary"
          : "border border-edge hover:border-edge-strong hover:bg-surface-hover",
      )}
    >
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <div
          ref={previewRef}
          className="relative h-full w-full overflow-hidden rounded-md bg-[repeating-conic-gradient(#e5e5e5_0%_25%,#fff_0%_50%)] bg-[length:14px_14px] dark:bg-[repeating-conic-gradient(#2a2a2e_0%_25%,#181818_0%_50%)]"
        >
          {selected ? (
            <span
              className="absolute left-1.5 top-1.5 z-10 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground"
              aria-hidden
            >
              <CheckIcon className="size-2.5 stroke-[3]" />
            </span>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              aria-label={`删除宠物 ${pet.displayName}`}
              className={cn(
                "absolute right-1.5 top-1.5 z-10 flex size-6 items-center justify-center rounded-md",
                "bg-surface-card/90 text-ink-mute shadow-sm",
                "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
                "hover:bg-destructive/10 hover:text-destructive",
                "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              )}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2Icon className="size-3.5" />
            </button>
          ) : null}
          {imgFailed ? (
            <PawPrintIcon
              className="absolute inset-0 m-auto size-8 text-ink-disabled"
              aria-hidden
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="relative overflow-hidden"
                style={
                  frameBox && frameBox.w > 0
                    ? { width: frameBox.w, height: frameBox.h }
                    : { width: "100%", height: "100%" }
                }
              >
                <img
                  src={url}
                  alt=""
                  aria-hidden
                  className="absolute left-0 top-0"
                  style={frameSheetStyle(frames.cols, frames.rows, 0, 0)}
                  onLoad={(e) => {
                    const { naturalWidth: w, naturalHeight: h } =
                      e.currentTarget;
                    if (w > 0 && h > 0) {
                      setFrameAr(
                        frameAspectRatio(w, h, frames.cols, frames.rows),
                      );
                    }
                  }}
                  onError={() => setImgFailed(true)}
                />
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-1 px-3 pb-3">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-ink-primary">
            {pet.displayName}
          </p>
          {pet.tag ? (
            <span className="shrink-0 rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium leading-none text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
              {pet.tag}
            </span>
          ) : null}
        </div>
        {pet.description ? (
          <p className="truncate text-xs text-ink-mute">{pet.description}</p>
        ) : (
          <p className="truncate text-xs text-ink-disabled">暂无描述</p>
        )}
      </div>
    </button>
  );
}
