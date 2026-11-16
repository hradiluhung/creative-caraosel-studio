/**
 * The one and only document-to-pixels path.
 * The interactive editor, slide thumbnails and the exporter all call
 * buildSurfaceContent, so what you see on the canvas is what gets exported.
 */
import Konva from "konva";
import { coverCrop, type Surface } from "@/document/geometry";
import type { DesignElement, ImageElement, Project, ShapeElement, TextElement } from "@/document/schema";
import { FONT_FALLBACK, resolveItalic, resolveWeight, type FontFaceRequest } from "./fonts";
import type { RenderResources } from "./resources";
import { polygonPoints, starPoints } from "./shapes";

export const ELEMENT_NAME = "element";
export const BACKGROUND_NAME = "background";

function textNode(el: TextElement): Konva.Text {
  const weight = resolveWeight(el.fontFamily, el.fontWeight);
  const italic = resolveItalic(el.fontFamily, el.italic);
  return new Konva.Text({
    text: el.text,
    width: el.width,
    fontFamily: `"${el.fontFamily}", ${FONT_FALLBACK}`,
    fontSize: el.fontSize,
    fontStyle: `${italic ? "italic " : ""}${weight}`,
    fill: el.fill,
    align: el.align,
    lineHeight: el.lineHeight,
    letterSpacing: el.letterSpacing,
    wrap: "word",
  });
}

/** Rendered height of a text element (text boxes have fixed width, automatic height). */
export function measureTextHeight(el: TextElement): number {
  const node = textNode(el);
  const h = node.height();
  node.destroy();
  return Math.max(h, 1);
}

function imageNode(el: ImageElement, res: RenderResources): Konva.Shape {
  const image = res.getImage(el.assetId);
  if (!image) {
    // Placeholder while decoding, or when the asset is missing.
    return new Konva.Rect({ width: el.width, height: el.height, fill: "#d9d9d9", cornerRadius: el.cornerRadius });
  }
  return new Konva.Image({
    image,
    width: el.width,
    height: el.height,
    crop: coverCrop(image.naturalWidth, image.naturalHeight, el.width, el.height),
    cornerRadius: el.cornerRadius,
    x: el.flipX ? el.width : 0,
    y: el.flipY ? el.height : 0,
    scaleX: el.flipX ? -1 : 1,
    scaleY: el.flipY ? -1 : 1,
  });
}

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

export interface BuildOptions {
  /** Editor canvases are interactive, exports and thumbnails are not. */
  interactive: boolean;
}

/**
 * One element becomes one Konva.Group whose origin is the box center, so
 * rotation always happens around the center and the stored x/y stay the
 * top-left corner of the unrotated box.
 */
export function buildElementNode(el: DesignElement, res: RenderResources, opts: BuildOptions): Konva.Group {
  let inner: Konva.Shape;
  let height = el.height;
  if (el.type === "text") {
    inner = textNode(el);
    height = Math.max(inner.height(), 1);
  } else if (el.type === "image") {
    inner = imageNode(el, res);
  } else {
    inner = shapeNode(el);
  }
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
  group.add(inner);
  return group;
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
      fill: surface.background.type === "solid" ? surface.background.color : undefined,
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
