/**
 * Decoded image cache shared by the editor canvas, thumbnails and the exporter.
 * The blob loader is injected so rendering stays independent of persistence.
 */
import { coverCrop } from "@/document/geometry";
import { isNeutral, type Adjustments, type ImageElement, type VideoElement } from "@/document/schema";
import { applyAdjustments } from "./adjust";
import type { AdjustRequest, AdjustResponse } from "./adjust.worker";
import { VideoPool, type VideoFrameOptions } from "./videoPool";

export type BlobLoader = (assetId: string) => Promise<Blob | undefined>;

export interface ProcessOptions {
  /** Output pixels per document pixel. */
  quality: number;
  /** Upper bound for the longer side of the processed bitmap. */
  maxSide: number;
  /**
   * Editor mode: return a small, instantly computed preview right away and finish the
   * full-resolution version in a Web Worker (listeners are notified when it is ready).
   * Exports and thumbnails leave this off and always get the exact result synchronously.
   */
  progressive?: boolean;
}

export interface RenderResources {
  /** Synchronous lookup. Returns undefined while an image is still decoding or is missing. */
  getImage(assetId: string): HTMLImageElement | undefined;
  /**
   * The image of an element, cropped to its frame, flipped and with its adjustments applied.
   * Results are memoized, so redrawing an unchanged image costs nothing.
   */
  getProcessed(el: ImageElement, opts: ProcessOptions): HTMLCanvasElement | undefined;
  /**
   * The frame of a video element (poster frame, or the frame at a slide time), cropped to its
   * box and flipped. Undefined while nothing can be drawn yet.
   */
  getVideoFrame(el: VideoElement, opts: VideoFrameOptions): HTMLCanvasElement | undefined;
}

const PROCESSED_CACHE_LIMIT = 48;
const BASE_CACHE_LIMIT = 12;
/** Longest side of the instant preview used while a slider is moving. */
const PROXY_SIDE = 360;
/** Wait for the slider to pause before starting a full-resolution pass. */
const FULL_PASS_DELAY_MS = 140;

type Entry = {
  status: "loading" | "ready" | "error";
  kind: "image" | "video";
  /** The decoded photo, or the stored poster still of a video. */
  image?: HTMLImageElement;
  /** Object URL of `image`. */
  url?: string;
  /** Object URL of the video file itself. */
  videoUrl?: string;
  promise: Promise<void>;
};

export class ImageStore implements RenderResources {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private processed = new Map<string, HTMLCanvasElement>();
  private processedListeners = new Set<() => void>();
  private bases = new Map<string, HTMLCanvasElement>();
  /** Latest requested full-resolution pass per image frame. */
  private jobs = new Map<string, { key: string; timer: number }>();
  private worker: Worker | null | undefined;
  private jobId = 0;
  private waiting = new Map<number, (data: Uint8ClampedArray | null) => void>();

  /** Playing videos, poster frames and per-element frame canvases. */
  readonly videos: VideoPool;

  /** posterLoader returns the small still stored next to a video asset (optional). */
  constructor(
    private loader: BlobLoader,
    private posterLoader?: BlobLoader,
  ) {
    this.videos = new VideoPool(
      (assetId) => {
        const entry = this.entries.get(assetId);
        if (!entry) void this.load(assetId);
        return entry?.status === "ready" && entry.videoUrl ? { url: entry.videoUrl, poster: entry.image } : undefined;
      },
      () => this.listeners.forEach((l) => l()),
    );
  }

  getVideoFrame(el: VideoElement, opts: VideoFrameOptions) {
    return this.videos.frame(el, opts);
  }

  isVideo(assetId: string) {
    return this.entries.get(assetId)?.kind === "video";
  }

  getImage(assetId: string) {
    const entry = this.entries.get(assetId);
    if (!entry) {
      void this.load(assetId);
      return undefined;
    }
    return entry.status === "ready" && entry.kind === "image" ? entry.image : undefined;
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
    const slot = [el.assetId, Math.round(el.width), Math.round(el.height), el.flipX, el.flipY, w, h].join("|");
    const key = `${slot}|${JSON.stringify(el.adjustments)}`;
    const hit = this.touch(key);
    if (hit) return hit;

    const neutral = isNeutral(el.adjustments);
    const draw = (cw: number, ch: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d", { willReadFrequently: !neutral });
      if (!ctx) return null;
      ctx.imageSmoothingQuality = "high";
      ctx.translate(el.flipX ? cw : 0, el.flipY ? ch : 0);
      ctx.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1);
      ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, cw, ch);
      return { canvas, ctx };
    };
    const processNow = (cw: number, ch: number) => {
      const out = draw(cw, ch);
      if (!out) return undefined;
      if (!neutral) {
        const pixels = out.ctx.getImageData(0, 0, cw, ch);
        applyAdjustments(pixels.data, cw, ch, el.adjustments);
        out.ctx.putImageData(pixels, 0, 0);
      }
      return out.canvas;
    };

    const proxyScale = PROXY_SIDE / Math.max(w, h);
    if (neutral || !opts.progressive || proxyScale >= 1) {
      const canvas = processNow(w, h);
      if (canvas) this.remember(key, canvas);
      return canvas;
    }

    // Progressive: a small preview now (a few milliseconds), the sharp version from the worker.
    // Resampling a 12 MP photo is the expensive part, so the unadjusted crop is kept per frame
    // ("base") in both sizes and every slider step only reprocesses pixels that already exist.
    const base = this.base(slot, () => draw(w, h)?.canvas);
    if (!base) return undefined;
    const pw = Math.max(1, Math.round(w * proxyScale));
    const ph = Math.max(1, Math.round(h * proxyScale));
    const proxyBase = this.base(`${slot}|proxy`, () => {
      const c = document.createElement("canvas");
      c.width = pw;
      c.height = ph;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return undefined;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(base, 0, 0, pw, ph);
      return c;
    });
    const adjusted = (source: HTMLCanvasElement, data?: Uint8ClampedArray) => {
      const c = document.createElement("canvas");
      c.width = source.width;
      c.height = source.height;
      const ctx = c.getContext("2d");
      const pixels = data
        ? new ImageData(data as Uint8ClampedArray<ArrayBuffer>, source.width, source.height)
        : source.getContext("2d")!.getImageData(0, 0, source.width, source.height);
      if (!data) applyAdjustments(pixels.data, source.width, source.height, el.adjustments);
      ctx?.putImageData(pixels, 0, 0);
      return c;
    };
    const proxyKey = `${key}|proxy`;
    const proxy = this.touch(proxyKey) ?? (proxyBase ? adjusted(proxyBase) : undefined);
    if (proxy) this.remember(proxyKey, proxy);

    const job = this.jobs.get(slot);
    if (job?.key !== key) {
      if (job) window.clearTimeout(job.timer);
      const adjustments = el.adjustments;
      const timer = window.setTimeout(() => {
        const source = this.base(slot, () => draw(w, h)?.canvas);
        const pixels = source?.getContext("2d")?.getImageData(0, 0, w, h);
        if (!source || !pixels) return;
        void this.adjustOffThread(pixels.data, w, h, adjustments).then((data) => {
          if (data) {
            this.remember(key, adjusted(source, data));
          } else {
            // The worker failed and took the pixel buffer with it: redo this one on the main thread.
            const redone = processNow(w, h);
            if (!redone) return;
            this.remember(key, redone);
          }
          // Only repaint if the user has not moved on to a newer value in the meantime.
          if (this.jobs.get(slot)?.key === key) {
            this.jobs.delete(slot);
            this.processedListeners.forEach((l) => l());
          }
        });
      }, FULL_PASS_DELAY_MS);
      this.jobs.set(slot, { key, timer });
    }
    return proxy;
  }

  /** Unadjusted, already cropped and resampled pixels of one image frame (small LRU). */
  private base(key: string, create: () => HTMLCanvasElement | undefined): HTMLCanvasElement | undefined {
    const hit = this.bases.get(key);
    if (hit && hit.width > 0) {
      this.bases.delete(key);
      this.bases.set(key, hit);
      return hit;
    }
    const canvas = create();
    if (!canvas) return undefined;
    this.bases.set(key, canvas);
    while (this.bases.size > BASE_CACHE_LIMIT) {
      const oldest = this.bases.keys().next().value as string;
      const dropped = this.bases.get(oldest);
      if (dropped) dropped.width = dropped.height = 0;
      this.bases.delete(oldest);
    }
    return canvas;
  }

  private touch(key: string) {
    const hit = this.processed.get(key);
    if (hit) {
      this.processed.delete(key);
      this.processed.set(key, hit);
    }
    return hit;
  }

  private remember(key: string, canvas: HTMLCanvasElement) {
    this.processed.set(key, canvas);
    while (this.processed.size > PROCESSED_CACHE_LIMIT) {
      const oldest = this.processed.keys().next().value as string;
      const dropped = this.processed.get(oldest);
      if (dropped) dropped.width = dropped.height = 0; // release bitmap memory right away (matters on iOS)
      this.processed.delete(oldest);
    }
  }

  /** Full-resolution pass in a Web Worker, with a main-thread fallback if workers are unavailable. */
  private adjustOffThread(data: Uint8ClampedArray, width: number, height: number, adjustments: Adjustments): Promise<Uint8ClampedArray | null> {
    if (this.worker === undefined) {
      try {
        this.worker = new Worker(new URL("./adjust.worker.ts", import.meta.url), { type: "module" });
        this.worker.onmessage = (event: MessageEvent<AdjustResponse>) => {
          this.waiting.get(event.data.id)?.(new Uint8ClampedArray(event.data.buffer));
          this.waiting.delete(event.data.id);
        };
        this.worker.onerror = () => {
          // For example offline before the worker script was ever cached: fall back for good.
          this.worker?.terminate();
          this.worker = null;
          for (const resolve of this.waiting.values()) resolve(null);
          this.waiting.clear();
        };
      } catch {
        this.worker = null;
      }
    }
    const onMainThread = () =>
      new Promise<Uint8ClampedArray>((resolve) =>
        window.setTimeout(() => {
          applyAdjustments(data, width, height, adjustments);
          resolve(data);
        }, 0),
      );
    const worker = this.worker;
    if (!worker) return onMainThread();
    return new Promise<Uint8ClampedArray | null>((resolve) => {
      const id = ++this.jobId;
      this.waiting.set(id, resolve);
      const request: AdjustRequest = { id, width, height, adjustments, buffer: data.buffer as ArrayBuffer };
      worker.postMessage(request, [request.buffer]);
    });
  }

  /** Called when a full-resolution adjusted image replaces its quick preview. */
  subscribeProcessed(listener: () => void) {
    this.processedListeners.add(listener);
    return () => {
      this.processedListeners.delete(listener);
    };
  }

  /** Object URL of a decoded image (for a video: of its stored still), for plain <img> previews in panels. */
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
    const entry: Entry = { status: "loading", kind: "image", promise: Promise.resolve() };
    const decode = async (blob: Blob) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.decoding = "async";
      try {
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("image decode failed"));
          image.src = url;
        });
      } catch (e) {
        URL.revokeObjectURL(url);
        throw e;
      }
      entry.image = image;
      entry.url = url;
    };
    entry.promise = (async () => {
      try {
        const blob = await this.loader(assetId);
        if (!blob) throw new Error("asset not found");
        if (blob.type.startsWith("video/")) {
          entry.kind = "video";
          entry.videoUrl = URL.createObjectURL(blob);
          // The stored still is only a quick preview: a video without one is still usable.
          const poster = await this.posterLoader?.(assetId).catch(() => undefined);
          if (poster) await decode(poster).catch(() => undefined);
        } else {
          await decode(blob);
        }
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
    this.videos.dispose();
    for (const e of this.entries.values()) {
      if (e.url) URL.revokeObjectURL(e.url);
      if (e.videoUrl) URL.revokeObjectURL(e.videoUrl);
    }
    this.entries.clear();
    this.listeners.clear();
    for (const c of this.processed.values()) c.width = c.height = 0;
    this.processed.clear();
    this.processedListeners.clear();
    for (const c of this.bases.values()) c.width = c.height = 0;
    this.bases.clear();
    for (const job of this.jobs.values()) window.clearTimeout(job.timer);
    this.jobs.clear();
    this.worker?.terminate();
    this.worker = undefined;
    this.waiting.clear();
  }
}
