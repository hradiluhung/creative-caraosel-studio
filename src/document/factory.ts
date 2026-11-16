import { createId } from "./ids";
import { fitWithin, type Surface } from "./geometry";
import {
  SCHEMA_VERSION,
  type AssetRef,
  type Background,
  type ImageElement,
  type Project,
  type ProjectMode,
  type ShapeElement,
  type ShapeKind,
  type Slide,
  type TextElement,
} from "./schema";

export const DEFAULT_BACKGROUND: Background = { type: "solid", color: "#ffffff" };

export function createSlide(index: number, background: Background = DEFAULT_BACKGROUND): Slide {
  return { id: createId(), name: `Slide ${index + 1}`, background, elements: [] };
}

export interface NewProjectInput {
  name: string;
  width: number;
  height: number;
  slideCount: number;
  mode: ProjectMode;
}

export function createProject(input: NewProjectInput, now = new Date()): Project {
  const iso = now.toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: createId(),
    name: input.name.trim() || "Untitled project",
    mode: input.mode,
    width: Math.round(input.width),
    height: Math.round(input.height),
    slides: Array.from({ length: input.slideCount }, (_, i) => createSlide(i)),
    panorama: { background: DEFAULT_BACKGROUND, elements: [] },
    assets: [],
    createdAt: iso,
    updatedAt: iso,
  };
}

const base = (name: string) => ({
  id: createId(),
  name,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
});

/** Center of the area new elements should land in. */
export interface Placement {
  centerX: number;
  centerY: number;
  maxWidth: number;
  maxHeight: number;
}

export function placementFor(surface: Pick<Surface, "width" | "height">, slideWidth: number, slideOffset = 0): Placement {
  return {
    centerX: slideOffset + slideWidth / 2,
    centerY: surface.height / 2,
    maxWidth: slideWidth,
    maxHeight: surface.height,
  };
}

export type TextPreset = "heading" | "subheading" | "body";

const TEXT_PRESETS: Record<TextPreset, Pick<TextElement, "text" | "fontFamily" | "fontSize" | "fontWeight">> = {
  heading: { text: "Add a heading", fontFamily: "Playfair Display", fontSize: 96, fontWeight: 700 },
  subheading: { text: "Add a subheading", fontFamily: "Inter", fontSize: 54, fontWeight: 600 },
  body: { text: "Add body text", fontFamily: "Inter", fontSize: 34, fontWeight: 400 },
};

export function createText(preset: TextPreset, p: Placement): TextElement {
  const t = TEXT_PRESETS[preset];
  const width = Math.round(p.maxWidth * 0.8);
  const height = Math.round(t.fontSize * 1.2);
  return {
    ...base(t.text),
    type: "text",
    x: Math.round(p.centerX - width / 2),
    y: Math.round(p.centerY - height / 2),
    width,
    height,
    ...t,
    italic: false,
    fill: "#111111",
    align: "center",
    lineHeight: 1.2,
    letterSpacing: 0,
  };
}

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: "Rectangle",
  ellipse: "Ellipse",
  triangle: "Triangle",
  polygon: "Polygon",
  star: "Star",
  line: "Line",
  arrow: "Arrow",
};

export function createShape(shape: ShapeKind, p: Placement): ShapeElement {
  const isLine = shape === "line" || shape === "arrow";
  const size = Math.round(Math.min(p.maxWidth, p.maxHeight) * 0.35);
  const width = isLine ? Math.round(p.maxWidth * 0.5) : size;
  const height = isLine ? 40 : size;
  return {
    ...base(SHAPE_LABELS[shape]),
    type: "shape",
    shape,
    x: Math.round(p.centerX - width / 2),
    y: Math.round(p.centerY - height / 2),
    width,
    height,
    fill: "#111111",
    stroke: "#111111",
    strokeWidth: isLine ? 8 : 0,
    cornerRadius: 0,
    sides: shape === "star" ? 5 : 6,
  };
}

export function createImage(asset: AssetRef, p: Placement): ImageElement {
  const { width, height } = fitWithin(asset.width, asset.height, p.maxWidth * 0.8, p.maxHeight * 0.8);
  return {
    ...base(asset.name.replace(/\.[^.]+$/, "") || "Image"),
    type: "image",
    assetId: asset.id,
    x: Math.round(p.centerX - width / 2),
    y: Math.round(p.centerY - height / 2),
    width,
    height,
    flipX: false,
    flipY: false,
    cornerRadius: 0,
  };
}
