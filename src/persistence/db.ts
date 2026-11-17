/**
 * Local persistence on IndexedDB.
 *  - projectMeta: small records for the dashboard list (with a cover thumbnail)
 *  - projectDocs: the full validated document, one record per project
 *  - assets:      original binary files, shared between projects by id
 *  - projectVersions: saved earlier states of a project (version history)
 * Documents never embed binary data; they reference assets by id.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { versionsToPrune, type VersionInfo, type VersionKind } from '@/document/history'
import { createId } from '@/document/ids'
import { parseProject } from '@/document/migrations'
import { cloneProject, usedAssetIds } from '@/document/operations'
import type { AssetRef, Project, ProjectMode } from '@/document/schema'
import { assetKind, normalizeCollections, type AssetUsage, type LibraryItem } from './libraryModel'

export interface ProjectMeta {
  id: string
  name: string
  mode: ProjectMode
  width: number
  height: number
  slideCount: number
  createdAt: string
  updatedAt: string
  thumbnail: Blob | null
}

export interface StoredAsset extends AssetRef {
  blob: Blob
  /** Video assets only: a small still frame for instant previews (never referenced by documents). */
  poster?: Blob
  /** Heavy videos only: a small copy the editor plays instead of the original (see proxy.ts). */
  proxy?: Blob
  /** Audio assets only: waveform bars, 0..1 (decoration for the timeline). */
  peaks?: number[]
  /** Library organisation (see libraryModel.ts). Never part of a document. */
  favorite?: boolean
  collections?: string[]
  createdAt: string
  duration?: number
}

export interface StoredFont {
  id: string
  /** Stable CSS family name used in documents. */
  family: string
  /** Display name, renameable. */
  label: string
  weight: number
  italic: boolean
  fileName: string
  format: string
  size: number
  blob: Blob
  createdAt: string
}

export interface StoredTemplate {
  id: string
  name: string
  category: string
  description?: string
  /** A complete project document: templates are editable objects, never flattened images. */
  doc: unknown
  thumbnail: Blob | null
  createdAt: string
}

export interface BrandKit {
  id: string
  name: string
  colors: string[]
  headingFont: string
  bodyFont: string
  logos: AssetRef[]
  updatedAt: string
}

/** One saved state of a project (see src/document/history.ts for the rules). */
export interface StoredVersion extends VersionInfo {
  projectId: string
  slideCount: number
  /** The whole document as it was, in the schema version of that moment (migrated when opened). */
  doc: unknown
  thumbnail: Blob | null
}
/** A version as the history list shows it: everything but the document itself. */
export type VersionSummary = Omit<StoredVersion, 'doc'>

interface Schema extends DBSchema {
  projectVersions: { key: string; value: StoredVersion; indexes: { projectId: string } }
  projectMeta: { key: string; value: ProjectMeta; indexes: { updatedAt: string } }
  projectDocs: { key: string; value: unknown }
  assets: { key: string; value: StoredAsset }
  fonts: { key: string; value: StoredFont }
  templates: { key: string; value: StoredTemplate }
  brandKits: { key: string; value: BrandKit }
}

const DB_NAME = 'creative-carousel-studio'
const DB_VERSION = 3

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null

/** The open connection, once there is one: needed for writes that cannot wait (see saveProjectNow). */
let openDatabase: IDBPDatabase<Schema> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          const meta = database.createObjectStore('projectMeta', { keyPath: 'id' })
          meta.createIndex('updatedAt', 'updatedAt')
          database.createObjectStore('projectDocs')
          database.createObjectStore('assets', { keyPath: 'id' })
        }
        if (oldVersion < 2) {
          database.createObjectStore('fonts', { keyPath: 'id' })
          database.createObjectStore('templates', { keyPath: 'id' })
          database.createObjectStore('brandKits', { keyPath: 'id' })
        }
        if (oldVersion < 3) {
          database
            .createObjectStore('projectVersions', { keyPath: 'id' })
            .createIndex('projectId', 'projectId')
        }
      },
      // Another tab wants to upgrade the database: let it, instead of blocking it forever.
      // The next call here reopens the database at the new version.
      blocking(_current, _blocked, event) {
        ;(event.target as IDBDatabase).close()
        dbPromise = null
        openDatabase = null
      },
      // The browser closed the connection (storage pressure, site data cleared): reconnect on next use.
      terminated() {
        dbPromise = null
        openDatabase = null
      },
    })
    dbPromise.then(
      (database) => {
        openDatabase = database
      },
      () => {
        dbPromise = null
      },
    )
  }
  return dbPromise
}

/** Test hook: forget the cached connection. */
export async function closeDb() {
  if (dbPromise) (await dbPromise).close()
  dbPromise = null
  openDatabase = null
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
  }
}

/** Most recently modified first. */
export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await (await db()).getAllFromIndex('projectMeta', 'updatedAt')
  return all.reverse()
}

/**
 * Save document and list entry in one transaction.
 * Pass thumbnail undefined to keep the existing cover.
 */
export async function saveProject(project: Project, thumbnail?: Blob | null): Promise<void> {
  const tx = (await db()).transaction(['projectMeta', 'projectDocs'], 'readwrite')
  const metaStore = tx.objectStore('projectMeta')
  const existing = await metaStore.get(project.id)
  const cover = thumbnail === undefined ? (existing?.thumbnail ?? null) : thumbnail
  await Promise.all([
    metaStore.put(metaOf(project, cover)),
    tx.objectStore('projectDocs').put(project, project.id),
    tx.done,
  ])
}

/**
 * Last-moment save for when the page is closing. Everything is queued in this very call, with no
 * await before the write: a page that is being closed does not get another turn to continue an
 * async function, but the browser still finishes database work that was already queued.
 * The document is written first and alone, so it survives even if the list entry does not.
 * Returns false when no connection is open yet (then nothing could have been edited either).
 */
export function saveProjectNow(project: Project): boolean {
  const database = openDatabase
  if (!database) return false
  try {
    // commit() asks the browser to finish the transaction without waiting for this page to
    // receive the result, which a closing page never does.
    const docs = database.transaction('projectDocs', 'readwrite')
    void docs.store.put(project, project.id).catch(() => undefined)
    void docs.done.catch(() => undefined)
    docs.commit?.()
    // Best effort: the list entry needs a read first, so it may not finish. The next normal save
    // brings it up to date; the document above is what must not be lost.
    const meta = database.transaction('projectMeta', 'readwrite')
    void meta.store
      .get(project.id)
      .then((existing) => meta.store.put(metaOf(project, existing?.thumbnail ?? null)))
      .catch(() => undefined)
    void meta.done.catch(() => undefined)
    return true
  } catch {
    return false
  }
}

/** Loads, migrates and validates. Throws DocumentError when the stored data is unusable. */
export async function loadProject(id: string): Promise<Project | null> {
  const raw = await (await db()).get('projectDocs', id)
  return raw === undefined ? null : parseProject(raw)
}

export async function renameStoredProject(id: string, name: string): Promise<void> {
  const project = await loadProject(id)
  const trimmed = name.trim()
  if (!project || !trimmed) return
  await saveProject({ ...project, name: trimmed, updatedAt: new Date().toISOString() })
}

export async function duplicateStoredProject(id: string): Promise<Project | null> {
  const project = await loadProject(id)
  if (!project) return null
  const copy = cloneProject(project, `${project.name} copy`)
  const meta = await (await db()).get('projectMeta', id)
  await saveProject(copy, meta?.thumbnail ?? null)
  return copy
}

/** Deletes the project, its version history, and every asset nothing else still references. */
export async function deleteProject(id: string): Promise<void> {
  const database = await db()
  const tx = database.transaction(
    ['projectMeta', 'projectDocs', 'projectVersions', 'assets', 'templates', 'brandKits'],
    'readwrite',
  )
  const docs = tx.objectStore('projectDocs')
  const versions = tx.objectStore('projectVersions')
  const target = (await docs.get(id)) as Project | undefined
  const history = await versions.index('projectId').getAll(id)
  await docs.delete(id)
  await tx.objectStore('projectMeta').delete(id)
  for (const v of history) await versions.delete(v.id)
  // A version can reference an asset the current document no longer uses.
  const candidates = new Map<string, true>()
  for (const a of target?.assets ?? []) candidates.set(a.id, true)
  for (const v of history)
    for (const a of (v.doc as Project | undefined)?.assets ?? []) candidates.set(a.id, true)
  if (candidates.size > 0) {
    const stillUsed = await assetsInUse(
      (await docs.getAll()) as Project[],
      await tx.objectStore('templates').getAll(),
      await tx.objectStore('brandKits').getAll(),
      await versions.getAll(),
    )
    for (const assetId of candidates.keys())
      if (!stillUsed.has(assetId)) await tx.objectStore('assets').delete(assetId)
  }
  await tx.done
}

/** Asset ids referenced by any project, saved template, brand kit or saved version. */
async function assetsInUse(
  projects: Project[],
  templates: StoredTemplate[],
  kits: BrandKit[],
  versions: StoredVersion[] = [],
) {
  const used = new Set<string>()
  for (const p of projects) for (const a of p.assets ?? []) used.add(a.id)
  for (const t of templates)
    for (const a of (t.doc as Project | undefined)?.assets ?? []) used.add(a.id)
  for (const k of kits) for (const a of k.logos ?? []) used.add(a.id)
  for (const v of versions)
    for (const a of (v.doc as Project | undefined)?.assets ?? []) used.add(a.id)
  return used
}

// --- Version history ------------------------------------------------------

const summaryOf = ({ doc: _doc, ...summary }: StoredVersion): VersionSummary => (void _doc, summary)

/** Newest first, without the documents (those are loaded one at a time). */
export async function listVersions(projectId: string): Promise<VersionSummary[]> {
  const all = await (await db()).getAllFromIndex('projectVersions', 'projectId', projectId)
  return all.map(summaryOf).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * Save the given state as a version and prune old unnamed ones in the same transaction.
 * Assets a version references stay stored as long as the version exists.
 */
export async function saveVersion(
  project: Project,
  kind: VersionKind,
  opts: { name?: string; thumbnail?: Blob | null; now?: Date; id?: string } = {},
): Promise<VersionSummary> {
  const version: StoredVersion = {
    id: opts.id ?? createId(),
    projectId: project.id,
    createdAt: (opts.now ?? new Date()).toISOString(),
    kind,
    ...(opts.name?.trim() ? { name: opts.name.trim().slice(0, 80) } : {}),
    slideCount: project.slides.length,
    doc: project,
    thumbnail: opts.thumbnail ?? null,
  }
  const tx = (await db()).transaction('projectVersions', 'readwrite')
  await tx.store.put(version)
  const all = await tx.store.index('projectId').getAll(project.id)
  for (const id of versionsToPrune(all)) await tx.store.delete(id)
  await tx.done
  return summaryOf(version)
}

/** The document of a version, migrated to the current schema and validated. Null when it is gone. */
export async function loadVersion(id: string): Promise<Project | null> {
  const stored = await (await db()).get('projectVersions', id)
  return stored ? parseProject(stored.doc) : null
}

/**
 * Recovery: make a saved version the project again when the project itself can no longer be
 * opened. The damaged document is replaced; the project keeps its id, so its other versions stay.
 */
export async function recoverProjectFromVersion(projectId: string, versionId: string, now = new Date()): Promise<Project | null> {
  const stored = await (await db()).get('projectVersions', versionId)
  if (!stored || stored.projectId !== projectId) return null
  const project: Project = { ...parseProject(stored.doc), id: projectId, updatedAt: now.toISOString() }
  await saveProject(project, stored.thumbnail)
  return project
}

/** Give a version a name (it is then kept until deleted) or take the name away with "". */
export async function renameVersion(id: string, name: string): Promise<void> {
  const tx = (await db()).transaction('projectVersions', 'readwrite')
  const stored = await tx.store.get(id)
  if (stored) {
    const { name: _old, ...rest } = stored
    void _old
    await tx.store.put(name.trim() ? { ...rest, name: name.trim().slice(0, 80) } : rest)
  }
  await tx.done
}

export async function deleteVersion(id: string): Promise<void> {
  await (await db()).delete('projectVersions', id)
}

// --- Custom fonts ---------------------------------------------------------

export async function listStoredFonts(): Promise<StoredFont[]> {
  return (await db()).getAll('fonts')
}
export async function putStoredFont(font: StoredFont): Promise<void> {
  await (await db()).put('fonts', font)
}
export async function deleteStoredFont(id: string): Promise<void> {
  await (await db()).delete('fonts', id)
}

// --- User templates -------------------------------------------------------

export async function listStoredTemplates(): Promise<StoredTemplate[]> {
  const all = await (await db()).getAll('templates')
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
export async function putStoredTemplate(template: StoredTemplate): Promise<void> {
  await (await db()).put('templates', template)
}
export async function getStoredTemplate(id: string): Promise<StoredTemplate | undefined> {
  return (await db()).get('templates', id)
}
/** Change parts of a stored template in one transaction. Does nothing when it no longer exists. */
export async function patchStoredTemplate(
  id: string,
  patch: Partial<Omit<StoredTemplate, 'id' | 'createdAt'>>,
): Promise<boolean> {
  const tx = (await db()).transaction('templates', 'readwrite')
  const stored = await tx.store.get(id)
  if (stored) await tx.store.put({ ...stored, ...patch })
  await tx.done
  return !!stored
}
/** True when an asset with this id is already stored (its content is then kept as it is). */
export async function hasAsset(id: string): Promise<boolean> {
  return (await (await db()).getKey('assets', id)) !== undefined
}
export async function deleteStoredTemplate(id: string): Promise<void> {
  await (await db()).delete('templates', id)
}

// --- Brand kits -----------------------------------------------------------

export async function listBrandKits(): Promise<BrandKit[]> {
  const all = await (await db()).getAll('brandKits')
  return all.sort((a, b) => a.name.localeCompare(b.name))
}
export async function getBrandKit(id: string): Promise<BrandKit | undefined> {
  return (await db()).get('brandKits', id)
}
export async function putBrandKit(kit: BrandKit): Promise<void> {
  await (await db()).put('brandKits', kit)
}
export async function deleteBrandKit(id: string): Promise<void> {
  await (await db()).delete('brandKits', id)
}

export async function putAsset(asset: StoredAsset): Promise<void> {
  await (await db()).put('assets', asset)
}

export async function getAssetBlob(id: string): Promise<Blob | undefined> {
  return (await (await db()).get('assets', id))?.blob
}

export async function getAssetPoster(id: string): Promise<Blob | undefined> {
  return (await (await db()).get('assets', id))?.poster
}

export async function getAssetProxy(id: string): Promise<Blob | undefined> {
  return (await (await db()).get('assets', id))?.proxy
}

/** Attach a preview proxy to a stored video. Does nothing when the asset was deleted in the meantime. */
export async function putAssetProxy(id: string, proxy: Blob): Promise<void> {
  const tx = (await db()).transaction('assets', 'readwrite')
  const stored = await tx.store.get(id)
  if (stored) await tx.store.put({ ...stored, proxy })
  await tx.done
}

export async function getAssetPeaks(id: string): Promise<number[] | undefined> {
  return (await (await db()).get('assets', id))?.peaks
}

/** Asset refs of a project that have no element using them (candidates for cleanup UI). */
export function unusedAssets(project: Project): AssetRef[] {
  const used = usedAssetIds(project)
  return project.assets.filter((a) => !used.has(a.id))
}

/** Ask the browser not to evict our storage under pressure. Best effort. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist()
  } catch {
    /* not supported */
  }
  return false
}

// --- Asset library ----------------------------------------------------------

/**
 * Every stored asset with where it is used. Reads all documents once; this is a
 * local, single-user library, so that stays cheap enough for the Assets tab.
 */
export async function listLibrary(): Promise<LibraryItem[]> {
  const tx = (await db()).transaction([
    'assets',
    'projectDocs',
    'templates',
    'brandKits',
    'projectVersions',
  ])
  const [assets, projects, templates, kits, versions] = await Promise.all([
    tx.objectStore('assets').getAll(),
    tx.objectStore('projectDocs').getAll() as Promise<Project[]>,
    tx.objectStore('templates').getAll(),
    tx.objectStore('brandKits').getAll(),
    tx.objectStore('projectVersions').getAll(),
  ])
  await tx.done
  const usage = new Map<string, AssetUsage>()
  const at = (id: string) => {
    let u = usage.get(id)
    if (!u) usage.set(id, (u = { projects: [], templates: [], brandKits: [], versions: 0 }))
    return u
  }
  for (const p of projects)
    for (const a of p?.assets ?? []) at(a.id).projects.push(p.name || 'Untitled')
  for (const t of templates)
    for (const a of (t.doc as Project | undefined)?.assets ?? []) at(a.id).templates.push(t.name)
  for (const k of kits) for (const a of k.logos ?? []) at(a.id).brandKits.push(k.name)
  for (const v of versions)
    for (const a of (v.doc as Project | undefined)?.assets ?? []) at(a.id).versions += 1
  for (const u of usage.values())
    for (const names of [u.projects, u.templates, u.brandKits])
      names.sort((a, b) => a.localeCompare(b))
  return assets.map((stored) => ({
    id: stored.id,
    name: stored.name,
    mime: stored.mime,
    width: stored.width,
    height: stored.height,
    size: stored.size,
    ...(stored.duration !== undefined ? { duration: stored.duration } : {}),
    createdAt: stored.createdAt,
    kind: assetKind(stored),
    favorite: stored.favorite === true,
    collections: stored.collections ?? [],
    storedBytes: stored.blob.size + (stored.poster?.size ?? 0) + (stored.proxy?.size ?? 0),
    usage: usage.get(stored.id) ?? { projects: [], templates: [], brandKits: [], versions: 0 },
  }))
}

/** Change the library fields of an asset. Does nothing when the asset no longer exists. */
export async function updateAssetLibraryInfo(
  id: string,
  patch: { favorite?: boolean; collections?: string[] },
): Promise<void> {
  const tx = (await db()).transaction('assets', 'readwrite')
  const stored = await tx.store.get(id)
  if (stored) {
    await tx.store.put({
      ...stored,
      ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}),
      ...(patch.collections !== undefined
        ? { collections: normalizeCollections(patch.collections) }
        : {}),
    })
  }
  await tx.done
}

/**
 * Remove an asset from storage. Documents that reference it keep their elements and
 * show them as missing, so callers must warn first (see usageSummary).
 */
export async function deleteAsset(id: string): Promise<void> {
  await (await db()).delete('assets', id)
}

/** Delete several assets in one transaction: all of them or none. */
export async function deleteAssets(ids: string[]): Promise<void> {
  const tx = (await db()).transaction('assets', 'readwrite')
  await Promise.all(ids.map((id) => tx.store.delete(id)))
  await tx.done
}

/** Set the favorite flag and/or add one collection on several assets in one transaction. */
export async function updateAssetsLibraryInfo(ids: string[], patch: { favorite?: boolean; addCollection?: string }): Promise<void> {
  const tx = (await db()).transaction('assets', 'readwrite')
  for (const id of ids) {
    const stored = await tx.store.get(id)
    if (!stored) continue
    await tx.store.put({
      ...stored,
      ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}),
      ...(patch.addCollection ? { collections: normalizeCollections([...(stored.collections ?? []), patch.addCollection]) } : {}),
    })
  }
  await tx.done
}

/** A small picture for the library grid: the image itself, or the poster frame of a video. */
export async function getAssetPreview(id: string): Promise<Blob | undefined> {
  const stored = await (await db()).get('assets', id)
  if (!stored) return undefined
  if (stored.poster) return stored.poster
  return stored.mime.startsWith('image/') ? stored.blob : undefined
}
