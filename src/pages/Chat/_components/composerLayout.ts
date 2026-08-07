/** 顶拖条 + 底栏（小发送钮）占位。 */
export const COMPOSER_CHROME_PX = 44;
/** 单行文字区最小高度。 */
export const COMPOSER_LINE_PX = 24;
/** 拖拽/外壳下限：单行文字不被裁切。 */
export const COMPOSER_MIN_PX = COMPOSER_CHROME_PX + COMPOSER_LINE_PX; // 68
export const COMPOSER_MAX_PX = 320;
export const COMPOSER_DEFAULT_PX = COMPOSER_MIN_PX;
/** 展开态占主列高度比例。 */
export const COMPOSER_EXPAND_RATIO = 0.55;

export function clampComposerHeight(
  px: number,
  maxPx: number = COMPOSER_MAX_PX,
): number {
  return Math.min(maxPx, Math.max(COMPOSER_MIN_PX, Math.round(px)));
}

/** 拖拽时：从指针 Y 与卡片底边反算外壳高度。 */
export function heightFromDrag(
  cardBottom: number,
  clientY: number,
  maxPx: number = COMPOSER_MAX_PX,
): number {
  return clampComposerHeight(cardBottom - clientY, maxPx);
}

/** 内容区高度 + chrome → 外壳高度。 */
export function shellFromContent(contentPx: number): number {
  return clampComposerHeight(contentPx + COMPOSER_CHROME_PX);
}
