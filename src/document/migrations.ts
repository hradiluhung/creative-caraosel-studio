/**
 * Loading pipeline for stored documents: migrate step by step to the current
 * schema version, then validate. Add a new entry to MIGRATIONS whenever
 * SCHEMA_VERSION is bumped; never edit an old one.
 */
import { projectSchema, SCHEMA_VERSION, type Project } from "./schema";

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
