"use client";

import { ImagePlus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createId } from "@/document/ids";
import type { AssetRef } from "@/document/schema";
import { importImageFile, IMAGE_ACCEPT_ATTR } from "@/persistence/assets";
import { loadCustomFonts } from "@/persistence/customFonts";
import { deleteBrandKit, getAssetBlob, listBrandKits, putBrandKit, type BrandKit } from "@/persistence/db";
import { FONT_FALLBACK, fontLabel, getFontCatalog, subscribeFonts } from "@/render/fonts";
import { useObjectUrl } from "@/lib/useObjectUrl";
import { Button, ColorField, Dialog, IconButton, Label, Select, TextInput } from "../ui/primitives";

function LogoThumb({ logo, onRemove }: { logo: AssetRef; onRemove?: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let live = true;
    void getAssetBlob(logo.id).then((b) => live && b && setBlob(b));
    return () => {
      live = false;
    };
  }, [logo.id]);
  const url = useObjectUrl(blob);
  return (
    <div className="relative flex h-16 w-16 items-center justify-center rounded-[5px] border border-line bg-sunken p-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
      {url && <img src={url} alt={logo.name} className="max-h-full max-w-full object-contain" />}
      {onRemove && (
        <button type="button" aria-label={`Remove logo ${logo.name}`} onClick={onRemove} className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-panel">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function BrandKitEditor({ initial, onClose }: { initial: BrandKit; onClose: (changed: boolean) => void }) {
  const [kit, setKit] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fonts = useSyncExternalStore(subscribeFonts, getFontCatalog, getFontCatalog);
  const fontOptions = fonts.map((f) => ({ value: f.family, label: f.label, group: f.category }));

  const addLogos = async (files: FileList | null) => {
    if (!files) return;
    const added: AssetRef[] = [];
    for (const file of Array.from(files)) {
      try {
        added.push(await importImageFile(file));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not import the logo.");
      }
    }
    setKit((k) => ({ ...k, logos: [...k.logos, ...added] }));
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <Dialog
      title={initial.name ? "Edit brand kit" : "New brand kit"}
      onClose={() => onClose(false)}
      footer={
        <>
          {initial.name && (
            <Button variant="ghost" className="mr-auto text-danger" onClick={() => void deleteBrandKit(kit.id).then(() => onClose(true))}>
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={() => onClose(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!kit.name.trim()}
            onClick={() => void putBrandKit({ ...kit, name: kit.name.trim(), updatedAt: new Date().toISOString() }).then(() => onClose(true))}
          >
            Save brand kit
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="bk-name">Name</Label>
          <TextInput id="bk-name" value={kit.name} maxLength={60} placeholder="My brand" onChange={(e) => setKit({ ...kit, name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Colors</Label>
          {kit.colors.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="flex-1">
                <ColorField label={`Brand color ${i + 1}`} value={c} onChange={(color) => setKit({ ...kit, colors: kit.colors.map((x, j) => (j === i ? color : x)) })} />
              </div>
              <IconButton label={`Remove brand color ${i + 1}`} onClick={() => setKit({ ...kit, colors: kit.colors.filter((_, j) => j !== i) })}>
                <X />
              </IconButton>
            </div>
          ))}
          <Button size="sm" disabled={kit.colors.length >= 8} onClick={() => setKit({ ...kit, colors: [...kit.colors, "#2f5bea"] })}>
            <Plus className="h-3.5 w-3.5" /> Add color
          </Button>
          <p className="text-xs text-muted">The first color is the primary one.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Heading font</Label>
            <Select label="Heading font" value={kit.headingFont} onChange={(headingFont) => setKit({ ...kit, headingFont })} options={fontOptions} />
          </div>
          <div className="space-y-1.5">
            <Label>Body font</Label>
            <Select label="Body font" value={kit.bodyFont} onChange={(bodyFont) => setKit({ ...kit, bodyFont })} options={fontOptions} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Logos</Label>
          <div className="flex flex-wrap gap-2.5">
            {kit.logos.map((logo) => (
              <LogoThumb key={logo.id} logo={logo} onRemove={() => setKit({ ...kit, logos: kit.logos.filter((l) => l.id !== logo.id) })} />
            ))}
            <input ref={fileRef} type="file" accept={IMAGE_ACCEPT_ATTR} multiple hidden data-testid="logo-input" onChange={(e) => void addLogos(e.target.files)} />
            <button type="button" aria-label="Upload logo" onClick={() => fileRef.current?.click()} className="flex h-16 w-16 items-center justify-center rounded-[5px] border border-dashed border-line-strong text-muted hover:text-ink">
              <ImagePlus className="h-5 w-5" />
            </button>
          </div>
          <p className="text-xs text-muted">PNG with a transparent background works best.</p>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      </div>
    </Dialog>
  );
}

export function BrandKits() {
  const [kits, setKits] = useState<BrandKit[] | null>(null);
  const [editing, setEditing] = useState<BrandKit | null>(null);
  const refresh = useCallback(() => listBrandKits().then(setKits, () => setKits([])), []);
  useEffect(() => {
    void refresh();
    void loadCustomFonts();
  }, [refresh]);

  const blank = (): BrandKit => ({ id: createId(), name: "", colors: ["#111111", "#2f5bea"], headingFont: "Playfair Display", bodyFont: "Inter", logos: [], updatedAt: "" });

  if (!kits) return <p className="py-16 text-center text-muted">Loading brand kits…</p>;
  return (
    <div className="pb-16">
      <div className="mb-6 flex items-center justify-between gap-4">
        <p className="max-w-md text-muted">A brand kit keeps your colors, fonts and logos together. Attach one to a project from the Brand section of the editor.</p>
        <Button onClick={() => setEditing(blank())}>
          <Plus className="h-4 w-4" /> New brand kit
        </Button>
      </div>
      {kits.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong px-6 py-16 text-center text-muted">No brand kits yet.</div>
      ) : (
        <section aria-label="Brand kits" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {kits.map((kit) => (
            <button key={kit.id} type="button" onClick={() => setEditing(kit)} aria-label={`Edit brand kit ${kit.name}`} className="rounded-md border border-line bg-panel p-4 text-left hover:border-line-strong">
              <h3 className="text-[15px] font-semibold">{kit.name}</h3>
              <div className="mt-3 flex gap-1.5">
                {kit.colors.map((c, i) => (
                  <span key={i} style={{ background: c }} className="h-7 w-7 rounded-full border border-line-strong" />
                ))}
              </div>
              <p className="mt-3 truncate text-2xl" style={{ fontFamily: `"${kit.headingFont}", ${FONT_FALLBACK}` }}>
                {fontLabel(kit.headingFont)}
              </p>
              <p className="truncate text-muted" style={{ fontFamily: `"${kit.bodyFont}", ${FONT_FALLBACK}` }}>
                {fontLabel(kit.bodyFont)} · {kit.logos.length} {kit.logos.length === 1 ? "logo" : "logos"}
              </p>
            </button>
          ))}
        </section>
      )}
      {editing && (
        <BrandKitEditor
          initial={editing}
          onClose={(changed) => {
            setEditing(null);
            if (changed) void refresh();
          }}
        />
      )}
    </div>
  );
}
