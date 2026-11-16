"use client";

import { useEffect, useMemo, useState } from "react";
import { listLibrary } from "@/persistence/db";
import { allCollections, DEFAULT_LIBRARY_FILTER, filterLibrary, type LibraryItem } from "@/persistence/libraryModel";
import { AssetThumb } from "../library/AssetThumb";
import { LibraryFilters } from "../library/LibraryFilters";
import { Button, Dialog } from "../ui/primitives";
import { insertLibraryAsset } from "./actions";

/** Pick a photo or video that was imported earlier, in this or any other project. */
export function LibraryPicker({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [filter, setFilter] = useState(DEFAULT_LIBRARY_FILTER);
  useEffect(() => {
    let live = true;
    void listLibrary().then(
      (all) => live && setItems(all.filter((i) => i.kind !== "audio")),
      () => live && setItems([]),
    );
    return () => {
      live = false;
    };
  }, []);
  const collections = useMemo(() => allCollections(items ?? []), [items]);
  const shown = useMemo(() => filterLibrary(items ?? [], filter), [items, filter]);

  return (
    <Dialog
      title="Add from library"
      onClose={onClose}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        <LibraryFilters filter={filter} onChange={setFilter} collections={collections} kinds={["all", "image", "video"]} />
        {items === null ? (
          <p className="py-10 text-center text-xs text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted">The library is empty. Upload a photo or video first.</p>
        ) : shown.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted">No file matches these filters.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {shown.map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid="library-pick"
                title={`Add ${item.name}`}
                aria-label={`Add ${item.name} from library`}
                onClick={() => {
                  insertLibraryAsset(item);
                  onClose();
                }}
                className="text-left"
              >
                <AssetThumb item={item} className="hover:border-ink" />
                <span className="mt-1 block truncate text-[11px] text-muted">{item.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
