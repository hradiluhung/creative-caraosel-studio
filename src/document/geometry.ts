/**
 * Single source of truth for document geometry.
 * The editor preview, thumbnails and the exporter all derive sizes and slice
 * rectangles from these functions, which is what keeps export identical to preview.
 */
import type { Background, DesignElement, Project } from "./schema";

export const PANORAMA_ID = "panorama";

export type Orientation = "portrait" | "square" | "landscape";

export interface CanvasPreset {
  id: string;
  /** Aspect ratio as width:height, for example "4:5". */
  ratio: string;
  orientation: Orientation;
  /** Where this format is typically used. */
  usage: string;
  width: number;
  height: number;
}

/**
 * All presets are 1080 px on their short Instagram-facing side, except 16:9
 * which uses 1920 x 1080 so the ratio stays exact in whole pixels.
 */
export const CANVAS_PRESETS: CanvasPreset[] = [
  { id: "4:5", ratio: "4:5", orientation: "portrait", usage: "Feed portrait", width: 1080, height: 1350 },
  { id: "3:4", ratio: "3:4", orientation: "portrait", usage: "Feed tall", width: 1080, height: 1440 },
  { id: "2:3", ratio: "2:3", orientation: "portrait", usage: "Classic photo", width: 1080, height: 1620 },
  { id: "9:16", ratio: "9:16", orientation: "portrait", usage: "Story / Reels", width: 1080, height: 1920 },
  { id: "1:1", ratio: "1:1", orientation: "square", usage: "Feed square", width: 1080, height: 1080 },
  { id: "5:4", ratio: "5:4", orientation: "landscape", usage: "Feed landscape", width: 1080, height: 864 },
  { id: "4:3", ratio: "4:3", orientation: "landscape", usage: "Classic landscape", width: 1080, height: 810 },
  { id: "3:2", ratio: "3:2", orientation: "landscape", usage: "Classic photo", width: 1080, height: 720 },
  { id: "16:9", ratio: "16:9", orientation: "landscape", usage: "Widescreen", width: 1920, height: 1080 },
  { id: "1.91:1", ratio: "1.91:1", orientation: "landscape", usage: "Feed widest", width: 1080, height: 566 },
];

export const DEFAULT_PRESET_ID = "4:5";

/** Simplified width:height ratio of any size, for example 1080 x 1350 -> "4:5". */
export function aspectRatioLabel(width: number, height: number): string {
  const known = CANVAS_PRESETS.find((p) => p.width * height === p.height * width);
  if (known) return known.ratio;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const w = Math.round(width);
  const h = Math.round(height);
  if (w < 1 || h < 1) return "";
  const d = gcd(w, h);
  // Awkward sizes would reduce to something unreadable like 540:283, so show a decimal instead.
  return w / d <= 32 && h / d <= 32 ? `${w / d}:${h / d}` : `${Number((w / h).toFixed(2))}:1`;
}

/** An editable canvas: one slide (independent) or the whole panorama (seamless). */
export interface Surface {
  id: string;
  width: number;
  height: number;
  background: Background;
  elements: DesignElement[];
  /** Manual length in seconds (video slides). Unset: as long as the longest clip. */
  duration?: number;
}

/** A rectangle of a surface that becomes one exported file. */
export interface ExportFrame {
  slideIndex: number;
  slideId: string;
  surfaceId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getSurfaces(project: Project): Surface[] {
  if (project.mode === "seamless") {
    return [
      {
        id: PANORAMA_ID,
        width: project.width * project.slides.length,
        height: project.height,
        background: project.panorama.background,
        elements: project.panorama.elements,
      },
    ];
  }
  return project.slides.map((s) => ({
    id: s.id,
    width: project.width,
    height: project.height,
    background: s.background,
    elements: s.elements,
    duration: s.duration,
  }));
}

export function getSurface(project: Project, surfaceId: string): Surface | undefined {
  return getSurfaces(project).find((s) => s.id === surfaceId);
}

export function getExportFrames(project: Project): ExportFrame[] {
  return project.slides.map((slide, i) => ({
    slideIndex: i,
    slideId: slide.id,
    surfaceId: project.mode === "seamless" ? PANORAMA_ID : slide.id,
    x: project.mode === "seamless" ? i * project.width : 0,
    y: 0,
    width: project.width,
    height: project.height,
  }));
}

/** Slide boundaries inside a surface (x offsets of every slide's left edge). */
export function getSlideOffsets(project: Project, surfaceId: string): number[] {
  if (surfaceId !== PANORAMA_ID) return [0];
  return project.slides.map((_, i) => i * project.width);
}

export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Source rectangle that makes an image cover a box without distortion (centered). */
export function coverCrop(naturalW: number, naturalH: number, boxW: number, boxH: number): Crop {
  if (naturalW <= 0 || naturalH <= 0 || boxW <= 0 || boxH <= 0) {
    return { x: 0, y: 0, width: Math.max(naturalW, 0), height: Math.max(naturalH, 0) };
  }
  const boxRatio = boxW / boxH;
  const natRatio = naturalW / naturalH;
  if (natRatio > boxRatio) {
    const width = naturalH * boxRatio;
    return { x: (naturalW - width) / 2, y: 0, width, height: naturalH };
  }
  const height = naturalW / boxRatio;
  return { x: 0, y: (naturalH - height) / 2, width: naturalW, height };
}

/** Largest size with the natural aspect ratio that fits inside max bounds. */
export function fitWithin(naturalW: number, naturalH: number, maxW: number, maxH: number) {
  const scale = Math.min(maxW / naturalW, maxH / naturalH, 1);
  return { width: Math.round(naturalW * scale), height: Math.round(naturalH * scale) };
}

/** Scale and offset that fit a surface into a viewport with padding. */
export function fitToViewport(surfaceW: number, surfaceH: number, viewW: number, viewH: number, padding = 32) {
  const availW = Math.max(viewW - padding * 2, 1);
  const availH = Math.max(viewH - padding * 2, 1);
  const scale = Math.min(availW / surfaceW, availH / surfaceH);
  return { scale, x: (viewW - surfaceW * scale) / 2, y: (viewH - surfaceH * scale) / 2 };
}

/** Axis-aligned bounding box of a rotated element. */
export function rotatedBounds(el: Pick<DesignElement, "x" | "y" | "width" | "height" | "rotation">) {
  const rad = (el.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = el.width * cos + el.height * sin;
  const h = el.width * sin + el.height * cos;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

/** Indices of the slides an element touches inside a panorama. */
export function slidesTouched(project: Project, el: DesignElement): number[] {
  const b = rotatedBounds(el);
  const first = Math.max(0, Math.floor(b.x / project.width));
  const last = Math.min(project.slides.length - 1, Math.ceil((b.x + b.width) / project.width) - 1);
  const out: number[] = [];
  for (let i = first; i <= last; i++) out.push(i);
  return out;
}

/**
 * Start and end points of a CSS-style linear gradient inside a box.
 * 0deg points up, 90deg points right; the line is long enough to reach the corners.
 */
export function linearGradientPoints(angleDeg: number, width: number, height: number) {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  const cx = width / 2;
  const cy = height / 2;
  return { start: { x: cx - dx * half, y: cy - dy * half }, end: { x: cx + dx * half, y: cy + dy * half } };
}
