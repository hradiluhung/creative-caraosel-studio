/**
 * "Original size" of an element: the size it gets when it is added, worked out by the same
 * factory functions, so a reset can never disagree with what adding does.
 */
import { createImage, createOverlay, createShape, createSticker, createText, createVideo, type Placement } from "./factory";
import type { AssetRef, DesignElement } from "./schema";

export interface OriginalSize {
  width: number;
  /** null for text: its height always follows the content. */
  height: number | null;
}

/**
 * Null when there is nothing to go back to: an empty photo frame, a missing file, or a sticker
 * whose drawing is unknown.
 */
export function originalSize(
  el: DesignElement,
  slide: { width: number; height: number },
  ctx: { asset?: AssetRef; stickerAspect?: number } = {},
): OriginalSize | null {
  const p: Placement = { centerX: 0, centerY: 0, maxWidth: slide.width, maxHeight: slide.height };
  const size = (box: { width: number; height: number }) => ({ width: box.width, height: box.height });
  switch (el.type) {
    case "text":
      return { width: createText("body", p).width, height: null };
    case "shape":
      return size(createShape(el.shape, p));
    case "overlay":
      return size(createOverlay(el.overlay, p));
    case "sticker":
      return ctx.stickerAspect && ctx.stickerAspect > 0 ? size(createSticker(el.stickerId, el.name, ctx.stickerAspect, p)) : null;
    case "image": {
      const a = ctx.asset;
      if (!el.assetId || !a || a.id !== el.assetId || a.width <= 0 || a.height <= 0) return null;
      // A photo turned a quarter inside its frame has the other proportions.
      const turned = (el.crop?.turns ?? 0) % 2 === 1;
      return size(createImage({ ...a, width: turned ? a.height : a.width, height: turned ? a.width : a.height }, p));
    }
    case "video": {
      const a = ctx.asset;
      if (!a || a.id !== el.assetId || a.width <= 0 || a.height <= 0) return null;
      const turned = (el.crop?.turns ?? 0) % 2 === 1;
      return size(createVideo({ ...a, width: turned ? a.height : a.width, height: turned ? a.width : a.height }, p));
    }
  }
}

/** Same centre (objects rotate around their centre), new size. */
export function resizeAroundCenter(el: { x: number; y: number; width: number; height: number }, width: number, height: number) {
  return { x: Math.round(el.x + el.width / 2 - width / 2), y: Math.round(el.y + el.height / 2 - height / 2), width, height };
}

/** True when the element already has its original size (within half a pixel). */
export function hasOriginalSize(el: { width: number; height: number }, original: OriginalSize): boolean {
  return Math.abs(el.width - original.width) < 0.5 && (original.height === null || Math.abs(el.height - original.height) < 0.5);
}
