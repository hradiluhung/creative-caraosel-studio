"use client";

import { ArrowRight, Circle, Film, Hexagon, ImagePlus, Library, Minus, Square, Star, Triangle, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SHAPE_LABELS } from "@/document/factory";
import { getSurface } from "@/document/geometry";
import { clampLayoutCount, LAYOUT_KINDS, LAYOUT_LABELS, layoutBoxes, MAX_LAYOUT_COUNT, MIN_LAYOUT_COUNT } from "@/document/layouts";
import { addAssetRef, setBackground } from "@/document/operations";
import { isAudioAsset, isVideoAsset, type AssetRef, type Background, type OverlayKind, type ShapeKind } from "@/document/schema";
import { formatSeconds } from "@/document/timing";
import { getAssetBlob, listBrandKits, type BrandKit } from "@/persistence/db";
import { STICKERS, type StickerDef } from "@/render/stickers";
import { useObjectUrl } from "@/lib/useObjectUrl";
import { IMAGE_ACCEPT_ATTR } from "@/persistence/assets";
import { VIDEO_ACCEPT_ATTR } from "@/persistence/video";
import type { ImageStore } from "@/render/resources";
import { useEditorStore } from "@/store/editorStore";
import { Button, ColorField, IconButton, Label, NumberField, Segmented, Select } from "../ui/primitives";
import { applyLayout, importImages, importVideos, insertAsset, insertOverlay, insertShape, insertSticker, insertStyledText, insertText } from "./actions";
import { ColorControl } from "./ColorControl";
import { LibraryPicker } from "./LibraryPicker";

const SHAPES: Array<{ kind: ShapeKind; icon: ReactNode }> = [
  { kind: "rect", icon: <Square /> },
  { kind: "ellipse", icon: <Circle /> },
  { kind: "triangle", icon: <Triangle /> },
  { kind: "polygon", icon: <Hexagon /> },
  { kind: "star", icon: <Star /> },
  { kind: "line", icon: <Minus /> },
  { kind: "arrow", icon: <ArrowRight /> },
];

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-b border-line px-3.5 py-3.5 last:border-b-0">
      <Label>{title}</Label>
      {children}
    </section>
  );
}

const GRADIENT_PRESETS: string[][] = [
  ["#ff9a8b", "#ff6a88", "#ff99ac"],
  ["#f6d365", "#fda085"],
  ["#a1c4fd", "#c2e9fb"],
  ["#d4fc79", "#96e6a1"],
  ["#fdfbfb", "#e2e0dc"],
  ["#0f2027", "#203a43", "#2c5364"],
  ["#232526", "#414345"],
];

const evenStops = (colors: string[]) => colors.map((color, i) => ({ offset: colors.length === 1 ? 0 : i / (colors.length - 1), color }));

export function BackgroundControls() {
  const project = useEditorStore((s) => s.project);
  const activeSurfaceId = useEditorStore((s) => s.activeSurfaceId);
  const commit = useEditorStore((s) => s.commit);
  const surface = project && getSurface(project, activeSurfaceId);
  if (!surface) return null;
  const bg = surface.background;
  const set = (next: Background, coalesce?: string) =>
    commit((p) => setBackground(p, activeSurfaceId, next), coalesce ? { coalesce: `bg:${coalesce}:${activeSurfaceId}` } : undefined);
  const colors = bg.type === "linear" || bg.type === "radial" ? bg.stops.map((s) => s.color) : bg.type === "solid" ? [bg.color, "#d9d4cc"] : ["#ffffff", "#d9d4cc"];
  const gradient = (type: "linear" | "radial", cs: string[], coalesce?: string) =>
    set(type === "linear" ? { type, angle: bg.type === "linear" ? bg.angle : 180, stops: evenStops(cs) } : { type, stops: evenStops(cs) }, coalesce);

  return (
    <div className="space-y-2.5">
      <Segmented
        label="Background type"
        value={bg.type}
        onChange={(type) => {
          if (type === "solid") set({ type, color: colors[0] });
          else if (type === "transparent") set({ type });
          else gradient(type, colors);
        }}
        options={[
          { value: "solid", label: "Solid" },
          { value: "linear", label: "Linear" },
          { value: "radial", label: "Radial" },
          { value: "transparent", label: "None" },
        ]}
      />
      {bg.type === "solid" && <ColorControl label="Background color" value={bg.color} onChange={(color) => set({ type: "solid", color }, "solid")} />}
      {bg.type === "transparent" && <p className="text-xs text-muted">Transparent in PNG exports. JPG fills white.</p>}
      {(bg.type === "linear" || bg.type === "radial") && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {GRADIENT_PRESETS.map((preset) => (
              <button
                key={preset.join()}
                type="button"
                aria-label={`Gradient ${preset.join(" to ")}`}
                onClick={() => gradient(bg.type, preset)}
                style={{ background: `linear-gradient(135deg, ${preset.join(", ")})` }}
                className="h-6 w-6 rounded-full border border-line-strong"
              />
            ))}
          </div>
          {colors.map((c, i) => (
            <div key={i} className="flex items-start gap-1">
              <div className="min-w-0 flex-1">
                <ColorField
                  label={`Gradient color ${i + 1}`}
                  value={c}
                  onChange={(color) => gradient(bg.type, colors.map((x, j) => (j === i ? color : x)), `stop${i}`)}
                />
              </div>
              <IconButton label={`Remove gradient color ${i + 1}`} disabled={colors.length <= 2} onClick={() => gradient(bg.type, colors.filter((_, j) => j !== i))}>
                <X />
              </IconButton>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={colors.length >= 6} onClick={() => gradient(bg.type, [...colors, colors[colors.length - 1]])}>
              Add color
            </Button>
            {bg.type === "linear" && (
              <div className="w-24">
                <NumberField label="Gradient angle" prefix="∠" min={0} max={360} value={bg.angle} onChange={(angle) => set({ ...bg, angle }, "angle")} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StickerThumb({ def }: { def: StickerDef }) {
  const color = def.color ?? "currentColor";
  return (
    <svg viewBox={`${-6} ${-6} ${def.width + 12} ${def.height + 12}`} className="h-full w-full" aria-hidden>
      <path
        d={def.data}
        fill={def.mode === "fill" ? color : "none"}
        fillRule={def.evenOdd ? "evenodd" : "nonzero"}
        stroke={def.mode === "stroke" ? color : def.mode === "fill" && def.color ? "rgba(0,0,0,0.25)" : "none"}
        strokeWidth={def.mode === "stroke" ? (def.strokeWidth ?? 4) : 1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const OVERLAYS: Array<{ kind: OverlayKind; label: string; preview: string }> = [
  { kind: "grain", label: "Film grain", preview: "repeating-conic-gradient(#8a8a8a 0% 25%, #b5b5b5 0% 50%) 0 0 / 4px 4px" },
  { kind: "light-leak", label: "Light leak", preview: "radial-gradient(circle at 95% 5%, #ff8a3d, #ff8a3d88 35%, transparent 80%), #2a2a2a" },
  { kind: "vignette", label: "Vignette", preview: "radial-gradient(circle, #d8d4cc 35%, #111 100%)" },
];

function BrandSection() {
  const project = useEditorStore((s) => s.project);
  const kit = useEditorStore((s) => s.brandKit);
  const commit = useEditorStore((s) => s.commit);
  const [kits, setKits] = useState<BrandKit[] | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void listBrandKits().then((list) => live && setKits(list), () => live && setKits([]));
    return () => {
      live = false;
    };
  }, []);
  if (!project || !kits) return null;
  if (kits.length === 0) {
    return <p className="text-xs text-muted">No brand kit yet. Create one from the Brand kits tab on the projects screen.</p>;
  }
  return (
    <div className="space-y-2">
      <Select
        label="Brand kit"
        value={project.brandKitId ?? ""}
        onChange={(id) => commit((p) => ({ ...p, brandKitId: id || null }))}
        options={[{ value: "", label: "No brand kit" }, ...kits.map((k) => ({ value: k.id, label: k.name }))]}
      />
      {kit && (
        <>
          {kit.colors.length > 0 && (
            <div className="flex flex-wrap gap-1" aria-label="Brand colors">
              {kit.colors.map((c) => (
                <span key={c} title={c.toUpperCase()} style={{ background: c }} className="h-5 w-5 rounded-full border border-line-strong" />
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            <Button size="sm" onClick={() => void insertStyledText("heading", kit.headingFont, kit.colors[0])}>
              Brand heading
            </Button>
            <Button size="sm" onClick={() => void insertStyledText("body", kit.bodyFont)}>
              Brand body
            </Button>
          </div>
          {kit.logos.length > 0 && (
            <div className="grid grid-cols-4 gap-1.5 md:grid-cols-3">
              {kit.logos.map((logo) => (
                <BrandLogo key={logo.id} logo={logo} onLoaded={() => setTick((t) => t + 1)} />
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted">Brand colors appear as round swatches under every color field.</p>
        </>
      )}
    </div>
  );
}

function BrandLogo({ logo, onLoaded }: { logo: AssetRef; onLoaded: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let live = true;
    void getAssetBlob(logo.id).then((b) => {
      if (live && b) {
        setBlob(b);
        onLoaded();
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logo.id]);
  const url = useObjectUrl(blob);
  return (
    <button
      type="button"
      aria-label={`Add logo ${logo.name}`}
      title={`Add ${logo.name}`}
      onClick={() => {
        const s = useEditorStore.getState();
        s.commit((p) => addAssetRef(p, logo));
        insertAsset(logo);
      }}
      className="flex aspect-square items-center justify-center overflow-hidden rounded-[4px] border border-line bg-sunken p-1 hover:border-ink"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
      {url && <img src={url} alt="" className="max-h-full max-w-full object-contain" draggable={false} />}
    </button>
  );
}

const LAYOUT_PREVIEW = { x: 0, y: 0, width: 40, height: 50 };

/** Photo frame layouts for the slide in view: new empty frames, or the selected photos rearranged. */
function LayoutsSection() {
  const [count, setCount] = useState(4);
  const [gap, setGap] = useState(16);
  const arranging = useEditorStore((s) => {
    if (!s.project || s.selection.length < MIN_LAYOUT_COUNT) return 0;
    const selected = new Set(s.selection);
    const surface = getSurface(s.project, s.activeSurfaceId);
    return surface?.elements.filter((el) => selected.has(el.id) && !el.locked && (el.type === "image" || el.type === "video")).length ?? 0;
  });
  const rearrange = arranging >= MIN_LAYOUT_COUNT;
  const shown = rearrange ? arranging : count;
  return (
    <Section title="Layouts">
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Frames" prefix="#" value={shown} onChange={(v) => setCount(clampLayoutCount(v))} min={MIN_LAYOUT_COUNT} max={MAX_LAYOUT_COUNT} disabled={rearrange} />
        <NumberField label="Gap" prefix="↔" value={gap} onChange={setGap} min={0} max={200} />
      </div>
      <div className="grid grid-cols-7 gap-1 md:grid-cols-4" data-testid="layout-options">
        {LAYOUT_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            title={LAYOUT_LABELS[kind]}
            aria-label={`${rearrange ? "Arrange selected photos as" : "Add photo frames as"} ${LAYOUT_LABELS[kind].toLowerCase()}`}
            data-layout={kind}
            onClick={() => applyLayout(kind, count, gap)}
            className="flex aspect-square items-center justify-center rounded-[5px] border border-line p-1.5 hover:border-line-strong hover:bg-sunken"
          >
            <svg viewBox="-2 -2 44 54" className="h-full w-full" aria-hidden>
              {layoutBoxes(kind, Math.min(shown, 9), LAYOUT_PREVIEW, { gap: 2 }).map((b, i) => (
                <rect
                  key={i}
                  x={b.x}
                  y={b.y}
                  width={b.width}
                  height={b.height}
                  rx={1}
                  transform={b.rotation ? `rotate(${b.rotation} ${b.x} ${b.y})` : undefined}
                  className="fill-sunken stroke-ink"
                  strokeWidth={1}
                />
              ))}
            </svg>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted" data-testid="layout-hint">
        {rearrange ? `Rearranges the ${arranging} selected photos on this slide.` : "Adds empty photo frames to this slide. Select two or more photos first to rearrange them instead."}
      </p>
    </Section>
  );
}

export function InsertPanel({ images }: { images: ImageStore }) {
  const assets = useEditorStore((s) => s.project?.assets);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const videoRef = useRef<HTMLInputElement>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoErrors, setVideoErrors] = useState<string[]>([]);
  const [, setTick] = useState(0);
  useEffect(() => images.subscribe(() => setTick((t) => t + 1)), [images]);
  const photoAssets = assets?.filter((a) => !isVideoAsset(a) && !isAudioAsset(a)) ?? [];
  const videoAssets = assets?.filter(isVideoAsset) ?? [];

  const onVideos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setVideoBusy(true);
    setVideoErrors(await importVideos(Array.from(files)));
    setVideoBusy(false);
    if (videoRef.current) videoRef.current.value = "";
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setErrors(await importImages(Array.from(files)));
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div>
      <Section title="Text">
        <div className="space-y-1.5">
          <button type="button" onClick={() => insertText("heading")} className="block w-full rounded-[5px] border border-line px-3 py-2 text-left font-display text-xl leading-tight font-bold hover:border-line-strong hover:bg-sunken">
            Add a heading
          </button>
          <button type="button" onClick={() => insertText("subheading")} className="block w-full rounded-[5px] border border-line px-3 py-2 text-left text-[15px] font-semibold hover:border-line-strong hover:bg-sunken">
            Add a subheading
          </button>
          <button type="button" onClick={() => insertText("body")} className="block w-full rounded-[5px] border border-line px-3 py-2 text-left text-[13px] hover:border-line-strong hover:bg-sunken">
            Add body text
          </button>
        </div>
      </Section>

      <Section title="Shapes">
        <div className="grid grid-cols-7 gap-1 md:grid-cols-4">
          {SHAPES.map(({ kind, icon }) => (
            <button
              key={kind}
              type="button"
              title={SHAPE_LABELS[kind]}
              aria-label={`Add ${SHAPE_LABELS[kind].toLowerCase()}`}
              onClick={() => insertShape(kind)}
              className="flex aspect-square items-center justify-center rounded-[5px] border border-line hover:border-line-strong hover:bg-sunken [&_svg]:h-[18px] [&_svg]:w-[18px]"
            >
              {icon}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Images">
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_ACCEPT_ATTR}
          multiple
          hidden
          data-testid="image-input"
          onChange={(e) => void onFiles(e.target.files)}
        />
        <Button className="w-full" disabled={busy} onClick={() => fileRef.current?.click()}>
          <ImagePlus className="h-4 w-4" /> {busy ? "Importing…" : "Upload images"}
        </Button>
        <Button className="w-full" variant="ghost" onClick={() => setLibraryOpen(true)}>
          <Library className="h-4 w-4" /> From library
        </Button>
        {libraryOpen && <LibraryPicker onClose={() => setLibraryOpen(false)} />}
        <p className="text-[11px] text-muted">JPG, PNG or WebP. On desktop you can also drop files on the canvas.</p>
        {errors.length > 0 && (
          <ul role="alert" className="space-y-1 text-xs text-danger">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {photoAssets.length > 0 && (
          <div className="grid grid-cols-4 gap-1.5 pt-1 md:grid-cols-3">
            {photoAssets.map((asset) => {
              const url = images.getUrl(asset.id);
              return (
                <button
                  key={asset.id}
                  type="button"
                  title={`Add ${asset.name}`}
                  aria-label={`Add ${asset.name}`}
                  onClick={() => insertAsset(asset)}
                  className="aspect-square overflow-hidden rounded-[4px] border border-line bg-sunken hover:border-ink"
                >
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                    <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <span className="text-[10px] text-muted">{images.isMissing(asset.id) ? "Missing" : "…"}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Videos">
        <input ref={videoRef} type="file" accept={VIDEO_ACCEPT_ATTR} multiple hidden data-testid="video-input" onChange={(e) => void onVideos(e.target.files)} />
        <Button className="w-full" disabled={videoBusy} onClick={() => videoRef.current?.click()}>
          <Film className="h-4 w-4" /> {videoBusy ? "Importing…" : "Upload videos"}
        </Button>
        <p className="text-[11px] text-muted">MP4, MOV or WebM, as far as this browser can play them.</p>
        {videoErrors.length > 0 && (
          <ul role="alert" className="space-y-1 text-xs text-danger">
            {videoErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {videoAssets.length > 0 && (
          <div className="grid grid-cols-4 gap-1.5 pt-1 md:grid-cols-3">
            {videoAssets.map((asset) => {
              const url = images.getUrl(asset.id);
              return (
                <button
                  key={asset.id}
                  type="button"
                  title={`Add ${asset.name}`}
                  aria-label={`Add video ${asset.name}`}
                  onClick={() => insertAsset(asset)}
                  className="relative flex aspect-square items-center justify-center overflow-hidden rounded-[4px] border border-line bg-sunken hover:border-ink"
                >
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                    <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
                  ) : images.isMissing(asset.id) ? (
                    <span className="text-[10px] text-muted">Missing</span>
                  ) : (
                    <Film className="h-4 w-4 text-muted" />
                  )}
                  {asset.duration !== undefined && (
                    <span className="absolute right-0.5 bottom-0.5 rounded-[3px] bg-black/65 px-1 text-[9px] leading-4 text-white tabular-nums">{formatSeconds(asset.duration)}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Section>

      <LayoutsSection />

      <Section title="Stickers">
        <div className="grid grid-cols-6 gap-1 md:grid-cols-4">
          {STICKERS.map((def) => (
            <button
              key={def.id}
              type="button"
              title={def.name}
              aria-label={`Add sticker ${def.name}`}
              onClick={() => insertSticker(def)}
              className="flex aspect-square items-center justify-center rounded-[5px] border border-line p-1.5 hover:border-line-strong hover:bg-sunken"
            >
              <StickerThumb def={def} />
            </button>
          ))}
        </div>
      </Section>

      <Section title="Overlays">
        <div className="grid grid-cols-3 gap-1.5">
          {OVERLAYS.map((o) => (
            <button key={o.kind} type="button" aria-label={`Add overlay ${o.label}`} onClick={() => insertOverlay(o.kind)} className="group text-left">
              <span className="block aspect-[4/3] rounded-[4px] border border-line group-hover:border-ink" style={{ background: o.preview }} />
              <span className="mt-1 block text-[10px] text-muted">{o.label}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted">Overlays cover the whole slide and start locked. Select them in Layers.</p>
      </Section>

      <Section title="Brand">
        <BrandSection />
      </Section>

      <Section title="Background">
        <BackgroundControls />
      </Section>
    </div>
  );
}
