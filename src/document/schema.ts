/**
 * Versioned document model. Pure data, no UI or rendering imports.
 * Everything the editor, the renderer, persistence and export need is described here.
 */
import { z } from "zod";

export const SCHEMA_VERSION = 7;

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
  /** Elements with the same id form a group (see groups.ts). Absent: not grouped. */
  groupId: z.string().min(1).max(64).optional(),
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

export const MAX_CROP_ZOOM = 5;
/**
 * How a photo sits inside its frame. Absent means: centred, filling the frame, not turned.
 * x and y pan across whatever the frame hides (-1 = one end, 0 = centre, 1 = the other end).
 */
export const imageCropSchema = z.object({
  x: z.number().min(-1).max(1),
  y: z.number().min(-1).max(1),
  zoom: z.number().min(1).max(MAX_CROP_ZOOM),
  /** Quarter turns clockwise of the photo inside the frame. */
  turns: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});
/** Two-colour look: dark tones take `shadow`, bright tones `highlight`. */
export const duotoneSchema = z.object({ shadow: hexColor, highlight: hexColor, amount: strength });
/** A flat colour laid over the photo. */
export const colorOverlaySchema = z.object({ color: hexColor, opacity: strength });

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
  crop: imageCropSchema.optional(),
  duotone: duotoneSchema.optional(),
  overlay: colorOverlaySchema.optional(),
});

/** Upper bound for a manually set slide duration and for a clip's start time. */
export const MAX_SLIDE_SECONDS = 600;
export const PLAYBACK_RATE_MIN = 0.25;
export const PLAYBACK_RATE_MAX = 4;

/**
 * A video clip in a frame. It shares the frame styling of images (mask, corner radius, flips,
 * border); all times are seconds inside the source file.
 */
export const videoElementSchema = z
  .object({
    ...baseElement,
    type: z.literal("video"),
    assetId: z.string().min(1),
    /** Slide time (seconds) at which the clip begins. The clip is only on screen while it plays. */
    start: z.number().min(0).max(MAX_SLIDE_SECONDS),
    /** First and last moment of the source that are played. trimEnd is always after trimStart. */
    trimStart: z.number().min(0),
    trimEnd: z.number().positive(),
    volume: z.number().min(0).max(1),
    muted: z.boolean(),
    playbackRate: z.number().min(PLAYBACK_RATE_MIN).max(PLAYBACK_RATE_MAX),
    /** Repeat the trimmed range while the slide is longer than the clip. */
    loop: z.boolean(),
    /** Source time of the frame shown in thumbnails and image exports. */
    posterTime: z.number().min(0),
    flipX: z.boolean(),
    flipY: z.boolean(),
    cornerRadius: z.number().min(0),
    mask: imageMaskSchema,
    borderColor: hexColor,
    borderWidth: z.number().min(0),
  })
  .refine((el) => el.trimEnd > el.trimStart, { message: "trimEnd must be after trimStart", path: ["trimEnd"] });

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
  videoElementSchema,
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

/** Longest fade the editor offers, in seconds. */
export const MAX_FADE_SECONDS = 10;

/**
 * Background music of a slide. It plays next to the sound of the slide's video clips, from
 * `start` on the slide, and only exists on slides that contain video (a slide without video
 * is a still image and has no duration).
 */
export const audioTrackSchema = z
  .object({
    assetId: z.string().min(1),
    /** Slide time (seconds) at which the music begins. */
    start: z.number().min(0).max(MAX_SLIDE_SECONDS),
    /** Part of the audio file that is played, in seconds inside the file. */
    trimStart: z.number().min(0),
    trimEnd: z.number().positive(),
    volume: z.number().min(0).max(1),
    fadeIn: z.number().min(0).max(MAX_FADE_SECONDS),
    fadeOut: z.number().min(0).max(MAX_FADE_SECONDS),
    /** Repeat the trimmed part until the slide ends. */
    loop: z.boolean(),
  })
  .refine((t) => t.trimEnd > t.trimStart, { message: "trimEnd must be after trimStart", path: ["trimEnd"] });

export const slideSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  background: backgroundSchema,
  elements: elementList,
  /** Seconds. Unset means "as long as the longest video clip on the slide". */
  duration: z.number().positive().max(MAX_SLIDE_SECONDS).optional(),
  audio: audioTrackSchema.optional(),
});

export const assetRefSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  mime: z.string(),
  /** Pixels. 0 for audio assets, which have no picture. */
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  size: z.number().nonnegative(),
  /** Seconds, only present on video and audio assets. */
  duration: z.number().positive().optional(),
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
export type VideoElement = z.infer<typeof videoElementSchema>;
export type OverlayKind = OverlayElement["overlay"];
export type Adjustments = z.infer<typeof adjustmentsSchema>;
export type ImageMask = z.infer<typeof imageMaskSchema>;
export type Shadow = z.infer<typeof shadowSchema>;
export type BlendMode = z.infer<typeof blendModeSchema>;
export type ShapeKind = z.infer<typeof shapeKindSchema>;
export type DesignElement = z.infer<typeof elementSchema>;
export type Slide = z.infer<typeof slideSchema>;
export type AudioTrack = z.infer<typeof audioTrackSchema>;
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

export type ImageCrop = z.infer<typeof imageCropSchema>;
export type Duotone = z.infer<typeof duotoneSchema>;
export type ColorOverlay = z.infer<typeof colorOverlaySchema>;
export const NEUTRAL_CROP: ImageCrop = { x: 0, y: 0, zoom: 1, turns: 0 };
/** Everything that changes a photo's pixels after cropping. */
export interface ImageLook {
  adjustments: Adjustments;
  duotone?: Duotone;
  overlay?: ColorOverlay;
}
export function isNeutralLook(look: ImageLook): boolean {
  return isNeutral(look.adjustments) && !(look.duotone && look.duotone.amount > 0) && !(look.overlay && look.overlay.opacity > 0);
}

export function isNeutral(a: Adjustments): boolean {
  return (Object.keys(NEUTRAL_ADJUSTMENTS) as Array<keyof Adjustments>).every((k) => a[k] === 0);
}

export function isAudioAsset(asset: Pick<AssetRef, "mime">): boolean {
  return asset.mime.startsWith("audio/");
}

export function isVideoAsset(asset: Pick<AssetRef, "mime">): boolean {
  return asset.mime.startsWith("video/");
}
