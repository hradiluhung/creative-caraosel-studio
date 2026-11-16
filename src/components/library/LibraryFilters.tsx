"use client";

import { Search, Star } from "lucide-react";
import type { AssetKind, LibraryFilter, LibrarySort } from "@/persistence/libraryModel";
import { cn } from "@/lib/cn";
import { Select, TextInput } from "../ui/primitives";

const KINDS: Array<{ value: AssetKind | "all"; label: string }> = [
  { value: "all", label: "All types" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
  { value: "audio", label: "Audio" },
];
const SORTS: Array<{ value: LibrarySort; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "Name" },
  { value: "largest", label: "Largest first" },
];

/** Search, type, collection, favorites and sort controls shared by the Assets tab and the editor picker. */
export function LibraryFilters({
  filter,
  onChange,
  collections,
  kinds = KINDS.map((k) => k.value),
  showUnused = false,
}: {
  filter: LibraryFilter;
  onChange: (next: LibraryFilter) => void;
  collections: string[];
  kinds?: Array<AssetKind | "all">;
  showUnused?: boolean;
}) {
  const set = (patch: Partial<LibraryFilter>) => onChange({ ...filter, ...patch });
  const toggle = (active: boolean) =>
    cn("flex h-9 items-center gap-1.5 rounded-[5px] border px-2.5 text-xs font-medium", active ? "border-ink bg-ink text-bg" : "border-line text-muted hover:text-ink");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-40 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <TextInput aria-label="Search assets" placeholder="Search by name or collection" value={filter.query} onChange={(e) => set({ query: e.target.value })} className="pl-8" />
      </div>
      <div className="w-32">
        <Select label="Asset type" value={filter.kind} onChange={(v) => set({ kind: v as LibraryFilter["kind"] })} options={KINDS.filter((k) => kinds.includes(k.value))} />
      </div>
      {collections.length > 0 && (
        <div className="w-40">
          <Select
            label="Collection"
            value={filter.collection}
            onChange={(v) => set({ collection: v })}
            options={[{ value: "", label: "All collections" }, ...collections.map((c) => ({ value: c, label: c }))]}
          />
        </div>
      )}
      <div className="w-36">
        <Select label="Sort assets" value={filter.sort} onChange={(v) => set({ sort: v as LibrarySort })} options={SORTS} />
      </div>
      <button type="button" aria-pressed={filter.favoritesOnly} onClick={() => set({ favoritesOnly: !filter.favoritesOnly })} className={toggle(filter.favoritesOnly)}>
        <Star className="h-3.5 w-3.5" /> Favorites
      </button>
      {showUnused && (
        <button type="button" aria-pressed={filter.unusedOnly} onClick={() => set({ unusedOnly: !filter.unusedOnly })} className={toggle(filter.unusedOnly)}>
          Unused
        </button>
      )}
    </div>
  );
}
