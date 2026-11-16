/**
 * Export. Renders each export frame through the same scene builder the editor uses
 * (src/render/scene.ts). Still slides become images at the document's native pixel size;
 * video slides become one video file each (src/export/video.ts). Slides are never merged
 * into one video: the result is always one file per slide, in slide order.
 */
import JSZip from "jszip";
import Konva from "konva";
import { getExportFrames, getSurface, type ExportFrame } from "@/document/geometry";
import { usedAssetIds } from "@/document/operations";
import type { Project } from "@/document/schema";
import { frameDuration, videoElements } from "@/document/timing";
import { ensureFontsLoaded } from "@/render/fonts";
import type { ImageStore } from "@/render/resources";
import { buildSurfaceContent, collectFonts } from "@/render/scene";
import { FORMAT_INFO, slideFileName, slideFileNameWithExt, type ImageFormat } from "./naming";
import type { AudioCodec, VideoQuality, VideoResolution } from "./videoSupport";

/** Conservative canvas area limit (iOS Safari refuses larger canvases). */
export const MAX_CANVAS_AREA = 16_777_216;

export interface RenderFrameOptions {
  /** Output pixels per document pixel. 1 = native size. */
  pixelRatio: number;
  mime: string;
  /** 0..1, only used by lossy formats. */
  quality?: number;
  /** Fill behind transparent areas (formats without alpha need one). */
  matte?: string;
  /** Draw empty photo frames (thumbnails yes, real exports no). */
  showPlaceholders?: boolean;
}

export function maxPixelRatio(width: number, height: number) {
  return Math.sqrt(MAX_CANVAS_AREA / (width * height));
}

export async function renderFrame(
  project: Project,
  frame: ExportFrame,
  res: ImageStore,
  opts: RenderFrameOptions,
): Promise<Blob> {
  const surface = getSurface(project, frame.surfaceId);
  if (!surface) throw new Error(`Slide ${frame.slideIndex + 1}: surface not found`);
  // Stills show every video at its poster time; that exact frame has to be captured first.
  await res.videos.preparePosters(videoElements(surface.elements));
  const container = document.createElement("div");
  const stage = new Konva.Stage({ container, width: frame.width, height: frame.height });
  try {
    const layer = new Konva.Layer({ listening: false });
    stage.add(layer);
    if (opts.matte) layer.add(new Konva.Rect({ width: frame.width, height: frame.height, fill: opts.matte }));
    const content = buildSurfaceContent(surface, res, {
      interactive: false,
      quality: opts.pixelRatio,
      maxImageSide: 8192,
      showPlaceholders: opts.showPlaceholders ?? false,
    });
    // Slicing a panorama is just an offset: no element is ever re-laid out per slide.
    content.position({ x: -frame.x, y: -frame.y });
    layer.add(content);
    layer.draw();
    const blob = await new Promise<Blob | null>((resolve) => {
      void stage.toBlob({
        pixelRatio: opts.pixelRatio,
        mimeType: opts.mime,
        quality: opts.quality,
        callback: (b: Blob | null) => resolve(b),
      });
    });
    if (!blob) throw new Error(`Slide ${frame.slideIndex + 1}: the browser could not encode the image`);
    return blob;
  } finally {
    stage.destroy();
  }
}

export interface ExportOptions {
  format: ImageFormat;
  quality: number;
  scale: number;
  /** Slide indices to export, in any order. Output is always in slide order. */
  slideIndices: number[];
  /**
   * How slides that contain video are exported. Left out (or mode "still"): as an image of
   * the poster frames, like any other slide.
   */
  video?: { mode: "video" | "still"; resolution: VideoResolution; quality: VideoQuality; audio: AudioCodec | null };
  signal?: AbortSignal;
  /** done / total count slides; detail describes the work inside the current slide. */
  onProgress?: (done: number, total: number, detail?: string) => void;
}

export interface ExportedFile {
  name: string;
  blob: Blob;
  width: number;
  height: number;
  kind: "image" | "video";
  /** Video files only. */
  duration?: number;
  hasAudio?: boolean;
  /** Recorded in real time by the fallback (format depends on the browser, no sound). */
  realtime?: boolean;
}

export class ExportCancelled extends Error {
  constructor() {
    super("Export cancelled");
    this.name = "ExportCancelled";
  }
}

async function readDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

export async function exportSlides(project: Project, res: ImageStore, opts: ExportOptions): Promise<ExportedFile[]> {
  const frames = getExportFrames(project)
    .filter((f) => opts.slideIndices.includes(f.slideIndex))
    .sort((a, b) => a.slideIndex - b.slideIndex);
  if (frames.length === 0) throw new Error("No slides selected for export");
  if (opts.scale > maxPixelRatio(project.width, project.height)) {
    throw new Error("The chosen resolution is larger than this device can render. Pick a smaller scale.");
  }
  const check = () => {
    if (opts.signal?.aborted) throw new ExportCancelled();
  };

  await Promise.all([ensureFontsLoaded(collectFonts(project)), res.preload(usedAssetIds(project))]);
  check();
  const missing = [...usedAssetIds(project)].filter((id) => res.isMissing(id));
  if (missing.length > 0) {
    throw new Error(`${missing.length} image or video file(s) used in this project could not be loaded, so the export was stopped.`);
  }
  const clips = [...videoElements(project.panorama.elements), ...project.slides.flatMap((s) => videoElements(s.elements))];
  await res.videos.preparePosters(clips);
  check();
  const unreadable = clips.filter((el) => res.videos.posterFailed(el));
  if (unreadable.length > 0) {
    throw new Error(`The poster frame of "${unreadable[0].name}" could not be read from its video, so the export was stopped.`);
  }

  const info = FORMAT_INFO[opts.format];
  const files: ExportedFile[] = [];
  opts.onProgress?.(0, frames.length);
  for (const frame of frames) {
    check();
    if (opts.video?.mode === "video" && frameDuration(project, frame) > 0) {
      let lastShown = 0;
      // The encoder and demuxer are a large chunk of code: only loaded when a video is really exported.
      const { exportVideoSlide } = await import("./video");
      const result = await exportVideoSlide(project, frame, res, {
        resolution: opts.video.resolution,
        quality: opts.video.quality,
        audio: opts.video.audio,
        check,
        onProgress: (n, total) => {
          // A few updates per second are plenty; every frame would only slow the export down.
          if (n !== total && n - lastShown < 6) return;
          lastShown = n;
          opts.onProgress?.(files.length + n / total, frames.length, `Slide ${frame.slideIndex + 1}: frame ${n} of ${total}`);
        },
      });
      files.push({
        name: slideFileNameWithExt(project.name, frame.slideIndex, project.slides.length, result.ext),
        blob: result.blob,
        width: result.width,
        height: result.height,
        kind: "video",
        duration: result.duration,
        hasAudio: result.hasAudio,
        realtime: result.realtime,
      });
      opts.onProgress?.(files.length, frames.length);
      await new Promise((r) => setTimeout(r, 0));
      continue;
    }
    const blob = await renderFrame(project, frame, res, {
      pixelRatio: opts.scale,
      mime: info.mime,
      quality: opts.format === "jpeg" ? opts.quality : undefined,
      matte: opts.format === "jpeg" ? "#ffffff" : undefined,
    });
    // Verify the encoded file really has the expected pixel size.
    const expected = { width: Math.round(frame.width * opts.scale), height: Math.round(frame.height * opts.scale) };
    const actual = await readDimensions(blob);
    if (actual.width !== expected.width || actual.height !== expected.height) {
      throw new Error(
        `Slide ${frame.slideIndex + 1} rendered at ${actual.width}x${actual.height}, expected ${expected.width}x${expected.height}`,
      );
    }
    files.push({
      name: slideFileName(project.name, frame.slideIndex, project.slides.length, opts.format),
      blob,
      ...actual,
      kind: "image",
    });
    opts.onProgress?.(files.length, frames.length);
    // Yield so the UI can paint progress and react to Cancel.
    await new Promise((r) => setTimeout(r, 0));
  }
  return files;
}

export async function packageZip(files: ExportedFile[], signal?: AbortSignal): Promise<Blob> {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.blob);
  // Images are already compressed, so STORE keeps packaging fast.
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  if (signal?.aborted) throw new ExportCancelled();
  return blob;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Small preview render used for slide thumbnails and dashboard covers. */
export async function renderThumbnail(project: Project, frame: ExportFrame, res: ImageStore, maxSide = 320): Promise<Blob> {
  const pixelRatio = Math.min(maxSide / Math.max(frame.width, frame.height), 1);
  return renderFrame(project, frame, res, { pixelRatio, mime: "image/jpeg", quality: 0.8, matte: "#ffffff", showPlaceholders: true });
}
