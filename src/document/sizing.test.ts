import { describe, expect, it } from "vitest";
import { createImage, createOverlay, createShape, createSticker, createText, createVideo, placementFor } from "./factory";
import { hasOriginalSize, originalSize, resizeAroundCenter } from "./sizing";

const slide = { width: 1080, height: 1350 };
const p = placementFor(slide, 1080);
const photo = { id: "a", name: "a.jpg", mime: "image/jpeg", width: 4000, height: 3000, size: 1 };
const clip = { id: "v", name: "v.mp4", mime: "video/mp4", width: 1080, height: 1920, size: 1, duration: 3 };
const changed = <T extends object>(el: T) => ({ ...el, x: 7, y: 9, width: 123, height: 45 });

describe("original size", () => {
  it("is what adding the element gives, for every kind", () => {
    const img = createImage(photo, p);
    expect(originalSize(changed(img), slide, { asset: photo })).toEqual({ width: img.width, height: img.height });
    const vid = createVideo(clip, p);
    expect(originalSize(changed(vid), slide, { asset: clip })).toEqual({ width: vid.width, height: vid.height });
    for (const kind of ["rect", "ellipse", "line", "star"] as const) {
      const sh = createShape(kind, p);
      expect(originalSize(changed(sh), slide)).toEqual({ width: sh.width, height: sh.height });
    }
    const st = createSticker("sparkle", "Sparkle", 0.8, p);
    expect(originalSize(changed(st), slide, { stickerAspect: 0.8 })).toEqual({ width: st.width, height: st.height });
    const ov = createOverlay("grain", p);
    expect(originalSize(changed(ov), slide)).toEqual({ width: 1080, height: 1350 });
    expect(originalSize(changed(createText("heading", p)), slide)).toEqual({ width: createText("body", p).width, height: null });
  });

  it("keeps the photo's own proportions, turned with the photo", () => {
    const img = createImage(photo, p);
    const o = originalSize(img, slide, { asset: photo })!;
    expect(o.width / o.height!).toBeCloseTo(4 / 3, 2);
    const turned = originalSize({ ...img, crop: { x: 0, y: 0, zoom: 1, turns: 1 } }, slide, { asset: photo })!;
    expect(turned.width / turned.height!).toBeCloseTo(3 / 4, 2);
  });

  it("has nothing to go back to for empty frames, missing files and unknown stickers", () => {
    const img = createImage(photo, p);
    expect(originalSize({ ...img, assetId: null }, slide, { asset: photo })).toBeNull();
    expect(originalSize(img, slide)).toBeNull();
    expect(originalSize(img, slide, { asset: { ...photo, id: "other" } })).toBeNull();
    expect(originalSize(img, slide, { asset: { ...photo, width: 0 } })).toBeNull();
    expect(originalSize(createSticker("x", "X", 1, p), slide)).toBeNull();
  });

  it("resizes around the centre, which is also what rotation turns around", () => {
    expect(resizeAroundCenter({ x: 100, y: 200, width: 400, height: 300 }, 200, 100)).toEqual({ x: 200, y: 300, width: 200, height: 100 });
    expect(resizeAroundCenter({ x: 0, y: 0, width: 101, height: 101 }, 50, 50)).toEqual({ x: 26, y: 26, width: 50, height: 50 });
  });

  it("knows when the size already is the original one", () => {
    expect(hasOriginalSize({ width: 100.2, height: 50 }, { width: 100, height: 50 })).toBe(true);
    expect(hasOriginalSize({ width: 100, height: 51 }, { width: 100, height: 50 })).toBe(false);
    expect(hasOriginalSize({ width: 100, height: 999 }, { width: 100, height: null })).toBe(true);
  });
});
