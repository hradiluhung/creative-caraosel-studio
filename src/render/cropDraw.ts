import type { FrameCrop } from "@/document/geometry";

/**
 * Draw the part of a picture a frame shows (see `frameCrop`) into a `cw` x `ch` canvas area.
 * Shared by photos (resources.ts) and video frames (videoPool.ts), so a crop looks the same on
 * both. Flips must already be applied to the context.
 */
export function drawFrameCrop(ctx: CanvasRenderingContext2D, source: CanvasImageSource, crop: FrameCrop, cw: number, ch: number) {
  if (crop.turns === 0) {
    ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, cw, ch);
    return;
  }
  // Size of the picture before turning it.
  const naturalW = crop.turns % 2 ? crop.sourceHeight : crop.sourceWidth;
  const naturalH = crop.turns % 2 ? crop.sourceWidth : crop.sourceHeight;
  // Map the turned picture onto the canvas, then place the unturned pixels into that space.
  ctx.scale(cw / crop.width, ch / crop.height);
  ctx.translate(-crop.x, -crop.y);
  if (crop.turns === 1) ctx.translate(crop.sourceWidth, 0);
  else if (crop.turns === 2) ctx.translate(crop.sourceWidth, crop.sourceHeight);
  else ctx.translate(0, crop.sourceHeight);
  ctx.rotate((crop.turns * Math.PI) / 2);
  ctx.drawImage(source, 0, 0, naturalW, naturalH);
}
