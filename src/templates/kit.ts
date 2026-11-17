/**
 * Small building blocks for templates written in code (built-in templates and photo journals).
 * Everything returns ordinary document elements; nothing here is special to templates.
 */
import { createPlaceholder, createProject, createShape, createSticker, createText } from "@/document/factory";
import { PANORAMA_ID } from "@/document/geometry";
import { addElements, setBackground } from "@/document/operations";
import type { Background, DesignElement, ImageElement, Project, ShapeElement, ShapeKind, StickerElement, TextElement } from "@/document/schema";
import { getSticker } from "@/render/stickers";

export const P = { centerX: 0, centerY: 0, maxWidth: 1000, maxHeight: 1000 };
export type Box = [x: number, y: number, w: number, h: number];

export function text(content: string, [x, y, w]: [number, number, number], o: Partial<TextElement> & { size: number }): TextElement {
  const { size, ...rest } = o;
  const lineHeight = rest.lineHeight ?? 1.15;
  const lines = content.split("\n").length;
  return {
    ...createText("body", P),
    text: content,
    name: content.replace(/\s+/g, " ").slice(0, 40),
    x,
    y,
    width: w,
    // Estimate only: the renderer always measures the real height once the font is loaded.
    height: Math.round(lines * size * lineHeight),
    fontSize: size,
    fontFamily: "Inter",
    fontWeight: 400,
    align: "left",
    lineHeight,
    ...rest,
  };
}
export const photo = ([x, y, width, height]: Box, o: Partial<ImageElement> = {}): ImageElement => ({ ...createPlaceholder({ x, y, width, height }), ...o });
export const shape = (kind: ShapeKind, [x, y, width, height]: Box, fill: string, o: Partial<ShapeElement> = {}): ShapeElement => ({
  ...createShape(kind, P),
  x,
  y,
  width,
  height,
  fill,
  stroke: fill,
  ...o,
});
export function sticker(id: string, [x, y, width]: [number, number, number], color: string, o: Partial<StickerElement> = {}): StickerElement {
  const def = getSticker(id)!;
  return { ...createSticker(id, def.name, def.width / def.height, P), x, y, width, height: Math.round((width * def.height) / def.width), color, ...o };
}
export const solid = (color: string): Background => ({ type: "solid", color });
export const linear = (angle: number, ...colors: string[]): Background => ({ type: "linear", angle, stops: colors.map((color, i) => ({ offset: i / (colors.length - 1), color })) });
export const shadow = { color: "#000000", opacity: 0.28, blur: 30, offsetX: 0, offsetY: 14 };

export interface SlideSpec {
  bg: Background;
  els: DesignElement[];
}

export function independent(name: string, width: number, height: number, slides: SlideSpec[]): Project {
  let p = createProject({ name, width, height, slideCount: slides.length, mode: "independent" }, new Date(0));
  slides.forEach((s, i) => {
    const id = p.slides[i].id;
    p = addElements(setBackground(p, id, s.bg), id, s.els);
  });
  return p;
}

export function seamless(name: string, width: number, height: number, slideCount: number, bg: Background, els: DesignElement[]): Project {
  const p = createProject({ name, width, height, slideCount, mode: "seamless" }, new Date(0));
  return addElements(setBackground(p, PANORAMA_ID, bg), PANORAMA_ID, els);
}

export const W = 1080;
export const H = 1350;
