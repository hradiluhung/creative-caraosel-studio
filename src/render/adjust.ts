/**
 * Pure pixel pipeline for non-destructive image adjustments.
 * Works on a plain RGBA byte array, so it runs (and is tested) outside the browser,
 * and can move into a Web Worker later without changes.
 */
import type { Adjustments } from "@/document/schema";

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Deterministic PRNG so grain looks identical in preview and export. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Three box-blur passes approximate a gaussian blur. Alpha is left untouched. */
export function boxBlur(src: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return src.slice();
  const a = src.slice();
  const b = new Uint8ClampedArray(src.length);
  const pass = (from: Uint8ClampedArray, to: Uint8ClampedArray, horizontal: boolean) => {
    const lines = horizontal ? height : width;
    const len = horizontal ? width : height;
    const step = horizontal ? 4 : width * 4;
    const win = r * 2 + 1;
    for (let line = 0; line < lines; line++) {
      const base = horizontal ? line * width * 4 : line * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += from[base + Math.min(len - 1, Math.max(0, k)) * step + c];
        for (let i = 0; i < len; i++) {
          to[base + i * step + c] = sum / win;
          const add = Math.min(len - 1, i + r + 1);
          const drop = Math.max(0, i - r);
          sum += from[base + add * step + c] - from[base + drop * step + c];
        }
      }
      for (let i = 0; i < len; i++) to[base + i * step + 3] = from[base + i * step + 3];
    }
  };
  for (let n = 0; n < 3; n++) {
    pass(a, b, true);
    pass(b, a, false);
  }
  return a;
}

/**
 * Apply adjustments in place.
 * Order: blur / sharpen (spatial) -> tone and color (per pixel) -> vignette -> grain.
 */
export function applyAdjustments(data: Uint8ClampedArray, width: number, height: number, adj: Adjustments): void {
  const maxSide = Math.max(width, height);

  if (adj.blur > 0) {
    data.set(boxBlur(data, width, height, (adj.blur / 100) * 0.03 * maxSide));
  }
  if (adj.sharpness > 0) {
    // Unsharp mask: push every pixel away from its blurred neighbourhood.
    const soft = boxBlur(data, width, height, Math.max(1, 0.0015 * maxSide));
    const k = (adj.sharpness / 100) * 1.5;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp(data[i] + (data[i] - soft[i]) * k);
      data[i + 1] = clamp(data[i + 1] + (data[i + 1] - soft[i + 1]) * k);
      data[i + 2] = clamp(data[i + 2] + (data[i + 2] - soft[i + 2]) * k);
    }
  }

  const brightness = (adj.brightness / 100) * 96;
  const exposure = Math.pow(2, adj.exposure / 100);
  const contrast = adj.contrast >= 0 ? 1 + (adj.contrast / 100) * 1.2 : 1 + adj.contrast / 100;
  const saturation = 1 + adj.saturation / 100;
  const warm = (adj.temperature / 100) * 40;
  const tint = (adj.tint / 100) * 30;
  const highlights = adj.highlights / 100;
  const shadows = adj.shadows / 100;
  const fade = adj.fade / 100;
  const gray = adj.grayscale / 100;
  const tone = brightness !== 0 || exposure !== 1 || contrast !== 1 || highlights !== 0 || shadows !== 0 || fade !== 0;
  const color = saturation !== 1 || warm !== 0 || tint !== 0 || gray !== 0;

  if (tone || color) {
    // Tone changes are identical for every channel value, so they are baked into a lookup table.
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      let x = v * exposure + brightness;
      x = (x - 128) * contrast + 128;
      const n = Math.min(1, Math.max(0, x / 255));
      // Highlights act on the bright half, shadows on the dark half, with smooth falloff.
      x += highlights * 70 * n * n + shadows * 70 * (1 - n) * (1 - n);
      // Fade lifts the blacks and slightly lowers the whites, like a matte print.
      x = x * (1 - fade * 0.25) + fade * 0.25 * 255 * 0.45 + fade * 18;
      lut[v] = clamp(x);
    }
    for (let i = 0; i < data.length; i += 4) {
      let r = lut[data[i]];
      let g = lut[data[i + 1]];
      let b = lut[data[i + 2]];
      if (color) {
        r += warm;
        b -= warm;
        g -= tint;
        r += tint * 0.5;
        b += tint * 0.5;
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const s = saturation * (1 - gray);
        r = l + (r - l) * s;
        g = l + (g - l) * s;
        b = l + (b - l) * s;
      }
      data[i] = clamp(r);
      data[i + 1] = clamp(g);
      data[i + 2] = clamp(b);
    }
  }

  if (adj.vignette > 0) {
    const strength = adj.vignette / 100;
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    const maxD = Math.hypot(cx, cy) || 1;
    for (let y = 0; y < height; y++) {
      const dy2 = (y - cy) * (y - cy);
      for (let x = 0; x < width; x++) {
        // Math.sqrt is several times faster than Math.hypot in this per-pixel loop.
        const d = Math.sqrt((x - cx) * (x - cx) + dy2) / maxD;
        const t = Math.max(0, (d - 0.45) / 0.55);
        const f = 1 - strength * t * t;
        const i = (y * width + x) * 4;
        data[i] *= f;
        data[i + 1] *= f;
        data[i + 2] *= f;
      }
    }
  }

  if (adj.grain > 0) {
    const rand = mulberry32(width * 73856093 + height * 19349663);
    const amp = (adj.grain / 100) * 60;
    for (let i = 0; i < data.length; i += 4) {
      const n = (rand() - 0.5) * amp;
      data[i] = clamp(data[i] + n);
      data[i + 1] = clamp(data[i + 1] + n);
      data[i + 2] = clamp(data[i + 2] + n);
    }
  }
}

export interface FilterPreset {
  id: string;
  name: string;
  adjustments: Partial<Adjustments>;
}

/** Built-in looks. A filter is nothing more than a named set of adjustments, so it stays editable. */
export const FILTER_PRESETS: FilterPreset[] = [
  { id: "vintage", name: "Vintage", adjustments: { temperature: 28, saturation: -18, contrast: -8, fade: 35, vignette: 30, grain: 18 } },
  { id: "analog", name: "Analog film", adjustments: { temperature: 12, tint: 6, contrast: 12, saturation: -6, fade: 18, grain: 28 } },
  { id: "cinematic", name: "Cinematic", adjustments: { contrast: 28, saturation: -12, temperature: -10, shadows: -20, highlights: -10, vignette: 35 } },
  { id: "bw", name: "Black & white", adjustments: { grayscale: 100, contrast: 22 } },
  { id: "warm", name: "Warm", adjustments: { temperature: 35, saturation: 8, brightness: 4 } },
  { id: "cool", name: "Cool", adjustments: { temperature: -35, saturation: 4, contrast: 6 } },
  { id: "faded", name: "Faded", adjustments: { fade: 60, contrast: -15, saturation: -20 } },
  { id: "grain", name: "Film grain", adjustments: { grain: 55, contrast: 8 } },
  { id: "editorial", name: "Editorial", adjustments: { contrast: 18, saturation: -25, highlights: 12, sharpness: 30 } },
  { id: "retro", name: "Retro", adjustments: { temperature: 20, tint: -12, saturation: 22, fade: 25, contrast: 10, vignette: 20 } },
];
