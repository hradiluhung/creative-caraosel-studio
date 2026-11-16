"use client";

import { Search, Star, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aspectRatioLabel, getExportFrames } from "@/document/geometry";
import { getAssetBlob } from "@/persistence/db";
import { loadCustomFonts } from "@/persistence/customFonts";
import { createProjectFromTemplate, deleteUserTemplate, listAllTemplates, type TemplateInfo } from "@/templates";
import { cn } from "@/lib/cn";
import { PREF, pushRecent, toggleInList, usePref } from "@/lib/prefs";
import { Button, Dialog, IconButton, Select, TextInput } from "../ui/primitives";

const NONE: string[] = [];
type Thumbs = Record<string, string>;

/**
 * Renders template slides through the same renderer the editor and exporter use.
 * The renderer (Konva) is loaded on demand so the projects list stays light.
 */
function useTemplateThumbs(requests: Array<{ key: string; template: TemplateInfo; slide: number }>): Thumbs {
  const [thumbs, setThumbs] = useState<Thumbs>({});
  const done = useRef(new Set<string>());
  const urls = useRef<string[]>([]);
  const signature = requests.map((r) => r.key).join("|");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = requests.filter((r) => !done.current.has(r.key));
      if (pending.length === 0) return;
      const [{ renderThumbnail }, { ImageStore }, { ensureFontsLoaded }, { collectFonts }] = await Promise.all([
        import("@/export/exporter"),
        import("@/render/resources"),
        import("@/render/fonts"),
        import("@/render/scene"),
      ]);
      await loadCustomFonts();
      const images = new ImageStore(getAssetBlob);
      for (const r of pending) {
        if (cancelled) break;
        try {
          await ensureFontsLoaded(collectFonts(r.template.doc));
          await images.preload(r.template.doc.assets.map((a) => a.id));
          const blob = await renderThumbnail(r.template.doc, getExportFrames(r.template.doc)[r.slide], images, 420);
          const url = URL.createObjectURL(blob);
          urls.current.push(url);
          done.current.add(r.key);
          if (!cancelled) setThumbs((t) => ({ ...t, [r.key]: url }));
        } catch {
          done.current.add(r.key);
        }
      }
      images.dispose();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  useEffect(() => {
    const list = urls.current;
    return () => list.forEach((u) => URL.revokeObjectURL(u));
  }, []);
  return thumbs;
}

function TemplatePreview({ template, onClose }: { template: TemplateInfo; onClose: () => void }) {
  const [name, setName] = useState(template.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const doc = template.doc;
  const requests = useMemo(() => doc.slides.map((_, i) => ({ key: `${template.id}:${i}`, template, slide: i })), [doc, template]);
  const thumbs = useTemplateThumbs(requests);
  const use = async () => {
    setBusy(true);
    try {
      const project = await createProjectFromTemplate(template, name);
      pushRecent(PREF.templateRecents, template.id, 6);
      window.location.href = `/editor?id=${encodeURIComponent(project.id)}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the project.");
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={template.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={use}>
            {busy ? "Creating…" : "Use this template"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-muted">
          {template.category} · {doc.slides.length} slides · {aspectRatioLabel(doc.width, doc.height)} ({doc.width} × {doc.height}) ·{" "}
          {doc.mode === "seamless" ? "Seamless panorama" : "Independent slides"}
        </p>
        <div className={cn("thin-scroll flex overflow-x-auto pb-2", doc.mode === "seamless" ? "gap-0" : "gap-2")} aria-label="Slides in this template">
          {doc.slides.map((s, i) => (
            <div key={s.id} className="h-56 shrink-0 bg-sunken outline-1 -outline-offset-1 outline-line" style={{ aspectRatio: `${doc.width} / ${doc.height}` }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
              {thumbs[`${template.id}:${i}`] && <img src={thumbs[`${template.id}:${i}`]} alt={`Slide ${i + 1}`} className="h-full w-full" />}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted">Everything stays editable: text, colors, shapes and photo frames. Dashed frames are waiting for your photos.</p>
        <TextInput aria-label="Project name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

export function TemplateLibrary() {
  const [templates, setTemplates] = useState<TemplateInfo[] | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [ratio, setRatio] = useState("");
  const [count, setCount] = useState("");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [preview, setPreview] = useState<TemplateInfo | null>(null);
  const favorites = usePref<string[]>(PREF.templateFavorites, NONE);
  const recents = usePref<string[]>(PREF.templateRecents, NONE);

  const refresh = useCallback(() => listAllTemplates().then(setTemplates), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const all = useMemo(() => templates ?? [], [templates]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = all.filter((t) => {
      const n = t.doc.slides.length;
      return (
        (!q || t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)) &&
        (!category || t.category === category) &&
        (!ratio || aspectRatioLabel(t.doc.width, t.doc.height) === ratio) &&
        (!count || (count === "1-3" ? n <= 3 : count === "4-6" ? n >= 4 && n <= 6 : n >= 7)) &&
        (!onlyFavorites || favorites.includes(t.id))
      );
    });
    // Recently used first, otherwise keep registry order.
    const rank = (t: TemplateInfo) => (recents.includes(t.id) ? recents.indexOf(t.id) : 99);
    return [...list].sort((a, b) => rank(a) - rank(b));
  }, [all, query, category, ratio, count, onlyFavorites, favorites, recents]);

  const requests = useMemo(() => shown.filter((t) => !t.thumbnail).map((t) => ({ key: `${t.id}:0`, template: t, slide: 0 })), [shown]);
  const thumbs = useTemplateThumbs(requests);
  const userThumbs = useMemo(() => {
    const map: Thumbs = {};
    for (const t of all) if (t.thumbnail) map[t.id] = URL.createObjectURL(t.thumbnail);
    return map;
  }, [all]);
  useEffect(() => () => Object.values(userThumbs).forEach((u) => URL.revokeObjectURL(u)), [userThumbs]);

  const unique = (values: string[]) => [...new Set(values)];
  const option = (label: string, values: string[]) => [{ value: "", label }, ...values.map((v) => ({ value: v, label: v }))];

  if (!templates) return <p className="py-16 text-center text-muted">Loading templates…</p>;

  return (
    <div className="pb-16">
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <TextInput aria-label="Search templates" placeholder="Search templates" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
        </div>
        <Select label="Category" className="w-auto!" value={category} onChange={setCategory} options={option("All categories", unique(all.map((t) => t.category)))} />
        <Select label="Aspect ratio" className="w-auto!" value={ratio} onChange={setRatio} options={option("Any ratio", unique(all.map((t) => aspectRatioLabel(t.doc.width, t.doc.height))))} />
        <Select label="Slide count" className="w-auto!" value={count} onChange={setCount} options={[{ value: "", label: "Any length" }, { value: "1-3", label: "1–3 slides" }, { value: "4-6", label: "4–6 slides" }, { value: "7+", label: "7+ slides" }]} />
        <Button size="sm" className="h-8" aria-pressed={onlyFavorites} variant={onlyFavorites ? "primary" : "outline"} onClick={() => setOnlyFavorites(!onlyFavorites)}>
          <Star className="h-3.5 w-3.5" /> Favorites
        </Button>
      </div>

      {shown.length === 0 ? (
        <p className="py-16 text-center text-muted">No template matches these filters.</p>
      ) : (
        <section aria-label="Templates" className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((t) => {
            const src = t.thumbnail ? userThumbs[t.id] : thumbs[`${t.id}:0`];
            const fav = favorites.includes(t.id);
            return (
              <article key={t.id} className="group relative">
                <button type="button" onClick={() => setPreview(t)} aria-label={`Preview template ${t.name}`} className="block w-full text-left">
                  <div className="flex aspect-[4/5] items-center justify-center overflow-hidden rounded-md border border-line bg-sunken p-3 transition-colors group-hover:border-line-strong">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                    {src ? <img src={src} alt="" className="max-h-full max-w-full object-contain shadow-md" /> : <span className="text-xs text-muted">Rendering…</span>}
                  </div>
                  <h3 className="mt-2.5 truncate pr-16 text-[13px] font-medium">{t.name}</h3>
                  <p className="mt-0.5 text-xs text-muted">
                    {t.category} · {t.doc.slides.length} slides · {aspectRatioLabel(t.doc.width, t.doc.height)}
                    {recents.includes(t.id) && " · Recent"}
                  </p>
                </button>
                <div className="absolute right-0 bottom-3.5 flex">
                  {t.source === "user" && (
                    <IconButton label={`Delete template ${t.name}`} onClick={() => void deleteUserTemplate(t.id).then(refresh)}>
                      <Trash2 />
                    </IconButton>
                  )}
                  <IconButton label={fav ? `Remove ${t.name} from favorites` : `Add ${t.name} to favorites`} onClick={() => toggleInList(PREF.templateFavorites, t.id)}>
                    <Star className={fav ? "fill-current" : ""} />
                  </IconButton>
                </div>
              </article>
            );
          })}
        </section>
      )}
      {preview && <TemplatePreview template={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
