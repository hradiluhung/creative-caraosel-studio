/**
 * The one and only document-to-pixels path.
 * The interactive editor, slide thumbnails and the exporter all call
 * buildSurfaceContent, so what you see on the canvas is what gets exported.
 */
import Konva from "konva";
import { linearGradientPoints, type Surface } from "@/document/geometry";
import type {
  Background,
  BlendMode,
  DesignElement,
  ImageElement,
  ImageMask,
  OverlayElement,
  Project,
  ShapeElement,
  StickerElement,
  TextElement,
} from "@/document/schema";
import { mulberry32 } from "./adjust";
import { FONT_FALLBACK, resolveItalic, resolveWeight, type FontFaceRequest } from "./fonts";
import type { RenderResources } from "./resources";
import { polygonPoints, starPoints } from "./shapes";
import { displayText } from "./scene-text";
import { getSticker } from "./stickers";

export const ELEMENT_NAME = "element";
export const BACKGROUND_NAME = "background";

export interface BuildOptions {
  /** Editor canvases are interactive, exports and thumbnails are not. */
  interactive: boolean;
  /** Output pixels per document pixel; decides how sharp processed images need to be. */
  quality: number;
  /** Cap for processed image bitmaps (keeps the editor light, exports use the full size). */
  maxImageSide: number;
  /** Empty photo frames are drawn in the editor and in thumbnails, never in exports. */
  showPlaceholders: boolean;
  /** Editor only: quick previews first, sharp adjusted images from a worker (see ImageStore). */
  progressive?: boolean;
}

// --- Text -------------------------------------------------------------------

export { displayText };

function textNode(el: TextElement): Konva.Text {
  const weight = resolveWeight(el.fontFamily, el.fontWeight);
  const italic = resolveItalic(el.fontFamily, el.italic);
  return new Konva.Text({
    text: displayText(el),
    width: el.width,
    fontFamily: `"${el.fontFamily}", ${FONT_FALLBACK}`,
    fontSize: el.fontSize,
    fontStyle: `${italic ? "italic " : ""}${weight}`,
    fill: el.fill,
    align: el.align,
    lineHeight: el.lineHeight,
    letterSpacing: el.letterSpacing,
    wrap: "word",
    stroke: el.strokeWidth > 0 ? el.strokeColor : undefined,
    strokeWidth: el.strokeWidth,
    // Outline is painted behind the fill, so it never eats into the letters.
    fillAfterStrokeEnabled: true,
    lineJoin: "round",
  });
}

/** Rendered height of a text element (text boxes have fixed width, automatic height). */
export function measureTextHeight(el: TextElement): number {
  const node = textNode(el);
  const h = node.height();
  node.destroy();
  return Math.max(h, 1);
}

// --- Images -----------------------------------------------------------------

const KAPPA = 0.5522847498;

/** Trace an image mask outline. Only uses path calls every canvas context supports. */
export function traceMask(ctx: Konva.Context | CanvasRenderingContext2D, mask: ImageMask, w: number, h: number, radius: number) {
  ctx.beginPath();
  switch (mask) {
    case "ellipse": {
      const rx = w / 2;
      const ry = h / 2;
      const ox = rx * KAPPA;
      const oy = ry * KAPPA;
      ctx.moveTo(0, ry);
      ctx.bezierCurveTo(0, ry - oy, rx - ox, 0, rx, 0);
      ctx.bezierCurveTo(rx + ox, 0, w, ry - oy, w, ry);
      ctx.bezierCurveTo(w, ry + oy, rx + ox, h, rx, h);
      ctx.bezierCurveTo(rx - ox, h, 0, ry + oy, 0, ry);
      break;
    }
    case "arch": {
      const r = Math.min(w / 2, h);
      const o = r * KAPPA;
      ctx.moveTo(0, h);
      ctx.lineTo(0, r);
      ctx.bezierCurveTo(0, r - o, w / 2 - o * (w / 2 / r), 0, w / 2, 0);
      ctx.bezierCurveTo(w / 2 + o * (w / 2 / r), 0, w, r - o, w, r);
      ctx.lineTo(w, h);
      break;
    }
    case "triangle":
    case "hexagon":
    case "star": {
      const pts = mask === "triangle" ? [w / 2, 0, w, h, 0, h] : mask === "hexagon" ? polygonPoints(6, w, h) : starPoints(5, w, h);
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      break;
    }
    case "heart": {
      const x = (v: number) => (v / 100) * w;
      const y = (v: number) => (v / 92) * h;
      ctx.moveTo(x(50), y(90));
      ctx.bezierCurveTo(x(20), y(65), x(2), y(48), x(2), y(28));
      ctx.bezierCurveTo(x(2), y(12), x(14), y(2), x(27), y(2));
      ctx.bezierCurveTo(x(37), y(2), x(46), y(8), x(50), y(17));
      ctx.bezierCurveTo(x(54), y(8), x(63), y(2), x(73), y(2));
      ctx.bezierCurveTo(x(86), y(2), x(98), y(12), x(98), y(28));
      ctx.bezierCurveTo(x(98), y(48), x(80), y(65), x(50), y(90));
      break;
    }
    default: {
      const r = Math.max(0, Math.min(radius, w / 2, h / 2));
      ctx.moveTo(r, 0);
      ctx.lineTo(w - r, 0);
      if (r) ctx.arcTo(w, 0, w, r, r);
      ctx.lineTo(w, h - r);
      if (r) ctx.arcTo(w, h, w - r, h, r);
      ctx.lineTo(r, h);
      if (r) ctx.arcTo(0, h, 0, h - r, r);
      ctx.lineTo(0, r);
      if (r) ctx.arcTo(0, 0, r, 0, r);
    }
  }
  ctx.closePath();
}

function imageNodes(el: ImageElement, res: RenderResources, opts: BuildOptions): Konva.Shape[] {
  const outline = (config: Konva.ShapeConfig) =>
    new Konva.Shape({
      width: el.width,
      height: el.height,
      sceneFunc: (ctx, shape) => {
        traceMask(ctx, el.mask, el.width, el.height, el.cornerRadius);
        ctx.fillStrokeShape(shape);
      },
      ...config,
    });
  const bitmap = el.assetId ? res.getProcessed(el, { quality: opts.quality, maxSide: opts.maxImageSide, progressive: opts.progressive }) : undefined;
  if (bitmap) {
    // The processed bitmap is used as a pattern fill, so border and shadow follow any mask shape.
    return [
      outline({
        fillPatternImage: bitmap as unknown as HTMLImageElement,
        fillPatternRepeat: "no-repeat",
        fillPatternScaleX: el.width / bitmap.width,
        fillPatternScaleY: el.height / bitmap.height,
        stroke: el.borderWidth > 0 ? el.borderColor : undefined,
        strokeWidth: el.borderWidth,
        lineJoin: "round",
      }),
    ];
  }
  if (!el.assetId && !opts.showPlaceholders) return [];
  // Empty frame (placeholder), or an image that is still decoding or missing.
  const nodes: Konva.Shape[] = [
    outline({ fill: "#dcdad5", stroke: el.assetId ? undefined : "#a8a49c", strokeWidth: el.assetId ? 0 : 3, dash: [14, 10] }),
  ];
  if (!el.assetId) {
    const s = Math.min(el.width, el.height) * 0.09;
    const cx = el.width / 2;
    const cy = el.height / 2;
    nodes.push(
      new Konva.Line({ points: [cx - s, cy, cx + s, cy], stroke: "#8b877f", strokeWidth: Math.max(2, s / 5), lineCap: "round" }),
      new Konva.Line({ points: [cx, cy - s, cx, cy + s], stroke: "#8b877f", strokeWidth: Math.max(2, s / 5), lineCap: "round" }),
    );
  }
  return nodes;
}

// --- Shapes, stickers, overlays ----------------------------------------------

function shapeNode(el: ShapeElement): Konva.Shape {
  const { width: w, height: h } = el;
  const paint = {
    fill: el.fill,
    stroke: el.strokeWidth > 0 ? el.stroke : undefined,
    strokeWidth: el.strokeWidth,
  };
  switch (el.shape) {
    case "rect":
      return new Konva.Rect({ width: w, height: h, cornerRadius: el.cornerRadius, ...paint });
    case "ellipse":
      return new Konva.Ellipse({ x: w / 2, y: h / 2, radiusX: w / 2, radiusY: h / 2, ...paint });
    case "triangle":
      return new Konva.Line({ points: [w / 2, 0, w, h, 0, h], closed: true, lineJoin: "round", ...paint });
    case "polygon":
      return new Konva.Line({ points: polygonPoints(el.sides, w, h), closed: true, lineJoin: "round", ...paint });
    case "star":
      return new Konva.Line({ points: starPoints(el.sides, w, h), closed: true, lineJoin: "round", ...paint });
    case "line":
      return new Konva.Line({
        points: [0, h / 2, w, h / 2],
        stroke: el.stroke,
        strokeWidth: Math.max(el.strokeWidth, 1),
        lineCap: "round",
        hitStrokeWidth: Math.max(el.strokeWidth, 24),
      });
    case "arrow": {
      const sw = Math.max(el.strokeWidth, 1);
      return new Konva.Arrow({
        points: [0, h / 2, w, h / 2],
        stroke: el.stroke,
        fill: el.stroke,
        strokeWidth: sw,
        pointerLength: sw * 3,
        pointerWidth: sw * 3,
        lineCap: "round",
        hitStrokeWidth: Math.max(sw, 24),
      });
    }
  }
}

function stickerNodes(el: StickerElement, opts: BuildOptions): Konva.Shape[] {
  const def = getSticker(el.stickerId);
  if (!def) return [new Konva.Rect({ width: el.width, height: el.height, stroke: "#c4321f", strokeWidth: 2, dash: [8, 6] })];
  const path = new Konva.Path({
    data: def.data,
    scaleX: el.width / def.width,
    scaleY: el.height / def.height,
    fill: def.mode === "fill" ? el.color : undefined,
    fillRule: def.evenOdd ? "evenodd" : "nonzero",
    stroke: def.mode === "stroke" ? el.color : undefined,
    strokeWidth: def.mode === "stroke" ? (def.strokeWidth ?? 4) : 0,
    lineCap: "round",
    lineJoin: "round",
  });
  // Thin line doodles would be nearly impossible to grab, so the whole box is a hit target.
  return opts.interactive ? [new Konva.Rect({ width: el.width, height: el.height, fill: "#000000", opacity: 0 }), path] : [path];
}

let grainTile: HTMLCanvasElement | null = null;
function grainPattern(): HTMLCanvasElement {
  if (!grainTile) {
    grainTile = document.createElement("canvas");
    grainTile.width = grainTile.height = 256;
    const ctx = grainTile.getContext("2d")!;
    const pixels = ctx.createImageData(256, 256);
    const rand = mulberry32(20261116);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const v = rand() * 255;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v;
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
  }
  return grainTile;
}

const withAlpha = (hex: string, alpha: number) =>
  hex.slice(0, 7) + Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0");

function overlayNode(el: OverlayElement): Konva.Shape {
  const { width: w, height: h } = el;
  if (el.overlay === "grain") {
    return new Konva.Rect({ width: w, height: h, fillPatternImage: grainPattern() as unknown as HTMLImageElement, fillPatternRepeat: "repeat" });
  }
  if (el.overlay === "light-leak") {
    const r = Math.hypot(w, h) * 0.75;
    return new Konva.Rect({
      width: w,
      height: h,
      fillRadialGradientStartPoint: { x: w * 0.95, y: h * 0.05 },
      fillRadialGradientEndPoint: { x: w * 0.95, y: h * 0.05 },
      fillRadialGradientStartRadius: 0,
      fillRadialGradientEndRadius: r,
      fillRadialGradientColorStops: [0, withAlpha(el.color, 1), 0.35, withAlpha(el.color, 0.55), 1, withAlpha(el.color, 0)],
    });
  }
  return new Konva.Rect({
    width: w,
    height: h,
    fillRadialGradientStartPoint: { x: w / 2, y: h / 2 },
    fillRadialGradientEndPoint: { x: w / 2, y: h / 2 },
    fillRadialGradientStartRadius: Math.min(w, h) * 0.3,
    fillRadialGradientEndRadius: Math.hypot(w, h) / 2,
    fillRadialGradientColorStops: [0, withAlpha(el.color, 0), 1, withAlpha(el.color, 1)],
  });
}

// --- Elements and surfaces ----------------------------------------------------

const COMPOSITE: Record<BlendMode, GlobalCompositeOperation> = {
  normal: "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "soft-light": "soft-light",
  "hard-light": "hard-light",
  "color-dodge": "color-dodge",
  "color-burn": "color-burn",
  difference: "difference",
};

/**
 * One element becomes one Konva.Group whose origin is the box center, so
 * rotation always happens around the center and the stored x/y stay the
 * top-left corner of the unrotated box.
 */
export function buildElementNode(el: DesignElement, res: RenderResources, opts: BuildOptions): Konva.Group {
  let nodes: Konva.Shape[];
  let height = el.height;
  /** The node that casts the element's shadow. */
  let caster: Konva.Shape | undefined;
  if (el.type === "text") {
    const text = textNode(el);
    height = Math.max(text.height(), 1);
    nodes = [text];
    caster = text;
    if (el.background) {
      const p = el.background.padding;
      const box = new Konva.Rect({ x: -p, y: -p, width: el.width + p * 2, height: height + p * 2, fill: el.background.color, cornerRadius: el.background.radius });
      nodes.unshift(box);
      caster = box;
    }
  } else if (el.type === "image") {
    nodes = imageNodes(el, res, opts);
    caster = nodes[0];
  } else if (el.type === "shape") {
    nodes = [shapeNode(el)];
    caster = nodes[0];
  } else if (el.type === "sticker") {
    nodes = stickerNodes(el, opts);
    caster = nodes[nodes.length - 1];
  } else {
    nodes = [overlayNode(el)];
  }
  if (caster && el.shadow) {
    caster.setAttrs({
      shadowColor: el.shadow.color,
      shadowOpacity: el.shadow.opacity,
      shadowBlur: el.shadow.blur,
      shadowOffsetX: el.shadow.offsetX,
      shadowOffsetY: el.shadow.offsetY,
    });
  }
  if (el.blendMode !== "normal") nodes.forEach((n) => n.globalCompositeOperation(COMPOSITE[el.blendMode]));

  const group = new Konva.Group({
    id: el.id,
    name: ELEMENT_NAME,
    x: el.x + el.width / 2,
    y: el.y + height / 2,
    offsetX: el.width / 2,
    offsetY: height / 2,
    width: el.width,
    height,
    rotation: el.rotation,
    opacity: el.opacity,
    visible: el.visible,
    listening: opts.interactive && !el.locked,
    draggable: opts.interactive && !el.locked,
  });
  nodes.forEach((n) => group.add(n));
  return group;
}

function backgroundFill(bg: Background, width: number, height: number): Konva.RectConfig {
  if (bg.type === "solid") return { fill: bg.color };
  if (bg.type === "linear") {
    const { start, end } = linearGradientPoints(bg.angle, width, height);
    return {
      fillLinearGradientStartPoint: start,
      fillLinearGradientEndPoint: end,
      fillLinearGradientColorStops: bg.stops.flatMap((s) => [s.offset, s.color]),
    };
  }
  if (bg.type === "radial") {
    const center = { x: width / 2, y: height / 2 };
    return {
      fillRadialGradientStartPoint: center,
      fillRadialGradientEndPoint: center,
      fillRadialGradientStartRadius: 0,
      fillRadialGradientEndRadius: Math.hypot(width, height) / 2,
      fillRadialGradientColorStops: bg.stops.flatMap((s) => [s.offset, s.color]),
    };
  }
  return {};
}

/** Background plus all elements in layer order, clipped to the surface bounds. */
export function buildSurfaceContent(surface: Surface, res: RenderResources, opts: BuildOptions): Konva.Group {
  const content = new Konva.Group({
    clip: { x: 0, y: 0, width: surface.width, height: surface.height },
  });
  content.add(
    new Konva.Rect({
      name: BACKGROUND_NAME,
      width: surface.width,
      height: surface.height,
      ...backgroundFill(surface.background, surface.width, surface.height),
      listening: opts.interactive,
    }),
  );
  for (const el of surface.elements) content.add(buildElementNode(el, res, opts));
  return content;
}

/** Font faces a project needs before it can be measured or rendered correctly. */
export function collectFonts(project: Project): FontFaceRequest[] {
  const out: FontFaceRequest[] = [];
  const scan = (els: DesignElement[]) => {
    for (const el of els) {
      if (el.type !== "text") continue;
      out.push({
        family: el.fontFamily,
        weight: resolveWeight(el.fontFamily, el.fontWeight),
        italic: resolveItalic(el.fontFamily, el.italic),
      });
    }
  };
  scan(project.panorama.elements);
  project.slides.forEach((s) => scan(s.elements));
  return out;
}
