"use client";

import { ChevronDown, Search, Star, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { StoredFont } from "@/persistence/db";
import { deleteCustomFont, FONT_ACCEPT_ATTR, importFontFiles, listCustomFontFiles, updateCustomFont } from "@/persistence/customFonts";
import { FONT_CATEGORIES, FONT_FALLBACK, fontLabel, getFontCatalog, subscribeFonts, type FontDef } from "@/render/fonts";
import { cn } from "@/lib/cn";
import { PREF, pushRecent, toggleInList, usePref } from "@/lib/prefs";
import { Button, Dialog, IconButton, Select, TextInput } from "../ui/primitives";

export function useFontCatalog(): FontDef[] {
  return useSyncExternalStore(subscribeFonts, getFontCatalog, getFontCatalog);
}

const NO_FONTS: string[] = [];
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

function CustomFontFiles({ family, onChanged }: { family: string; onChanged: () => void }) {
  const [files, setFiles] = useState<StoredFont[]>([]);
  const catalog = useFontCatalog();
  useEffect(() => {
    let live = true;
    void listCustomFontFiles().then((all) => live && setFiles(all.filter((f) => f.family === family)));
    return () => {
      live = false;
    };
  }, [family, catalog]);
  const [label, setLabel] = useState<string | null>(null);
  if (files.length === 0) return null;
  return (
    <div className="space-y-2 border-t border-line bg-sunken px-3 py-2.5">
      <div className="flex gap-2">
        <TextInput aria-label="Font name" value={label ?? files[0].label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
        <Button
          size="sm"
          className="h-8"
          disabled={!label?.trim() || label === files[0].label}
          onClick={() => label && void updateCustomFont(files[0].id, { label }).then(onChanged)}
        >
          Rename
        </Button>
      </div>
      {files.map((f) => (
        <div key={f.id} className="flex items-center gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate text-muted" title={f.fileName}>
            {f.fileName}
          </span>
          <Select
            label={`Weight of ${f.fileName}`}
            className="h-7 w-20"
            value={String(f.weight)}
            onChange={(w) => void updateCustomFont(f.id, { weight: Number(w) })}
            options={WEIGHTS.map((w) => ({ value: String(w), label: String(w) }))}
          />
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={f.italic} onChange={(e) => void updateCustomFont(f.id, { italic: e.target.checked })} />
            Italic
          </label>
          <IconButton label={`Delete ${f.fileName}`} className="h-7 w-7" onClick={() => void deleteCustomFont(f.id)}>
            <Trash2 />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

export function FontPicker({ value, onChange }: { value: string; onChange: (family: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("All");
  const [managing, setManaging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const catalog = useFontCatalog();
  const favorites = usePref<string[]>(PREF.fontFavorites, NO_FONTS);
  const recents = usePref<string[]>(PREF.fontRecents, NO_FONTS);

  const filters = useMemo(() => {
    const used = new Set(catalog.map((f) => f.category));
    return ["All", "Favorites", "Recent", ...FONT_CATEGORIES.filter((c) => used.has(c))];
  }, [catalog]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = catalog;
    if (filter === "Favorites") list = list.filter((f) => favorites.includes(f.family));
    else if (filter === "Recent") list = recents.map((r) => catalog.find((f) => f.family === r)).filter((f): f is FontDef => !!f);
    else if (filter !== "All") list = list.filter((f) => f.category === filter);
    return q ? list.filter((f) => f.label.toLowerCase().includes(q) || f.category.toLowerCase().includes(q)) : list;
  }, [catalog, favorites, recents, filter, query]);

  const pick = (family: string) => {
    pushRecent(PREF.fontRecents, family, 8);
    onChange(family);
    setOpen(false);
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const result = await importFontFiles(Array.from(files));
    setErrors(result.errors);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (result.added.length > 0) {
      setFilter("Custom");
      setQuery("");
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="Font family"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex h-8 w-full items-center justify-between rounded-[5px] border border-line bg-panel px-2 text-left text-[13px] hover:border-line-strong"
      >
        <span className="truncate" style={{ fontFamily: `"${value}", ${FONT_FALLBACK}` }}>
          {fontLabel(value)}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />
      </button>
      {open && (
        <Dialog title="Fonts" onClose={() => setOpen(false)}>
          <div className="-mx-5 -my-4">
            <div className="space-y-2.5 border-b border-line px-4 py-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                  <TextInput aria-label="Search fonts" placeholder="Search fonts" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
                </div>
                <input ref={fileRef} type="file" accept={FONT_ACCEPT_ATTR} multiple hidden data-testid="font-input" onChange={(e) => void upload(e.target.files)} />
                <Button className="h-8" disabled={busy} onClick={() => fileRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" /> {busy ? "Adding…" : "Upload font"}
                </Button>
              </div>
              <div className="thin-scroll -mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
                {filters.map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={filter === f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      "h-6 shrink-0 rounded-full border px-2.5 text-[11px] font-medium",
                      filter === f ? "border-ink bg-ink text-bg" : "border-line text-muted hover:text-ink",
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
              {errors.length > 0 && (
                <ul role="alert" className="space-y-0.5 text-xs text-danger">
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-muted">TTF, OTF, WOFF or WOFF2. Uploaded fonts stay on this device and are only available inside this app.</p>
            </div>
            <ul aria-label="Font list" className="max-h-[46dvh] overflow-y-auto">
              {shown.length === 0 && <li className="px-4 py-6 text-center text-xs text-muted">No fonts here yet.</li>}
              {shown.map((f) => (
                <li key={f.family} className="border-b border-line last:border-b-0">
                  <div className={cn("flex items-center gap-1 pr-2 pl-4", f.family === value && "bg-sunken")}>
                    <button
                      type="button"
                      onClick={() => pick(f.family)}
                      className="flex min-w-0 flex-1 items-baseline gap-2 py-2.5 text-left"
                      aria-label={`Use ${f.label}`}
                    >
                      <span className="truncate text-[19px] leading-tight" style={{ fontFamily: `"${f.family}", ${FONT_FALLBACK}` }}>
                        {f.label}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted">{f.category}</span>
                    </button>
                    {f.custom && (
                      <Button size="sm" variant="ghost" onClick={() => setManaging(managing === f.family ? null : f.family)}>
                        {managing === f.family ? "Close" : "Manage"}
                      </Button>
                    )}
                    <IconButton
                      label={favorites.includes(f.family) ? `Remove ${f.label} from favorites` : `Add ${f.label} to favorites`}
                      onClick={() => toggleInList(PREF.fontFavorites, f.family)}
                    >
                      <Star className={favorites.includes(f.family) ? "fill-current" : ""} />
                    </IconButton>
                  </div>
                  {f.custom && managing === f.family && <CustomFontFiles family={f.family} onChanged={() => undefined} />}
                </li>
              ))}
            </ul>
          </div>
        </Dialog>
      )}
    </>
  );
}
