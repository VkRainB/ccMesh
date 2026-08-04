import type { CSSProperties } from "react";

import type { PetFrames } from "@/services/modules/pet";

/**
 * 精灵图 `<img>` 裁帧样式：父级需 `overflow:hidden` 且有确定尺寸。
 * 把整表放大到 cols×rows 倍，再用 translate 选中 (col, row)。
 * translate% 相对自身尺寸，故 `-col/cols` 刚好移过一帧宽。
 */
export function frameSheetStyle(
  cols: number,
  rows: number,
  col: number,
  row: number,
): CSSProperties {
  const c = Math.max(1, cols);
  const r = Math.max(1, rows);
  return {
    width: `${c * 100}%`,
    height: `${r * 100}%`,
    maxWidth: "none",
    transform: `translate(${(-col / c) * 100}%, ${(-row / r) * 100}%)`,
  };
}

/** 单帧宽高比（宽/高），由整表尺寸与行列数推算。 */
export function frameAspectRatio(
  sheetW: number,
  sheetH: number,
  cols: number,
  rows: number,
): number {
  const fw = sheetW / Math.max(1, cols);
  const fh = sheetH / Math.max(1, rows);
  return fw / fh;
}

/** 在 cw×ch 盒子内按宽高比 ar（宽/高）做 contain，返回像素尺寸。 */
export function containSize(
  cw: number,
  ch: number,
  ar: number,
): { w: number; h: number } {
  if (cw <= 0 || ch <= 0 || ar <= 0) return { w: 0, h: 0 };
  if (cw / ch > ar) return { h: ch, w: ch * ar };
  return { w: cw, h: cw / ar };
}

/** 第 row 行的实际帧数（counts 缺省/不足时回退 cols，至少 1）。 */
export function rowCount(frames: PetFrames, row: number): number {
  return Math.max(1, frames.counts?.[row] ?? frames.cols);
}

/**
 * Codex 精灵表默认布局（1536×1872 / 8×9 / 单帧 192×208）。
 * 标准 pet.json 常省略 frames；与后端 `PetFrames::codex_default` 对齐。
 */
export const FALLBACK_FRAMES: PetFrames = {
  cols: 8,
  rows: 9,
  fps: 8,
  counts: [6, 8, 8, 4, 5, 8, 6, 6, 6],
};

/**
 * Codex 9 行动作（行下标 = 精灵表 row）。
 * @see https://jasonai.me/blog/codex-pets/
 */
export const PET_ACTIONS = {
  /** 待机：呼吸/眨眼 */
  idle: 0,
  /** 向右移动/被拖向右 */
  runningRight: 1,
  /** 向左移动/被拖向左 */
  runningLeft: 2,
  /** 打招呼（点击） */
  waving: 3,
  /** 跳跃（上拖 / 悬停反馈） */
  jumping: 4,
  /** 失败（任务态，非拖拽） */
  failed: 5,
  /** 等待（下拖 / 等指令） */
  waiting: 6,
  /** 忙碌工作（任务态，非跑步） */
  running: 7,
  /** 审阅（任务态） */
  review: 8,
} as const;

export type PetAction = keyof typeof PET_ACTIONS;

/** 拖拽位移判定死区（px）：小于此视为未移动。 */
export const DRAG_DEADZONE = 6;

/**
 * 由拖拽位移选动作：主轴右→runningRight，左→runningLeft，上→jumping，下→waiting；
 * 死区内 → idle。failed/running/review 留给后续任务态接入。
 */
export function actionFromDrag(
  dx: number,
  dy: number,
  deadzone = DRAG_DEADZONE,
): PetAction {
  if (Math.abs(dx) < deadzone && Math.abs(dy) < deadzone) return "idle";
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? "runningRight" : "runningLeft";
  }
  return dy < 0 ? "jumping" : "waiting";
}
