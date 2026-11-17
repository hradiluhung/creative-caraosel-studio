import { isAudioAsset, isVideoAsset, type AssetRef } from "@/document/schema";

/** Pure model of the local asset library: no IndexedDB, no browser APIs. */

export type AssetKind = "image" | "video" | "audio";

export interface AssetUsage {
  projects: string[];
  templates: string[];
  brandKits: string[];
  /** Saved versions (version history) that still reference the asset. */
  versions: number;
}

export interface LibraryItem extends AssetRef {
  kind: AssetKind;
  createdAt: string;
  favorite: boolean;
  collections: string[];
  /** Bytes of everything stored for the asset: original plus poster and preview copy. */
  storedBytes: number;
  usage: AssetUsage;
}

export type LibrarySort = "newest" | "oldest" | "name" | "largest";

export interface LibraryFilter {
  query: string;
  kind: AssetKind | "all";
  favoritesOnly: boolean;
  /** "" means every collection. */
  collection: string;
  unusedOnly: boolean;
  sort: LibrarySort;
}

export const DEFAULT_LIBRARY_FILTER: LibraryFilter = { query: "", kind: "all", favoritesOnly: false, collection: "", unusedOnly: false, sort: "newest" };

export const MAX_COLLECTION_NAME = 40;
export const MAX_COLLECTIONS_PER_ASSET = 12;

export function assetKind(asset: Pick<AssetRef, "mime">): AssetKind {
  if (isVideoAsset(asset)) return "video";
  if (isAudioAsset(asset)) return "audio";
  return "image";
}

export function usageCount(usage: AssetUsage): number {
  return usage.projects.length + usage.templates.length + usage.brandKits.length + usage.versions;
}

export const isUnused = (item: Pick<LibraryItem, "usage">) => usageCount(item.usage) === 0;

/** Trim, drop empties and duplicates (case-insensitive, first spelling wins), cap count and length. */
export function normalizeCollections(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, " ").slice(0, MAX_COLLECTION_NAME);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_COLLECTIONS_PER_ASSET) break;
  }
  return out;
}

export const parseCollections = (text: string) => normalizeCollections(text.split(","));

/** Every collection name in the library, alphabetical. */
export function allCollections(items: Array<Pick<LibraryItem, "collections">>): string[] {
  const byKey = new Map<string, string>();
  for (const item of items) for (const c of item.collections) if (!byKey.has(c.toLowerCase())) byKey.set(c.toLowerCase(), c);
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

export function filterLibrary(items: LibraryItem[], filter: LibraryFilter): LibraryItem[] {
  const q = filter.query.trim().toLowerCase();
  const collection = filter.collection.toLowerCase();
  const out = items.filter((item) => {
    if (filter.kind !== "all" && item.kind !== filter.kind) return false;
    if (filter.favoritesOnly && !item.favorite) return false;
    if (filter.unusedOnly && !isUnused(item)) return false;
    if (collection && !item.collections.some((c) => c.toLowerCase() === collection)) return false;
    if (q && !item.name.toLowerCase().includes(q) && !item.collections.some((c) => c.toLowerCase().includes(q))) return false;
    return true;
  });
  const by: Record<LibrarySort, (a: LibraryItem, b: LibraryItem) => number> = {
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
    oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
    name: (a, b) => a.name.localeCompare(b.name),
    largest: (a, b) => b.storedBytes - a.storedBytes,
  };
  return out.sort(by[filter.sort]);
}

export interface StorageSummary {
  count: number;
  bytes: number;
  byKind: Record<AssetKind, { count: number; bytes: number }>;
  unused: { count: number; bytes: number };
}

export function summarizeStorage(items: LibraryItem[]): StorageSummary {
  const summary: StorageSummary = {
    count: items.length,
    bytes: 0,
    byKind: { image: { count: 0, bytes: 0 }, video: { count: 0, bytes: 0 }, audio: { count: 0, bytes: 0 } },
    unused: { count: 0, bytes: 0 },
  };
  for (const item of items) {
    summary.bytes += item.storedBytes;
    summary.byKind[item.kind].count += 1;
    summary.byKind[item.kind].bytes += item.storedBytes;
    if (isUnused(item)) {
      summary.unused.count += 1;
      summary.unused.bytes += item.storedBytes;
    }
  }
  return summary;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** What deleting several files at once would do: used for the one warning shown before a bulk delete. */
export function bulkDeleteSummary(items: LibraryItem[]): { count: number; bytes: number; used: number; places: string[] } {
  const places = new Set<string>();
  let used = 0;
  let bytes = 0;
  for (const item of items) {
    bytes += item.storedBytes;
    if (isUnused(item)) continue;
    used += 1;
    for (const n of item.usage.projects) places.add(`Project: ${n}`);
    for (const n of item.usage.templates) places.add(`Template: ${n}`);
    for (const n of item.usage.brandKits) places.add(`Brand kit: ${n}`);
    if (item.usage.versions) places.add("Version history");
  }
  return { count: items.length, bytes, used, places: [...places].sort((a, b) => a.localeCompare(b)) };
}

/** One line for the delete warning, or null when nothing references the asset. */
export function usageSummary(usage: AssetUsage): string | null {
  const parts: string[] = [];
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (usage.projects.length) parts.push(plural(usage.projects.length, "project"));
  if (usage.templates.length) parts.push(plural(usage.templates.length, "template"));
  if (usage.brandKits.length) parts.push(plural(usage.brandKits.length, "brand kit"));
  if (usage.versions) parts.push(plural(usage.versions, "saved version"));
  return parts.length ? parts.join(", ") : null;
}
