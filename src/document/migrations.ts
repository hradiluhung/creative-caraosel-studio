/**
 * Loading pipeline for stored documents: migrate step by step to the current
 * schema version, then validate. Add a new entry to MIGRATIONS whenever
 * SCHEMA_VERSION is bumped; never edit an old one.
 */
import { NEUTRAL_ADJUSTMENTS, projectSchema, SCHEMA_VERSION, type Project } from "./schema";

type RawDoc = Record<string, unknown>;
type Migration = (doc: RawDoc) => RawDoc;

/** Key N upgrades a document from version N to N + 1. */
const MIGRATIONS: Record<number, Migration> = {
  // Version 0 was the pre-release shape: no mode, no panorama, no asset list.
  0: (doc) => ({
    ...doc,
    mode: doc.mode ?? "independent",
    panorama: doc.panorama ?? { background: { type: "solid", color: "#ffffff" }, elements: [] },
    assets: doc.assets ?? [],
    schemaVersion: 1,
  }),
  // Version 2 (Phase 2): gradients, blend modes, shadows, text effects, image adjustments and
  // masks, photo placeholders, stickers, overlays, brand kits. Old elements get neutral defaults.
  1: (doc) => {
    const upgrade = (el: RawDoc): RawDoc => {
      const base = { blendMode: "normal", shadow: null, ...el };
      if (el.type === "image") {
        return {
          mask: "rect",
          adjustments: { ...NEUTRAL_ADJUSTMENTS },
          filter: null,
          borderColor: "#ffffff",
          borderWidth: 0,
          ...base,
        };
      }
      if (el.type === "text") {
        return { transform: "none", strokeColor: "#000000", strokeWidth: 0, background: null, ...base };
      }
      return base;
    };
    const container = <T extends RawDoc>(c: T): T => ({ ...c, elements: ((c.elements as RawDoc[]) ?? []).map(upgrade) });
    return {
      ...doc,
      slides: ((doc.slides as RawDoc[]) ?? []).map(container),
      panorama: container((doc.panorama as RawDoc) ?? { background: { type: "solid", color: "#ffffff" }, elements: [] }),
      brandKitId: doc.brandKitId ?? null,
      schemaVersion: 2,
    };
  },
  // Version 3 (Phase 3): video elements, optional Slide.duration and AssetRef.duration.
  // Everything new is either a new element type or optional, so old documents only change version.
  2: (doc) => ({ ...doc, schemaVersion: 3 }),
  // Version 4 (Phase 3, timeline): every video clip gets a start time on its slide.
  3: (doc) => {
    const isRecord = (v: unknown): v is RawDoc => typeof v === "object" && v !== null;
    const withStart = (el: unknown) => (isRecord(el) && el.type === "video" && el.start === undefined ? { ...el, start: 0 } : el);
    const container = (c: unknown) => (isRecord(c) && Array.isArray(c.elements) ? { ...c, elements: c.elements.map(withStart) } : c);
    return {
      ...doc,
      slides: Array.isArray(doc.slides) ? doc.slides.map(container) : doc.slides,
      panorama: container(doc.panorama),
      schemaVersion: 4,
    };
  },
  // Version 5 (Phase 3, audio): optional Slide.audio (background music) and audio assets.
  4: (doc) => ({ ...doc, schemaVersion: 5 }),
  // Version 6 (Phase 4, image tools): optional crop, duotone and overlay on image elements.
  5: (doc) => ({ ...doc, schemaVersion: 6 }),
};

export class DocumentError extends Error {
  constructor(message: string, readonly issues: string[] = []) {
    super(message);
    this.name = "DocumentError";
  }
}

export function migrateProject(raw: unknown): RawDoc {
  if (typeof raw !== "object" || raw === null) throw new DocumentError("Project data is not an object");
  let doc = raw as RawDoc;
  let version = typeof doc.schemaVersion === "number" ? doc.schemaVersion : 0;
  if (version > SCHEMA_VERSION) {
    throw new DocumentError(`Project was saved by a newer version of the app (schema ${version})`);
  }
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new DocumentError(`No migration from schema version ${version}`);
    doc = step(doc);
    version += 1;
  }
  return doc;
}

export function parseProject(raw: unknown): Project {
  const result = projectSchema.safeParse(migrateProject(raw));
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new DocumentError("Project data failed validation", issues);
  }
  return result.data;
}
