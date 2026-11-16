/**
 * Video side of the render resources.
 *  - live videos: one playing <video> per asset (a second one only when two layers use the
 *    same file at once), positioned by the editor's playback clock through sync()
 *  - poster frames: the exact frame at an element's posterTime, captured once and cached
 *  - frame canvases: the current frame of an element, cropped to its box and flipped, in the
 *    same shape ImageStore.getProcessed returns for photos, so the scene builder treats
 *    both the same way (pattern fill of the mask outline)
 */
import { coverCrop } from "@/document/geometry";
import type { VideoElement } from "@/document/schema";
import { clipEnded, videoTimeAt } from "@/document/timing";
import { createSilentVideo, lastFrameTime, releaseVideo, seekVideo } from "./videoDom";

export interface VideoFrameOptions {
  /** Output pixels per document pixel. */
  quality: number;
  /** Upper bound for the longer side of the frame canvas. */
  maxSide: number;
  /** Slide time in seconds. Undefined asks for the poster frame. */
  time?: number;
}

export interface VideoSource {
  url: string;
  /** Small stored still, shown until the exact poster frame has been captured. */
  poster?: HTMLImageElement;
}

type Live = { assetId: string; video: HTMLVideoElement; cleanup: () => void };
type Poster = { status: "loading" | "ready" | "error"; canvas?: HTMLCanvasElement; promise: Promise<void> };
type Drawable = { source: CanvasImageSource; width: number; height: number; signature: string | null };

const POSTER_CACHE_LIMIT = 16;
const SLOT_CACHE_LIMIT = 32;
/** Largest side of a captured poster frame (4K sources are not shrunk). */
const POSTER_MAX_SIDE = 4096;
/** How far a playing video may run away from the clock before it is pulled back, in source seconds. */
const DRIFT_TOLERANCE = 0.3;

const posterKey = (assetId: string, time: number) => `${assetId}@${Math.round(time * 1000)}`;

export class VideoPool {
  private live = new Map<string, Live>();
  private posters = new Map<string, Poster>();
  private slots = new Map<string, { canvas: HTMLCanvasElement; signature: string | null }>();
  /** Captures run one at a time: phones only allow a handful of video decoders at once. */
  private captureChain: Promise<void> = Promise.resolve();
  private disposed = false;
  /** True after the browser refused to start playback with sound (autoplay policy). */
  audioBlocked = false;
  private audioListeners = new Set<() => void>();

  constructor(
    private source: (assetId: string) => VideoSource | undefined,
    private notify: () => void,
  ) {}

  // --- Frames ------------------------------------------------------------------

  /** The element's current frame, cropped to its box. Undefined while nothing can be drawn yet. */
  frame(el: VideoElement, opts: VideoFrameOptions): HTMLCanvasElement | undefined {
    const drawable = this.drawable(el, opts.time);
    if (!drawable) return undefined;
    const crop = coverCrop(drawable.width, drawable.height, el.width, el.height);
    // Never upscale beyond the source pixels, and respect the caller's size budget.
    const scale = Math.min(opts.quality, crop.width / el.width, opts.maxSide / Math.max(el.width, el.height));
    const w = Math.max(1, Math.round(el.width * scale));
    const h = Math.max(1, Math.round(el.height * scale));
    const key = [el.id, opts.time === undefined ? "poster" : "live", w, h].join("|");
    const signature = drawable.signature === null ? null : `${drawable.signature}|${el.flipX}|${el.flipY}`;

    let slot = this.slots.get(key);
    if (slot) {
      this.slots.delete(key);
      this.slots.set(key, slot);
      // A still frame that was already drawn into this canvas does not need to be drawn again.
      if (signature !== null && slot.signature === signature) return slot.canvas;
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      slot = { canvas, signature: null };
      this.slots.set(key, slot);
      while (this.slots.size > SLOT_CACHE_LIMIT) {
        // Dropped, not emptied: a node that is still on screen may be using this canvas as its fill.
        this.slots.delete(this.slots.keys().next().value as string);
      }
    }
    const ctx = slot.canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.translate(el.flipX ? w : 0, el.flipY ? h : 0);
    ctx.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1);
    try {
      ctx.drawImage(drawable.source, crop.x, crop.y, crop.width, crop.height, 0, 0, w, h);
    } catch {
      return undefined; // the decoder went away between the readiness check and the draw
    }
    slot.signature = signature;
    return slot.canvas;
  }

  private drawable(el: VideoElement, time: number | undefined): Drawable | undefined {
    if (time !== undefined) {
      const video = this.live.get(el.id)?.video;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        return { source: video, width: video.videoWidth, height: video.videoHeight, signature: null };
      }
    }
    const key = posterKey(el.assetId, el.posterTime);
    const exact = this.poster(el.assetId, el.posterTime);
    if (exact?.status === "ready" && exact.canvas) {
      return { source: exact.canvas, width: exact.canvas.width, height: exact.canvas.height, signature: key };
    }
    const fallback = this.source(el.assetId)?.poster;
    if (fallback?.naturalWidth) {
      return { source: fallback, width: fallback.naturalWidth, height: fallback.naturalHeight, signature: `${key}|stored` };
    }
    return undefined;
  }

  // --- Poster frames -------------------------------------------------------------

  private poster(assetId: string, time: number): Poster | undefined {
    const key = posterKey(assetId, time);
    const hit = this.posters.get(key);
    if (hit) {
      this.posters.delete(key);
      this.posters.set(key, hit);
      return hit;
    }
    const src = this.source(assetId);
    if (!src) return undefined; // asset still loading: asked again on the next redraw
    const entry: Poster = { status: "loading", promise: Promise.resolve() };
    entry.promise = this.captureChain = this.captureChain.then(async () => {
      if (this.disposed) return;
      const video = createSilentVideo(src.url);
      try {
        if (!(await seekVideo(video, time)) || !video.videoWidth) throw new Error("no frame");
        const scale = Math.min(1, POSTER_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no canvas");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        entry.canvas = canvas;
        entry.status = "ready";
      } catch {
        entry.status = "error";
      } finally {
        releaseVideo(video);
      }
      if (!this.disposed) this.notify();
    });
    this.posters.set(key, entry);
    while (this.posters.size > POSTER_CACHE_LIMIT) {
      const oldest = this.posters.keys().next().value as string;
      const dropped = this.posters.get(oldest);
      if (dropped?.canvas) dropped.canvas.width = dropped.canvas.height = 0;
      this.posters.delete(oldest);
    }
    return entry;
  }

  /** Resolve once the exact poster frame of every given element is captured (or has failed). */
  async preparePosters(elements: VideoElement[]): Promise<void> {
    await Promise.all(elements.map((el) => this.poster(el.assetId, el.posterTime)?.promise));
  }

  /** True when neither the exact poster frame nor a stored still can be drawn. */
  posterFailed(el: VideoElement): boolean {
    return this.posters.get(posterKey(el.assetId, el.posterTime))?.status === "error" && !this.source(el.assetId)?.poster?.naturalWidth;
  }

  // --- Live playback ---------------------------------------------------------------

  /**
   * Put every given clip at the frame that belongs to this slide time, playing or paused.
   * Called once per animation frame while playing. Videos of other elements are released.
   */
  sync(elements: VideoElement[], time: number, playing: boolean) {
    const wanted = new Set<string>();
    for (const el of elements) {
      const entry = this.acquire(el);
      if (!entry) continue;
      wanted.add(el.id);
      const { video } = entry;
      const ended = clipEnded(el, time);
      const target = Math.min(videoTimeAt(el, time), lastFrameTime(video));
      const silent = el.muted || el.volume === 0 || this.audioBlocked;
      if (video.muted !== silent) video.muted = silent;
      if (video.volume !== el.volume) video.volume = el.volume;
      if (video.playbackRate !== el.playbackRate) video.playbackRate = el.playbackRate;
      const drift = Math.abs(video.currentTime - target);
      if (playing && !ended) {
        // A playing video keeps its own pace; it is only pulled back when it drifts (or loops around).
        if (drift > (video.paused ? 0.02 : DRIFT_TOLERANCE * Math.max(1, el.playbackRate))) video.currentTime = target;
        if (video.paused) this.start(video);
      } else {
        if (!video.paused) video.pause();
        if (drift > 0.02) video.currentTime = target;
      }
    }
    for (const [id, entry] of this.live) {
      if (wanted.has(id)) continue;
      entry.cleanup();
      this.live.delete(id);
    }
  }

  private acquire(el: VideoElement): Live | undefined {
    const hit = this.live.get(el.id);
    if (hit?.assetId === el.assetId) return hit;
    if (hit) {
      hit.cleanup();
      this.live.delete(el.id);
    }
    const src = this.source(el.assetId);
    if (!src) return undefined;
    const video = document.createElement("video");
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.preload = "auto";
    video.muted = el.muted || this.audioBlocked;
    video.src = src.url;
    const redraw = () => !this.disposed && this.notify();
    video.addEventListener("loadeddata", redraw);
    video.addEventListener("seeked", redraw);
    const entry: Live = {
      assetId: el.assetId,
      video,
      cleanup: () => {
        video.removeEventListener("loadeddata", redraw);
        video.removeEventListener("seeked", redraw);
        releaseVideo(video);
      },
    };
    this.live.set(el.id, entry);
    return entry;
  }

  private start(video: HTMLVideoElement) {
    video.play().catch((error: unknown) => {
      // Browsers refuse sound without a recent tap. Keep the picture moving and say so in the UI.
      if (!(error instanceof DOMException) || error.name !== "NotAllowedError" || video.muted) return;
      this.audioBlocked = true;
      video.muted = true;
      void video.play().catch(() => undefined);
      this.audioListeners.forEach((l) => l());
    });
  }

  /** A fresh tap on play is a new chance to get sound. */
  resetAudioBlock() {
    this.audioBlocked = false;
  }

  /** Called when playback had to start muted because the browser refused sound. */
  subscribeAudioBlocked(listener: () => void) {
    this.audioListeners.add(listener);
    return () => {
      this.audioListeners.delete(listener);
    };
  }

  /** Pause and release every live video (decoders are a scarce resource on phones). */
  stop() {
    for (const entry of this.live.values()) entry.cleanup();
    this.live.clear();
    for (const key of [...this.slots.keys()]) if (key.includes("|live|")) this.slots.delete(key);
  }

  dispose() {
    this.disposed = true;
    this.stop();
    for (const slot of this.slots.values()) slot.canvas.width = slot.canvas.height = 0;
    this.slots.clear();
    for (const poster of this.posters.values()) if (poster.canvas) poster.canvas.width = poster.canvas.height = 0;
    this.posters.clear();
    this.audioListeners.clear();
  }
}
