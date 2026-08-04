import { useEffect, useRef, useState } from "react";

import { petSpritesheetUrl } from "@/lib/petAsset";
import {
  actionFromDrag,
  DRAG_DEADZONE,
  FALLBACK_FRAMES,
  frameSheetStyle,
  PET_ACTIONS,
  rowCount,
  type PetAction,
} from "@/lib/petSprite";
import { cn } from "@/lib/utils";
import type { PetListItem } from "@/services/modules/pet";

interface Props {
  /** 宠物列表项（含 spritesheetPath + frames）。 */
  pet: PetListItem;
  /**
   * 强制播放某一行动作（0–8）；缺省时由拖拽/点击自动切换。
   * 用于任务态（failed/running/review）外部驱动。
   */
  actionRow?: number;
  /** 精灵显示尺寸，默认 h-24（宽由帧比例推，避免方形拉伸）。 */
  className?: string;
}

type DragSession = {
  sx: number;
  sy: number;
  bx: number;
  by: number;
  moved: boolean;
};

/**
 * 动效宠物：Codex 9 行动画 + 容器内拖拽。
 * - 静止 → idle
 * - 拖右/左 → runningRight / runningLeft
 * - 拖上/下 → jumping / waiting
 * - 轻点（几乎无位移）→ waving，片刻后回 idle
 */
export function PetSprite({ pet, actionRow, className }: Props) {
  const frames = pet.frames ?? FALLBACK_FRAMES;
  const url = petSpritesheetUrl(pet.spritesheetPath);
  const [col, setCol] = useState(0);
  const [action, setAction] = useState<PetAction>("idle");
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<DragSession | null>(null);
  const waveTimerRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const spriteRef = useRef<HTMLDivElement>(null);

  const row = actionRow ?? PET_ACTIONS[action];

  // 换行动作时从第 0 帧重播。
  useEffect(() => {
    setCol(0);
  }, [row]);

  // 逐帧动画：按 fps 循环该行实际帧数。
  useEffect(() => {
    const total = rowCount(frames, row);
    if (frames.fps <= 0 || total <= 1) return;
    const id = window.setInterval(
      () => setCol((c) => (c + 1) % total),
      1000 / frames.fps,
    );
    return () => window.clearInterval(id);
  }, [frames, row]);

  // 挂载后定位到容器右下角。
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const c = containerRef.current;
      const s = spriteRef.current;
      if (!c || !s) return;
      setPos({
        x: Math.max(0, c.clientWidth - s.clientWidth),
        y: Math.max(0, c.clientHeight - s.clientHeight),
      });
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(
    () => () => {
      if (waveTimerRef.current != null) {
        window.clearTimeout(waveTimerRef.current);
      }
    },
    [],
  );

  const clearWaveTimer = () => {
    if (waveTimerRef.current != null) {
      window.clearTimeout(waveTimerRef.current);
      waveTimerRef.current = null;
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    clearWaveTimer();
    dragRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      bx: pos.x,
      by: pos.y,
      moved: false,
    };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const c = containerRef.current;
    const s = spriteRef.current;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) >= DRAG_DEADZONE || Math.abs(dy) >= DRAG_DEADZONE) {
      d.moved = true;
    }
    let nx = d.bx + dx;
    let ny = d.by + dy;
    if (c && s) {
      nx = Math.max(0, Math.min(nx, c.clientWidth - s.clientWidth));
      ny = Math.max(0, Math.min(ny, c.clientHeight - s.clientHeight));
    }
    setPos({ x: nx, y: ny });
    // 外部强制 actionRow 时不抢动画控制权。
    if (actionRow == null) {
      setAction(actionFromDrag(dx, dy));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    if (actionRow != null) return;

    if (d && !d.moved) {
      // 轻点：挥手打招呼，约一轮后回待机。
      setAction("waving");
      clearWaveTimer();
      waveTimerRef.current = window.setTimeout(() => {
        setAction("idle");
        waveTimerRef.current = null;
      }, 900);
      return;
    }
    setAction("idle");
  };

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <div
        ref={spriteRef}
        className={cn(
          "absolute left-0 top-0 overflow-hidden touch-none select-none cursor-grab active:cursor-grabbing",
          className ?? "h-24 aspect-[192/208]",
        )}
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label={`宠物 ${pet.displayName}`}
        role="img"
      >
        <img
          src={url}
          alt=""
          draggable={false}
          className="pointer-events-none absolute left-0 top-0"
          style={frameSheetStyle(frames.cols, frames.rows, col, row)}
        />
      </div>
    </div>
  );
}
