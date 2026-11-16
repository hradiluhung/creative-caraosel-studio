/**
 * Versioned document model. Pure data, no UI or rendering imports.
 * Everything the editor, the renderer, persistence and export need is described here.
 */
import { z } from "zod";

export const SCHEMA_VERSION = 2;

const finite = z.number().refine(Number.isFinite, "must be finite");
const hexColor = z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "expected #RRGGBB or #RRGGBBAA");

const gradientStops = z
  .array(z.object({ offset: z.number().min(0).max(1), color: hexColor }))
  .min(2)
  .max(6);

export const backgroundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("solid"), color: hexColor }),
  z.object({ type: z.literal("transparent") }),
  /** angle in degrees, CSS convention: 0 points up, 90 points right. */
  z.object({ type: z.literal("linear"), angle: finite, stops: gradientStops }),
  z.object({ type: z.literal("radial"), stops: gradientStops }),
]);

export const shadowSchema = z.object({
  color: hexColor,
  opacity: z.number().min(0).max(1),
  blur: z.number().min(0),
  offsetX: finite,
  offsetY: finite,
});

export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "soft-light",
  "hard-light",
  "color-dodge",
  "color-burn",
  "difference",
] as const;
export const blendModeSchema = z.enum(BLEND_MODES);

const baseElement = {
  id: z.string().min(1),
  name: z.string(),
  /** Top-left corner of the unrotated box, in surface pixels. */
  x: finite,
  y: finite,
  width: finite.refine((n) => n > 0, "must be > 0"),
  height: finite.refine((n) => n > 0, "must be > 0"),
  /** Degrees, clockwise, around the box center. */
  rotation: finite,
  opacity: z.number().min(0).max(1),
  visible: z.boolean(),
  locked: z.boolean(),
  blendMode: blendModeSchema,
  shadow: shadowSchema.nullable(),
};

const amount = z.number().min(-100).max(100);
const strength = z.number().min(0).max(100);

/** Non-destructive image adjustments. Every value is 0 when neutral. */
export const adjustmentsSchema = z.object({
  brightness: amount,
  exposure: amount,
  contrast: amount,
  saturation: amount,
  temperature: amount,
  tint: amount,
  highlights: amount,
  shadows: amount,
  fade: strength,
  grayscale: strength,
  sharpness: strength,
  blur: strength,
  vignette: strength,
  grain: strength,
});

export const IMAGE_MASKS = ["rect", "ellipse", "arch", "triangle", "hexagon", "star", "heart"] as const;
export const imageMaskSchema = z.enum(IMAGE_MASKS);

export const imageElementSchema = z.object({
  ...baseElement,
  type: z.literal("image"),
  /** null marks an empty photo placeholder (templates), filled by the user later. */
  assetId: z.string().min(1).nullable(),
  flipX: z.boolean(),
  flipY: z.boolean(),
  cornerRadius: z.number().min(0),
  mask: imageMaskSchema,
  adjustments: adjustmentsSchema,
  /** Name of the filter preset the adjustments came from, for display only. */
  filter: z.string().nullable(),
  borderColor: hexColor,
  borderWidth: z.number().min(0),
});

export const textAlignSchema = z.enum(["left", "center", "right"]);

export const textElementSchema = z.object({
  ...baseElement,
  type: z.literal("text"),
  text: z.string(),
  fontFamily: z.string().min(1),
  fontSize: z.number().positive(),
  fontWeight: z.number().int().min(100).max(900),
  italic: z.boolean(),
  fill: hexColor,
  align: textAlignSchema,
  lineHeight: z.number().positive(),
  letterSpacing: finite,
  transform: z.enum(["none", "uppercase", "lowercase", "capitalize"]),
  strokeColor: hexColor,
  strokeWidth: z.number().min(0),
  /** Filled box behind the text. */
  background: z.object({ color: hexColor, padding: z.number().min(0), radius: z.number().min(0) }).nullable(),
});

export const shapeKindSchema = z.enum(["rect", "ellipse", "triangle", "polygon", "star", "line", "arrow"]);

export const shapeElementSchema = z.object({
  ...baseElement,
  type: z.literal("shape"),
  shape: shapeKindSchema,
  fill: hexColor,
  stroke: hexColor,
  strokeWidth: z.number().min(0),
  cornerRadius: z.number().min(0),
  /** Polygon side count or star point count. */
  sides: z.number().int().min(3).max(24),
});

export const stickerElementSchema = z.object({
  ...baseElement,
  type: z.literal("sticker"),
  /** Key into the built-in sticker registry (src/render/stickers.ts). */
  stickerId: z.string().min(1),
  color: hexColor,
});

export const OVERLAY_KINDS = ["grain", "light-leak", "vignette"] as const;
export const overlayElementSchema = z.object({
  ...baseElement,
  type: z.literal("overlay"),
  overlay: z.enum(OVERLAY_KINDS),
  color: hexColor,
});

export const elementSchema = z.discriminatedUnion("type", [
  imageElementSchema,
  textElementSchema,
  shapeElementSchema,
  stickerElementSchema,
  overlayElementSchema,
]);

/**
 * Layer order is the array order: index 0 is the bottom layer.
 * There is deliberately no separate zIndex field, so preview and export cannot disagree.
 */
const elementList = z.array(elementSchema).superRefine((els, ctx) => {
  const seen = new Set<string>();
  for (const el of els) {
    if (seen.has(el.id)) ctx.addIssue({ code: "custom", message: `duplicate element id ${el.id}` });
    seen.add(el.id);
  }
});

export const slideSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  background: backgroundSchema,
  elements: elementList,
});

export const assetRefSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  mime: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  size: z.number().nonnegative(),
});

export const projectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  /**
   * independent: every slide owns its background and elements (slide-local coordinates).
   * seamless: one panorama of width * slides.length owns them (panorama coordinates).
   */
  mode: z.enum(["independent", "seamless"]),
  /** Size of ONE slide in pixels. */
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(8192),
  slides: z.array(slideSchema).min(1).max(20),
  panorama: z.object({ background: backgroundSchema, elements: elementList }),
  /** Assets referenced by this project. Binary data lives in the asset store, never here. */
  assets: z.array(assetRefSchema),
  /** Brand kit whose colors, fonts and logos are offered in the editor. */
  brandKitId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Background = z.infer<typeof backgroundSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type TextElement = z.infer<typeof textElementSchema>;
export type ShapeElement = z.infer<typeof shapeElementSchema>;
export type StickerElement = z.infer<typeof stickerElementSchema>;
export type OverlayElement = z.infer<typeof overlayElementSchema>;
export type OverlayKind = OverlayElement["overlay"];
export type Adjustments = z.infer<typeof adjustmentsSchema>;
export type ImageMask = z.infer<typeof imageMaskSchema>;
export type Shadow = z.infer<typeof shadowSchema>;
export type BlendMode = z.infer<typeof blendModeSchema>;
export type ShapeKind = z.infer<typeof shapeKindSchema>;
export type DesignElement = z.infer<typeof elementSchema>;
export type Slide = z.infer<typeof slideSchema>;
export type AssetRef = z.infer<typeof assetRefSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectMode = Project["mode"];

export const MAX_SLIDES = 20;

export const NEUTRAL_ADJUSTMENTS: Adjustments = {
  brightness: 0,
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  fade: 0,
  grayscale: 0,
  sharpness: 0,
  blur: 0,
  vignette: 0,
  grain: 0,
};

export function isNeutral(a: Adjustments): boolean {
  return (Object.keys(NEUTRAL_ADJUSTMENTS) as Array<keyof Adjustments>).every((k) => a[k] === 0);
}
