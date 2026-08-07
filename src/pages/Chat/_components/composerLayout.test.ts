import { describe, expect, it } from "vitest";

import {
  COMPOSER_CHROME_PX,
  COMPOSER_MAX_PX,
  COMPOSER_MIN_PX,
  clampComposerHeight,
  heightFromDrag,
  shellFromContent,
} from "./composerLayout";

describe("composerLayout", () => {
  it("clampComposerHeight clamps to min/max", () => {
    expect(clampComposerHeight(10)).toBe(COMPOSER_MIN_PX);
    expect(clampComposerHeight(9999)).toBe(COMPOSER_MAX_PX);
    expect(clampComposerHeight(160.4)).toBe(160);
  });

  it("heightFromDrag grows when pointer moves up", () => {
    const cardBottom = 800;
    expect(heightFromDrag(cardBottom, 800 - COMPOSER_MIN_PX - 20)).toBe(
      COMPOSER_MIN_PX + 20,
    );
    expect(heightFromDrag(cardBottom, 790)).toBe(COMPOSER_MIN_PX);
    expect(heightFromDrag(cardBottom, 400)).toBe(COMPOSER_MAX_PX);
  });

  it("shellFromContent includes chrome and respects min", () => {
    expect(shellFromContent(10)).toBe(COMPOSER_MIN_PX);
    expect(shellFromContent(100)).toBe(100 + COMPOSER_CHROME_PX);
  });
});
