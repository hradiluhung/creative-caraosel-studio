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
import { clipActive, clipEnded, videoTimeAt } from "@/document/timing";
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

type Live = {
  assetId: string;
  video: HTMLVideoElement;
  /** A frame that has not been painted yet was presented (only tracked with requestVideoFrameCallback). */
  fresh: boolean;
  /** False where requestVideoFrameCallback is missing: then every tick may carry a new frame. */
  tracksFrames: boolean;
  cleanup: () => void;
};

export interface SyncResult {
  /**
   * Seconds by which the clip that leads playback is ahead (+) or behind (-) of the slide time it
   * was given. The caller adds this to its clock, so the clock follows the video instead of the
   * video being forced to jump to the clock. 0 when no clip can lead right now.
   */
  lead: number;
  /** A clip that should be moving is still starting up or buffering: the clock should hold. */
  waiting: boolean;
}
type Poster = { status: "loading" | "ready" | "error"; canvas?: HTMLCanvasElement; promise: Promise<void> };
type Drawable = { source: CanvasImageSource; width: number; height: number; signature: string | null };

const POSTER_CACHE_LIMIT = 16;
const SLOT_CACHE_LIMIT = 32;
/** Largest side of a captured poster frame (4K sources are not shrunk). */
const POSTER_MAX_SIDE = 4096;
/** How far a playing video may run away from the clock before it is pulled back, in source seconds. */
const DRIFT_TOLERANCE = 0.3;
/** Up to this difference (source seconds) the clock is moved to the leading video; beyond it the video is. */
const FOLLOW_LIMIT = 1.5;

const posterKey = (assetId: string, time: number) => `${assetId}@${Math.round(time * 1000)}`;

export class VideoPool {
  private live = new Map<string, Live>();
  private posters = new Map<string, Poster>();
  private slots = new Map<string, { canvas: HTMLCanvasElement; signature: string | null }>();
  /** Captures run one at a time: phones only allow a handful of video decoders at once. */
  private captureChain: Promise<void> = Promise.resolve();
  private disposed = false;
  private hostEl: HTMLElement | null = null;
  private external = new Map<string, { source: CanvasImageSource; width: number; height: number }>();
  /** True after the browser refused to start playback with sound (autoplay policy). */
  audioBlocked = false;
  private audioListeners = new Set<() => void>();

  constructor(
    private source: (assetId: string) => VideoSource | undefined,
    private notify: () => void,
    /** Never make a sound (the exporter's pool). */
    private silent = false,
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
    // Stills are resampled carefully once; live frames are redrawn 30 times a second.
    ctx.imageSmoothingQuality = signature === null ? "low" : "high";
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

  /**
   * Hand in the picture a clip shows right now from outside (the exporter's decoded frames).
   * While set, it is used instead of this pool's own <video> for that element. Null removes it.
   */
  setFrameSource(elementId: string, source: { source: CanvasImageSource; width: number; height: number } | null) {
    if (source) this.external.set(elementId, source);
    else this.external.delete(elementId);
  }

  private drawable(el: VideoElement, time: number | undefined): Drawable | undefined {
    if (time !== undefined) {
      const given = this.external.get(el.id);
      if (given) return { ...given, signature: null };
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
   *
   * While playing, a video is never made to chase the clock: decoding starts late and stutters on
   * phones, and every forced seek is a visible jump. Instead the first healthy clip leads and the
   * caller moves its clock by the returned `lead`. Other clips are only seeked when they are far off.
   */
  sync(elements: VideoElement[], time: number, playing: boolean): SyncResult {
    const wanted = new Set<string>();
    const result: SyncResult = { lead: 0, waiting: false };
    let hasLeader = false;
    for (const el of elements) {
      const entry = this.acquire(el);
      if (!entry) continue;
      wanted.add(el.id);
      const { video } = entry;
      const span = el.trimEnd - el.trimStart;
      const started = time >= el.start;
      const firstPass = started && (time - el.start) * el.playbackRate < span;
      // The file itself can end a moment before the trimmed range does: that is the end of this pass.
      const finished = clipEnded(el, time) || (!el.loop && video.ended);
      const target = Math.min(videoTimeAt(el, time), lastFrameTime(video));
      const silent = this.silent || el.muted || el.volume === 0 || this.audioBlocked;
      if (video.muted !== silent) video.muted = silent;
      if (video.volume !== el.volume) video.volume = el.volume;
      if (video.playbackRate !== el.playbackRate) video.playbackRate = el.playbackRate;
      const ahead = video.currentTime - target;
      // A clip that has not started yet waits, paused, on its first frame so it can start at once.
      if (!playing || finished || !started) {
        if (!video.paused) video.pause();
        if (Math.abs(ahead) > 0.02 && !video.seeking) video.currentTime = target;
        continue;
      }
      if (video.paused || video.ended) {
        if (Math.abs(ahead) > 0.02) video.currentTime = target;
        this.start(video);
        result.waiting = true;
        continue;
      }
      if (video.seeking || video.readyState < 3) {
        result.waiting = true;
        continue;
      }
      if (!hasLeader && firstPass && Math.abs(ahead) <= FOLLOW_LIMIT) {
        hasLeader = true;
        result.lead = ahead / el.playbackRate;
      } else if (Math.abs(ahead - (hasLeader ? result.lead * el.playbackRate : 0)) > DRIFT_TOLERANCE * Math.max(1, el.playbackRate)) {
        // Far off (a loop came around, the trim changed, or it fell behind the leader): jump once.
        video.currentTime = Math.min(target + (hasLeader ? result.lead * el.playbackRate : 0), lastFrameTime(video));
      }
    }
    for (const [id, entry] of this.live) {
      if (wanted.has(id)) continue;
      entry.cleanup();
      this.live.delete(id);
    }
    return result;
  }

  /**
   * Exact frames for export: put every clip that is on screen at this slide time on its frame
   * and wait until that frame can really be drawn. Throws when a frame cannot be read, so an
   * export never silently contains a wrong or missing picture.
   */
  async seekFrames(elements: VideoElement[], time: number): Promise<void> {
    for (const el of elements) {
      if (!clipActive(el, time)) continue;
      const entry = this.acquire(el);
      if (!entry) throw new Error(`The video file of "${el.name}" is not loaded.`);
      // A hair past the frame boundary, so rounding never lands on the frame before.
      const target = Math.min(videoTimeAt(el, time) + 0.001, lastFrameTime(entry.video));
      if (!(await seekVideo(entry.video, target))) throw new Error(`A frame of "${el.name}" could not be read from its video.`);
    }
  }

  /**
   * True when a playing video has presented a frame that was not painted yet (and marks it painted).
   * Lets the editor repaint at the video's frame rate instead of the display's.
   */
  takeNewFrames(): boolean {
    let any = false;
    for (const entry of this.live.values()) {
      if (entry.fresh || !entry.tracksFrames) any = true;
      entry.fresh = false;
    }
    return any;
  }

  /** Live videos sit in the page, practically invisible: Safari only decodes at full rate for videos in the document. */
  private host(): HTMLElement {
    if (!this.hostEl) {
      const el = document.createElement("div");
      el.setAttribute("aria-hidden", "true");
      el.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1";
      document.body.appendChild(el);
      this.hostEl = el;
    }
    return this.hostEl;
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
    video.muted = this.silent || el.muted || this.audioBlocked;
    video.src = src.url;
    // The export resamples sound when a clip is sped up or slowed down, which shifts its pitch.
    // The preview does the same, so what is heard here is what gets exported.
    if ("preservesPitch" in video) video.preservesPitch = false;
    video.style.cssText = "width:2px;height:2px";
    this.host().appendChild(video);
    const redraw = () => !this.disposed && this.notify();
    // Without requestVideoFrameCallback there is no signal for "the new frame is really there":
    // repaint at the event and once more shortly after.
    const settled = () => {
      redraw();
      if (!("requestVideoFrameCallback" in video)) window.setTimeout(redraw, 120);
    };
    video.addEventListener("loadeddata", settled);
    video.addEventListener("seeked", settled);
    // Feature detection: where the browser can tell us about presented frames, repaint only then.
    const tracksFrames = "requestVideoFrameCallback" in video;
    let frameRequest = 0;
    const entry: Live = {
      assetId: el.assetId,
      video,
      fresh: true,
      tracksFrames,
      cleanup: () => {
        video.removeEventListener("loadeddata", settled);
        video.removeEventListener("seeked", settled);
        if (tracksFrames) video.cancelVideoFrameCallback(frameRequest);
        releaseVideo(video);
        video.remove();
      },
    };
    if (tracksFrames) {
      const onFrame = () => {
        entry.fresh = true;
        // Paused (scrubbing): nothing is repainting on its own, so ask for it. "seeked" alone is not
        // enough, the frame a seek lands on can reach the compositor a moment after that event.
        if (video.paused) redraw();
        frameRequest = video.requestVideoFrameCallback(onFrame);
      };
      frameRequest = video.requestVideoFrameCallback(onFrame);
    }
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
    // A poster frame that could not be captured earlier gets another chance after a playback.
    for (const [key, poster] of [...this.posters]) if (poster.status === "error") this.posters.delete(key);
  }

  dispose() {
    this.disposed = true;
    this.stop();
    for (const slot of this.slots.values()) slot.canvas.width = slot.canvas.height = 0;
    this.slots.clear();
    for (const poster of this.posters.values()) if (poster.canvas) poster.canvas.width = poster.canvas.height = 0;
    this.posters.clear();
    this.audioListeners.clear();
    this.external.clear();
    this.hostEl?.remove();
    this.hostEl = null;
  }
}
