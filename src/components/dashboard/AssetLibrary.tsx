"use client";

import { Star, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { importImageFile, IMAGE_ACCEPT_ATTR } from "@/persistence/assets";
import { deleteAsset, listLibrary, updateAssetLibraryInfo } from "@/persistence/db";
import {
  allCollections,
  DEFAULT_LIBRARY_FILTER,
  filterLibrary,
  formatBytes,
  parseCollections,
  summarizeStorage,
  usageSummary,
  type LibraryItem,
} from "@/persistence/libraryModel";
import { importVideoFile, VIDEO_ACCEPT_ATTR } from "@/persistence/video";
import { AssetThumb } from "../library/AssetThumb";
import { LibraryFilters } from "../library/LibraryFilters";
import { Button, Dialog, Label, TextInput } from "../ui/primitives";

const describe = (item: LibraryItem) =>
  [item.kind === "audio" ? null : `${item.width}×${item.height}`, formatBytes(item.storedBytes)].filter(Boolean).join(" · ");

function AssetDetails({ item, onClose }: { item: LibraryItem; onClose: (changed: boolean) => void }) {
  const [collections, setCollections] = useState(item.collections.join(", "));
  const [favorite, setFavorite] = useState(item.favorite);
  const [confirming, setConfirming] = useState(false);
  const used = usageSummary(item.usage);
  const dirty = favorite !== item.favorite || parseCollections(collections).join("|") !== item.collections.join("|");
  const names = [...item.usage.projects.map((n) => `Project: ${n}`), ...item.usage.templates.map((n) => `Template: ${n}`), ...item.usage.brandKits.map((n) => `Brand kit: ${n}`)];

  return (
    <Dialog
      title={item.name}
      onClose={() => onClose(false)}
      footer={
        confirming ? (
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button variant="primary" className="bg-danger" data-testid="confirm-delete-asset" onClick={() => void deleteAsset(item.id).then(() => onClose(true))}>
              Delete permanently
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" className="mr-auto text-danger" onClick={() => setConfirming(true)}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
            <Button variant="ghost" onClick={() => onClose(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              disabled={!dirty}
              onClick={() => void updateAssetLibraryInfo(item.id, { favorite, collections: parseCollections(collections) }).then(() => onClose(true))}
            >
              Save
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <div className="flex gap-4">
          <AssetThumb item={{ ...item, favorite }} className="w-28 shrink-0" />
          <div className="min-w-0 space-y-1 text-xs text-muted">
            <p className="text-ink">{describe(item)}</p>
            <p>{item.mime}</p>
            <p>Added {new Date(item.createdAt).toLocaleDateString()}</p>
            <button type="button" aria-pressed={favorite} onClick={() => setFavorite(!favorite)} className="mt-1 flex items-center gap-1.5 text-ink hover:underline">
              <Star className={favorite ? "h-3.5 w-3.5 fill-amber-400 text-amber-400" : "h-3.5 w-3.5"} /> {favorite ? "Favorite" : "Mark as favorite"}
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="asset-collections">Collections</Label>
          <TextInput id="asset-collections" placeholder="e.g. Bali trip, Client A" value={collections} onChange={(e) => setCollections(e.target.value)} />
          <p className="text-[11px] text-muted">Separate several collections with commas.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Used in</Label>
          {used ? (
            <ul className="space-y-0.5 text-xs" data-testid="asset-usage">
              {names.map((n, i) => (
                <li key={i} className="truncate">
                  {n}
                </li>
              ))}
              {item.usage.versions > 0 && <li className="text-muted">{item.usage.versions} saved version{item.usage.versions === 1 ? "" : "s"} in version history</li>}
            </ul>
          ) : (
            <p className="text-xs text-muted" data-testid="asset-usage">
              Not used anywhere.
            </p>
          )}
        </div>
        {confirming && (
          <p role="alert" className="rounded-md border border-danger/40 px-3 py-2 text-xs text-danger">
            {used
              ? `This file is still used in ${used}. After deleting, those places show it as missing and it cannot be restored.`
              : "The file is removed from this device and cannot be restored."}
          </p>
        )}
      </div>
    </Dialog>
  );
}

export function AssetLibrary() {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [filter, setFilter] = useState(DEFAULT_LIBRARY_FILTER);
  const [open, setOpen] = useState<LibraryItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await listLibrary());
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.usage !== undefined && estimate.quota) setQuota({ usage: estimate.usage, quota: estimate.quota });
    } catch {
      setItems([]);
      setErrors(["The asset library could not be read."]);
    }
  }, []);
  useEffect(() => {
    // Initial read of external storage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const failed: string[] = [];
    for (const file of Array.from(files)) {
      try {
        await (file.type.startsWith("video/") ? importVideoFile(file) : importImageFile(file));
      } catch (e) {
        failed.push(e instanceof Error ? e.message : `Could not import "${file.name}".`);
      }
    }
    setErrors(failed);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    await refresh();
  };

  const collections = useMemo(() => allCollections(items ?? []), [items]);
  const shown = useMemo(() => filterLibrary(items ?? [], filter), [items, filter]);
  const summary = useMemo(() => summarizeStorage(items ?? []), [items]);

  return (
    <div className="pb-16">
      <input ref={fileRef} type="file" accept={`${IMAGE_ACCEPT_ATTR},${VIDEO_ACCEPT_ATTR}`} multiple hidden data-testid="library-input" onChange={(e) => void onFiles(e.target.files)} />
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div data-testid="storage-overview" className="text-xs text-muted">
          <p className="text-[13px] text-ink">
            {summary.count} file{summary.count === 1 ? "" : "s"}, {formatBytes(summary.bytes)}
          </p>
          <p className="mt-1">
            Images {formatBytes(summary.byKind.image.bytes)} · Videos {formatBytes(summary.byKind.video.bytes)} · Audio {formatBytes(summary.byKind.audio.bytes)}
          </p>
          <p>
            Unused: {summary.unused.count} file{summary.unused.count === 1 ? "" : "s"}, {formatBytes(summary.unused.bytes)}
            {quota && ` · This browser reports ${formatBytes(quota.usage)} of about ${formatBytes(quota.quota)} used by the whole app`}
          </p>
        </div>
        <Button disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4" /> {busy ? "Importing…" : "Add files"}
        </Button>
      </div>

      <div className="mb-6">
        <LibraryFilters filter={filter} onChange={setFilter} collections={collections} showUnused />
      </div>

      {errors.length > 0 && (
        <ul role="alert" className="mb-6 space-y-1 rounded-md border border-danger/40 px-3 py-2 text-xs text-danger">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {items === null ? (
        <p className="py-16 text-center text-muted">Loading assets…</p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong px-6 py-20 text-center">
          <p className="font-display text-2xl font-bold">No files yet</p>
          <p className="mx-auto mt-2 max-w-sm text-muted">Photos, videos and music you import in any project are collected here and can be reused in other projects.</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="py-16 text-center text-muted">No file matches these filters.</p>
      ) : (
        <section aria-label="Assets" className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
          {shown.map((item) => (
            <button key={item.id} type="button" data-testid="asset-card" data-kind={item.kind} onClick={() => setOpen(item)} className="group text-left">
              <AssetThumb item={item} className="group-hover:border-ink" />
              <p className="mt-1.5 truncate text-xs font-medium">{item.name}</p>
              <p className="truncate text-[11px] text-muted">
                {describe(item)}
                {usageSummary(item.usage) ? "" : " · unused"}
              </p>
            </button>
          ))}
        </section>
      )}

      {open && (
        <AssetDetails
          key={open.id}
          item={open}
          onClose={(changed) => {
            setOpen(null);
            if (changed) void refresh();
          }}
        />
      )}
    </div>
  );
}
