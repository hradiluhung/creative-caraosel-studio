/**
 * Versioned document model. Pure data, no UI or rendering imports.
 * Everything the editor, the renderer, persistence and export need is described here.
 */
import { z } from "zod";

export const SCHEMA_VERSION = 1;

const finite = z.number().refine(Number.isFinite, "must be finite");
const hexColor = z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "expected #RRGGBB or #RRGGBBAA");

export const backgroundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("solid"), color: hexColor }),
  z.object({ type: z.literal("transparent") }),
]);

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
};

export const imageElementSchema = z.object({
  ...baseElement,
  type: z.literal("image"),
  assetId: z.string().min(1),
  flipX: z.boolean(),
  flipY: z.boolean(),
  cornerRadius: z.number().min(0),
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

export const elementSchema = z.discriminatedUnion("type", [
  imageElementSchema,
  textElementSchema,
  shapeElementSchema,
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
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Background = z.infer<typeof backgroundSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type TextElement = z.infer<typeof textElementSchema>;
export type ShapeElement = z.infer<typeof shapeElementSchema>;
export type ShapeKind = z.infer<typeof shapeKindSchema>;
export type DesignElement = z.infer<typeof elementSchema>;
export type Slide = z.infer<typeof slideSchema>;
export type AssetRef = z.infer<typeof assetRefSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectMode = Project["mode"];

export const MAX_SLIDES = 20;
