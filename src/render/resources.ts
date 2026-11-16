/**
 * Decoded image cache shared by the editor canvas, thumbnails and the exporter.
 * The blob loader is injected so rendering stays independent of persistence.
 */
import { coverCrop } from "@/document/geometry";
import { isNeutral, type ImageElement } from "@/document/schema";
import { applyAdjustments } from "./adjust";

export type BlobLoader = (assetId: string) => Promise<Blob | undefined>;

export interface ProcessOptions {
  /** Output pixels per document pixel. */
  quality: number;
  /** Upper bound for the longer side of the processed bitmap. */
  maxSide: number;
}

export interface RenderResources {
  /** Synchronous lookup. Returns undefined while an image is still decoding or is missing. */
  getImage(assetId: string): HTMLImageElement | undefined;
  /**
   * The image of an element, cropped to its frame, flipped and with its adjustments applied.
   * Results are memoized, so redrawing an unchanged image costs nothing.
   */
  getProcessed(el: ImageElement, opts: ProcessOptions): HTMLCanvasElement | undefined;
}

const PROCESSED_CACHE_LIMIT = 48;

type Entry = { status: "loading" | "ready" | "error"; image?: HTMLImageElement; url?: string; promise: Promise<void> };

export class ImageStore implements RenderResources {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private processed = new Map<string, HTMLCanvasElement>();

  constructor(private loader: BlobLoader) {}

  getImage(assetId: string) {
    const entry = this.entries.get(assetId);
    if (!entry) {
      void this.load(assetId);
      return undefined;
    }
    return entry.status === "ready" ? entry.image : undefined;
  }

  getProcessed(el: ImageElement, opts: ProcessOptions) {
    if (!el.assetId) return undefined;
    const image = this.getImage(el.assetId);
    if (!image) return undefined;
    const crop = coverCrop(image.naturalWidth, image.naturalHeight, el.width, el.height);
    // Never upscale beyond the source pixels, and respect the caller's size budget.
    const scale = Math.min(opts.quality, crop.width / el.width, opts.maxSide / Math.max(el.width, el.height));
    const w = Math.max(1, Math.round(el.width * scale));
    const h = Math.max(1, Math.round(el.height * scale));
    const key = [el.assetId, Math.round(el.width), Math.round(el.height), el.flipX, el.flipY, w, h, JSON.stringify(el.adjustments)].join("|");
    const hit = this.processed.get(key);
    if (hit) {
      // Refresh recency.
      this.processed.delete(key);
      this.processed.set(key, hit);
      return hit;
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: !isNeutral(el.adjustments) });
    if (!ctx) return undefined;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(el.flipX ? w : 0, el.flipY ? h : 0);
    ctx.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1);
    ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, w, h);
    if (!isNeutral(el.adjustments)) {
      const pixels = ctx.getImageData(0, 0, w, h);
      applyAdjustments(pixels.data, w, h, el.adjustments);
      ctx.putImageData(pixels, 0, 0);
    }
    this.processed.set(key, canvas);
    while (this.processed.size > PROCESSED_CACHE_LIMIT) {
      const oldest = this.processed.keys().next().value as string;
      const dropped = this.processed.get(oldest);
      if (dropped) dropped.width = dropped.height = 0; // release bitmap memory right away (matters on iOS)
      this.processed.delete(oldest);
    }
    return canvas;
  }

  /** Object URL of a decoded asset, for plain <img> previews in panels. */
  getUrl(assetId: string) {
    const entry = this.entries.get(assetId);
    if (!entry) void this.load(assetId);
    return entry?.status === "ready" ? entry.url : undefined;
  }

  isMissing(assetId: string) {
    return this.entries.get(assetId)?.status === "error";
  }

  load(assetId: string): Promise<void> {
    const existing = this.entries.get(assetId);
    if (existing) return existing.promise;
    const entry: Entry = { status: "loading", promise: Promise.resolve() };
    entry.promise = (async () => {
      try {
        const blob = await this.loader(assetId);
        if (!blob) throw new Error("asset not found");
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.decoding = "async";
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("image decode failed"));
          image.src = url;
        });
        entry.image = image;
        entry.url = url;
        entry.status = "ready";
      } catch {
        entry.status = "error";
      }
      this.listeners.forEach((l) => l());
    })();
    this.entries.set(assetId, entry);
    return entry.promise;
  }

  async preload(assetIds: Iterable<string>) {
    await Promise.all([...assetIds].map((id) => this.load(id)));
  }

  /** Called whenever an image finishes loading, so canvases can redraw. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Release object URLs. Call when the editor unmounts. */
  dispose() {
    for (const e of this.entries.values()) if (e.url) URL.revokeObjectURL(e.url);
    this.entries.clear();
    this.listeners.clear();
    for (const c of this.processed.values()) c.width = c.height = 0;
    this.processed.clear();
  }
}
