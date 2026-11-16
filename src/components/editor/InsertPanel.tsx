"use client";

import { ArrowRight, Circle, Hexagon, ImagePlus, Minus, Square, Star, Triangle } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SHAPE_LABELS } from "@/document/factory";
import { getSurface } from "@/document/geometry";
import { setBackground } from "@/document/operations";
import type { ShapeKind } from "@/document/schema";
import { IMAGE_ACCEPT_ATTR } from "@/persistence/assets";
import type { ImageStore } from "@/render/resources";
import { useEditorStore } from "@/store/editorStore";
import { Button, ColorField, Label } from "../ui/primitives";
import { importImages, insertAsset, insertShape, insertText } from "./actions";

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

export function BackgroundControls() {
  const project = useEditorStore((s) => s.project);
  const activeSurfaceId = useEditorStore((s) => s.activeSurfaceId);
  const commit = useEditorStore((s) => s.commit);
  const surface = project && getSurface(project, activeSurfaceId);
  if (!surface) return null;
  const bg = surface.background;
  return (
    <div className="space-y-2">
      <ColorField
        label="Background color"
        value={bg.type === "solid" ? bg.color : "#ffffff"}
        onChange={(color) => commit((p) => setBackground(p, activeSurfaceId, { type: "solid", color }), { coalesce: `bg:${activeSurfaceId}` })}
      />
      <label className="flex items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={bg.type === "transparent"}
          onChange={(e) =>
            commit((p) => setBackground(p, activeSurfaceId, e.target.checked ? { type: "transparent" } : { type: "solid", color: "#ffffff" }))
          }
        />
        Transparent (PNG export only, JPG fills white)
      </label>
    </div>
  );
}

export function InsertPanel({ images }: { images: ImageStore }) {
  const assets = useEditorStore((s) => s.project?.assets);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [, setTick] = useState(0);
  useEffect(() => images.subscribe(() => setTick((t) => t + 1)), [images]);

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
        <p className="text-[11px] text-muted">JPG, PNG or WebP. On desktop you can also drop files on the canvas.</p>
        {errors.length > 0 && (
          <ul role="alert" className="space-y-1 text-xs text-danger">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {assets && assets.length > 0 && (
          <div className="grid grid-cols-4 gap-1.5 pt-1 md:grid-cols-3">
            {assets.map((asset) => {
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

      <Section title="Background">
        <BackgroundControls />
      </Section>
    </div>
  );
}
