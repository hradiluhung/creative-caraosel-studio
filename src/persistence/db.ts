/**
 * Local persistence on IndexedDB.
 *  - projectMeta: small records for the dashboard list (with a cover thumbnail)
 *  - projectDocs: the full validated document, one record per project
 *  - assets:      original binary files, shared between projects by id
 * Documents never embed binary data; they reference assets by id.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { parseProject } from "@/document/migrations";
import { cloneProject, usedAssetIds } from "@/document/operations";
import type { AssetRef, Project, ProjectMode } from "@/document/schema";

export interface ProjectMeta {
  id: string;
  name: string;
  mode: ProjectMode;
  width: number;
  height: number;
  slideCount: number;
  createdAt: string;
  updatedAt: string;
  thumbnail: Blob | null;
}

export interface StoredAsset extends AssetRef {
  blob: Blob;
  /** Video assets only: a small still frame for instant previews (never referenced by documents). */
  poster?: Blob;
  /** Heavy videos only: a small copy the editor plays instead of the original (see proxy.ts). */
  proxy?: Blob;
  /** Audio assets only: waveform bars, 0..1 (decoration for the timeline). */
  peaks?: number[];
  createdAt: string;
}

export interface StoredFont {
  id: string;
  /** Stable CSS family name used in documents. */
  family: string;
  /** Display name, renameable. */
  label: string;
  weight: number;
  italic: boolean;
  fileName: string;
  format: string;
  size: number;
  blob: Blob;
  createdAt: string;
}

export interface StoredTemplate {
  id: string;
  name: string;
  category: string;
  /** A complete project document: templates are editable objects, never flattened images. */
  doc: unknown;
  thumbnail: Blob | null;
  createdAt: string;
}

export interface BrandKit {
  id: string;
  name: string;
  colors: string[];
  headingFont: string;
  bodyFont: string;
  logos: AssetRef[];
  updatedAt: string;
}

interface Schema extends DBSchema {
  projectMeta: { key: string; value: ProjectMeta; indexes: { updatedAt: string } };
  projectDocs: { key: string; value: unknown };
  assets: { key: string; value: StoredAsset };
  fonts: { key: string; value: StoredFont };
  templates: { key: string; value: StoredTemplate };
  brandKits: { key: string; value: BrandKit };
}

const DB_NAME = "creative-carousel-studio";
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          const meta = database.createObjectStore("projectMeta", { keyPath: "id" });
          meta.createIndex("updatedAt", "updatedAt");
          database.createObjectStore("projectDocs");
          database.createObjectStore("assets", { keyPath: "id" });
        }
        if (oldVersion < 2) {
          database.createObjectStore("fonts", { keyPath: "id" });
          database.createObjectStore("templates", { keyPath: "id" });
          database.createObjectStore("brandKits", { keyPath: "id" });
        }
      },
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

/** Test hook: forget the cached connection. */
export async function closeDb() {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

function metaOf(project: Project, thumbnail: Blob | null): ProjectMeta {
  return {
    id: project.id,
    name: project.name,
    mode: project.mode,
    width: project.width,
    height: project.height,
    slideCount: project.slides.length,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    thumbnail,
  };
}

/** Most recently modified first. */
export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await (await db()).getAllFromIndex("projectMeta", "updatedAt");
  return all.reverse();
}

/**
 * Save document and list entry in one transaction.
 * Pass thumbnail undefined to keep the existing cover.
 */
export async function saveProject(project: Project, thumbnail?: Blob | null): Promise<void> {
  const tx = (await db()).transaction(["projectMeta", "projectDocs"], "readwrite");
  const metaStore = tx.objectStore("projectMeta");
  const existing = await metaStore.get(project.id);
  const cover = thumbnail === undefined ? (existing?.thumbnail ?? null) : thumbnail;
  await Promise.all([metaStore.put(metaOf(project, cover)), tx.objectStore("projectDocs").put(project, project.id), tx.done]);
}

/** Loads, migrates and validates. Throws DocumentError when the stored data is unusable. */
export async function loadProject(id: string): Promise<Project | null> {
  const raw = await (await db()).get("projectDocs", id);
  return raw === undefined ? null : parseProject(raw);
}

export async function renameStoredProject(id: string, name: string): Promise<void> {
  const project = await loadProject(id);
  const trimmed = name.trim();
  if (!project || !trimmed) return;
  await saveProject({ ...project, name: trimmed, updatedAt: new Date().toISOString() });
}

export async function duplicateStoredProject(id: string): Promise<Project | null> {
  const project = await loadProject(id);
  if (!project) return null;
  const copy = cloneProject(project, `${project.name} copy`);
  const meta = await (await db()).get("projectMeta", id);
  await saveProject(copy, meta?.thumbnail ?? null);
  return copy;
}

/** Deletes the project and every asset no other project still references. */
export async function deleteProject(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(["projectMeta", "projectDocs", "assets", "templates", "brandKits"], "readwrite");
  const docs = tx.objectStore("projectDocs");
  const target = (await docs.get(id)) as Project | undefined;
  await docs.delete(id);
  await tx.objectStore("projectMeta").delete(id);
  if (target?.assets?.length) {
    const stillUsed = await assetsInUse(
      (await docs.getAll()) as Project[],
      await tx.objectStore("templates").getAll(),
      await tx.objectStore("brandKits").getAll(),
    );
    for (const a of target.assets) if (!stillUsed.has(a.id)) await tx.objectStore("assets").delete(a.id);
  }
  await tx.done;
}

/** Asset ids referenced by any project, saved template or brand kit. */
async function assetsInUse(projects: Project[], templates: StoredTemplate[], kits: BrandKit[]) {
  const used = new Set<string>();
  for (const p of projects) for (const a of p.assets ?? []) used.add(a.id);
  for (const t of templates) for (const a of (t.doc as Project | undefined)?.assets ?? []) used.add(a.id);
  for (const k of kits) for (const a of k.logos ?? []) used.add(a.id);
  return used;
}

// --- Custom fonts ---------------------------------------------------------

export async function listStoredFonts(): Promise<StoredFont[]> {
  return (await db()).getAll("fonts");
}
export async function putStoredFont(font: StoredFont): Promise<void> {
  await (await db()).put("fonts", font);
}
export async function deleteStoredFont(id: string): Promise<void> {
  await (await db()).delete("fonts", id);
}

// --- User templates -------------------------------------------------------

export async function listStoredTemplates(): Promise<StoredTemplate[]> {
  const all = await (await db()).getAll("templates");
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function putStoredTemplate(template: StoredTemplate): Promise<void> {
  await (await db()).put("templates", template);
}
export async function deleteStoredTemplate(id: string): Promise<void> {
  await (await db()).delete("templates", id);
}

// --- Brand kits -----------------------------------------------------------

export async function listBrandKits(): Promise<BrandKit[]> {
  const all = await (await db()).getAll("brandKits");
  return all.sort((a, b) => a.name.localeCompare(b.name));
}
export async function getBrandKit(id: string): Promise<BrandKit | undefined> {
  return (await db()).get("brandKits", id);
}
export async function putBrandKit(kit: BrandKit): Promise<void> {
  await (await db()).put("brandKits", kit);
}
export async function deleteBrandKit(id: string): Promise<void> {
  await (await db()).delete("brandKits", id);
}

export async function putAsset(asset: StoredAsset): Promise<void> {
  await (await db()).put("assets", asset);
}

export async function getAssetBlob(id: string): Promise<Blob | undefined> {
  return (await (await db()).get("assets", id))?.blob;
}

export async function getAssetPoster(id: string): Promise<Blob | undefined> {
  return (await (await db()).get("assets", id))?.poster;
}

export async function getAssetProxy(id: string): Promise<Blob | undefined> {
  return (await (await db()).get("assets", id))?.proxy;
}

/** Attach a preview proxy to a stored video. Does nothing when the asset was deleted in the meantime. */
export async function putAssetProxy(id: string, proxy: Blob): Promise<void> {
  const tx = (await db()).transaction("assets", "readwrite");
  const stored = await tx.store.get(id);
  if (stored) await tx.store.put({ ...stored, proxy });
  await tx.done;
}

export async function getAssetPeaks(id: string): Promise<number[] | undefined> {
  return (await (await db()).get("assets", id))?.peaks;
}

/** Asset refs of a project that have no element using them (candidates for cleanup UI). */
export function unusedAssets(project: Project): AssetRef[] {
  const used = usedAssetIds(project);
  return project.assets.filter((a) => !used.has(a.id));
}

/** Ask the browser not to evict our storage under pressure. Best effort. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* not supported */
  }
  return false;
}
