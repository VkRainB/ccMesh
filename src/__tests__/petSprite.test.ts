import { describe, expect, it } from "vitest";

import {
  actionFromDrag,
  containSize,
  frameAspectRatio,
  frameSheetStyle,
  PET_ACTIONS,
  rowCount,
} from "@/lib/petSprite";

describe("frameSheetStyle", () => {
  it("首帧 (0,0) 不位移，尺寸为 cols×rows 倍容器", () => {
    const s = frameSheetStyle(8, 9, 0, 0);
    expect(s.width).toBe("800%");
    expect(s.height).toBe("900%");
    expect(s.transform).toBe("translate(0%, 0%)");
  });

  it("选中 (col,row) 时 translate 为 -col/cols、-row/rows", () => {
    const s = frameSheetStyle(8, 9, 3, 2);
    expect(s.transform).toMatch(
      /^translate\((-37\.5)%,\s*(-22\.2\d*)%\)$/,
    );
  });

  it("cols/rows ≤0 时按 1 处理，避免除零", () => {
    const s = frameSheetStyle(0, 0, 0, 0);
    expect(s.width).toBe("100%");
    expect(s.height).toBe("100%");
    expect(s.transform).toBe("translate(0%, 0%)");
  });
});

describe("frameAspectRatio", () => {
  it("1536×1872 / 8×9 → 单帧 192×208", () => {
    expect(frameAspectRatio(1536, 1872, 8, 9)).toBeCloseTo(192 / 208);
  });
});

describe("containSize", () => {
  const ar = 192 / 208;
  it("窄高盒子按宽度限制", () => {
    const s = containSize(100, 200, ar);
    expect(s.w).toBe(100);
    expect(s.h).toBeCloseTo(100 / ar);
  });
  it("宽矮盒子按高度限制", () => {
    const s = containSize(200, 100, ar);
    expect(s.h).toBe(100);
    expect(s.w).toBeCloseTo(100 * ar);
  });
});

describe("rowCount", () => {
  it("优先 counts，否则回退 cols", () => {
    const frames = { cols: 8, rows: 2, fps: 8, counts: [6] };
    expect(rowCount(frames, 0)).toBe(6);
    expect(rowCount(frames, 1)).toBe(8);
  });
});

describe("PET_ACTIONS", () => {
  it("九行顺序与 Codex 契约一致", () => {
    expect(PET_ACTIONS.idle).toBe(0);
    expect(PET_ACTIONS.runningRight).toBe(1);
    expect(PET_ACTIONS.runningLeft).toBe(2);
    expect(PET_ACTIONS.waving).toBe(3);
    expect(PET_ACTIONS.jumping).toBe(4);
    expect(PET_ACTIONS.failed).toBe(5);
    expect(PET_ACTIONS.waiting).toBe(6);
    expect(PET_ACTIONS.running).toBe(7);
    expect(PET_ACTIONS.review).toBe(8);
  });
});

describe("actionFromDrag", () => {
  it("死区内为 idle", () => {
    expect(actionFromDrag(0, 0)).toBe("idle");
    expect(actionFromDrag(3, -2)).toBe("idle");
  });
  it("主轴水平：右 runningRight / 左 runningLeft", () => {
    expect(actionFromDrag(20, 5)).toBe("runningRight");
    expect(actionFromDrag(-20, 5)).toBe("runningLeft");
  });
  it("主轴垂直：上 jumping / 下 waiting", () => {
    expect(actionFromDrag(5, -20)).toBe("jumping");
    expect(actionFromDrag(5, 20)).toBe("waiting");
  });
});
