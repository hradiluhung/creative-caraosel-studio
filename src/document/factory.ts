import { createId } from "./ids";
import { fitWithin, type Surface } from "./geometry";
import {
  NEUTRAL_ADJUSTMENTS,
  SCHEMA_VERSION,
  type AssetRef,
  type Background,
  type BlendMode,
  type ImageElement,
  type OverlayElement,
  type OverlayKind,
  type StickerElement,
  type Project,
  type ProjectMode,
  type ShapeElement,
  type ShapeKind,
  type Slide,
  type TextElement,
  type VideoElement,
} from "./schema";
import { MAX_VIDEO_SLIDE_SECONDS } from "./timing";

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
    brandKitId: null,
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
  blendMode: "normal" as const,
  shadow: null,
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
    transform: "none",
    strokeColor: "#000000",
    strokeWidth: 0,
    background: null,
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
    ...IMAGE_DEFAULTS,
  };
}

const IMAGE_DEFAULTS = {
  flipX: false,
  flipY: false,
  cornerRadius: 0,
  mask: "rect" as const,
  adjustments: NEUTRAL_ADJUSTMENTS,
  filter: null,
  borderColor: "#ffffff",
  borderWidth: 0,
};

export function createVideo(asset: AssetRef, p: Placement): VideoElement {
  const { width, height } = fitWithin(asset.width, asset.height, p.maxWidth * 0.8, p.maxHeight * 0.8);
  return {
    ...base(asset.name.replace(/\.[^.]+$/, "") || "Video"),
    type: "video",
    assetId: asset.id,
    x: Math.round(p.centerX - width / 2),
    y: Math.round(p.centerY - height / 2),
    width,
    height,
    start: 0,
    trimStart: 0,
    // A new clip never makes its slide longer than a video slide may be.
    trimEnd: Math.min(asset.duration ?? 1, MAX_VIDEO_SLIDE_SECONDS),
    volume: 1,
    muted: false,
    playbackRate: 1,
    loop: false,
    posterTime: 0,
    flipX: false,
    flipY: false,
    cornerRadius: 0,
    mask: "rect",
    borderColor: "#ffffff",
    borderWidth: 0,
  };
}

/** A photo or video frame: the element types that hold media and can swap it. */
export type MediaFrame = ImageElement | VideoElement;

/**
 * What a frame keeps when its content changes: identity, place, size, stacking, grouping and the
 * look of the frame itself (mask, corners, border, flips, shadow, blend). The picture inside and
 * its crop are what change.
 */
function frameShell(el: MediaFrame) {
  return {
    id: el.id,
    name: el.name,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    rotation: el.rotation,
    opacity: el.opacity,
    visible: el.visible,
    locked: el.locked,
    blendMode: el.blendMode,
    shadow: el.shadow,
    ...(el.groupId ? { groupId: el.groupId } : {}),
    flipX: el.flipX,
    flipY: el.flipY,
    cornerRadius: el.cornerRadius,
    mask: el.mask,
    borderColor: el.borderColor,
    borderWidth: el.borderWidth,
  };
}

const assetLabel = (asset: AssetRef, fallback: string) => asset.name.replace(/\.[^.]+$/, "") || fallback;

/**
 * Put a video into an existing frame (an empty placeholder, a photo, or another video).
 * The clip starts where the frame's clip started (0 for a photo frame) and is centred in the frame.
 */
export function videoInFrame(frame: MediaFrame, asset: AssetRef): VideoElement {
  const start = frame.type === "video" ? frame.start : 0;
  const duration = asset.duration ?? 1;
  return {
    ...frameShell(frame),
    // An empty frame is named after its role ("Photo 2"); once it holds a clip, the clip's name is clearer.
    name: frame.type === "image" ? assetLabel(asset, "Video") : frame.name,
    type: "video",
    assetId: asset.id,
    start,
    trimStart: 0,
    trimEnd: Math.max(0.1, Math.min(duration, MAX_VIDEO_SLIDE_SECONDS - start)),
    volume: frame.type === "video" ? frame.volume : 1,
    muted: frame.type === "video" ? frame.muted : false,
    playbackRate: 1,
    loop: frame.type === "video" ? frame.loop : false,
    posterTime: 0,
  };
}

/**
 * Put a photo into an existing frame, or empty it with `assetId: null`. A photo frame keeps its
 * filter and color effects; a video frame becomes a photo frame with a neutral look.
 */
export function imageInFrame(frame: MediaFrame, asset: AssetRef | null): ImageElement {
  const look =
    frame.type === "image"
      ? {
          adjustments: frame.adjustments,
          filter: frame.filter,
          ...(frame.duotone ? { duotone: frame.duotone } : {}),
          ...(frame.overlay ? { overlay: frame.overlay } : {}),
        }
      : { adjustments: NEUTRAL_ADJUSTMENTS, filter: null };
  return {
    ...frameShell(frame),
    name: frame.type === "video" ? (asset ? assetLabel(asset, "Image") : "Photo") : frame.name,
    type: "image",
    assetId: asset?.id ?? null,
    ...look,
  };
}

/** Empty photo frame that the user fills later. Used by templates. */
export function createPlaceholder(box: { x: number; y: number; width: number; height: number }, name = "Photo"): ImageElement {
  return { ...base(name), type: "image", assetId: null, ...box, ...IMAGE_DEFAULTS };
}

export function createSticker(stickerId: string, name: string, aspect: number, p: Placement): StickerElement {
  const width = Math.round(Math.min(p.maxWidth, p.maxHeight) * 0.3);
  const height = Math.round(width / aspect);
  return {
    ...base(name),
    type: "sticker",
    stickerId,
    color: "#111111",
    x: Math.round(p.centerX - width / 2),
    y: Math.round(p.centerY - height / 2),
    width,
    height,
  };
}

const OVERLAY_DEFAULTS: Record<OverlayKind, { name: string; color: string; opacity: number; blendMode: BlendMode }> = {
  grain: { name: "Film grain", color: "#808080", opacity: 0.5, blendMode: "overlay" },
  "light-leak": { name: "Light leak", color: "#ff8a3d", opacity: 0.8, blendMode: "screen" },
  vignette: { name: "Vignette", color: "#000000", opacity: 0.6, blendMode: "normal" },
};

/** Texture layer covering one whole slide. */
export function createOverlay(overlay: OverlayKind, p: Placement): OverlayElement {
  const d = OVERLAY_DEFAULTS[overlay];
  return {
    ...base(d.name),
    type: "overlay",
    overlay,
    color: d.color,
    opacity: d.opacity,
    blendMode: d.blendMode,
    // Full-slide textures would swallow every tap, so they start locked (select them in Layers).
    locked: true,
    x: Math.round(p.centerX - p.maxWidth / 2),
    y: Math.round(p.centerY - p.maxHeight / 2),
    width: p.maxWidth,
    height: p.maxHeight,
  };
}
