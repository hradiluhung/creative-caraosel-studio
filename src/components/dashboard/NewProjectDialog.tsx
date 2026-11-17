"use client";

import { useState } from "react";
import { createProject } from "@/document/factory";
import { aspectRatioLabel, CANVAS_PRESETS, DEFAULT_PRESET_ID, type Orientation } from "@/document/geometry";
import { MAX_SLIDES, type ProjectMode } from "@/document/schema";
import { saveProject } from "@/persistence/db";
import { cn } from "@/lib/cn";
import { Button, Dialog, Label, NumberField, Segmented, TextInput } from "../ui/primitives";

const GROUPS: Array<{ orientation: Orientation; label: string }> = [
  { orientation: "portrait", label: "Portrait" },
  { orientation: "landscape", label: "Landscape" },
  { orientation: "square", label: "Square and custom" },
];

/** Miniature of the canvas proportions, drawn to scale inside a 28 px box. */
function RatioIcon({ width, height, dashed = false }: { width: number; height: number; dashed?: boolean }) {
  const ratio = width / height;
  const box = 28;
  return (
    <span className="flex items-center justify-center" style={{ width: box, height: box }}>
      <span
        className={cn("block border border-ink/70", dashed && "border-dashed")}
        style={{ width: Math.max(6, ratio >= 1 ? box : box * ratio), height: Math.max(6, ratio >= 1 ? box / ratio : box) }}
      />
    </span>
  );
}

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID);
  const [custom, setCustom] = useState({ width: 1080, height: 1350 });
  const [slideCount, setSlideCount] = useState(5);
  const [mode, setMode] = useState<ProjectMode>("independent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preset = CANVAS_PRESETS.find((p) => p.id === presetId);
  const size = preset ?? custom;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const project = createProject({ name: name || "Untitled project", ...size, slideCount, mode });
      await saveProject(project, null);
      window.location.href = `/editor?id=${encodeURIComponent(project.id)}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the project.");
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="New project"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={create} disabled={busy}>
            {busy ? "Creating…" : "Create project"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="np-name">Name</Label>
          <TextInput id="np-name" value={name} placeholder="Untitled project" maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label>Canvas</Label>
          <div className="space-y-3">
            {GROUPS.map((group) => (
              <div key={group.orientation} role="group" aria-label={`${group.label} sizes`}>
                <p className="mb-1.5 text-[11px] text-muted">{group.label}</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {CANVAS_PRESETS.filter((p) => p.orientation === group.orientation).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={presetId === p.id}
                      onClick={() => setPresetId(p.id)}
                      className={cn(
                        "flex flex-col items-center rounded-md border px-1 pt-2 pb-1.5",
                        presetId === p.id ? "border-ink bg-sunken" : "border-line hover:border-line-strong",
                      )}
                    >
                      <RatioIcon width={p.width} height={p.height} />
                      <span className="mt-1.5 text-[13px] leading-none font-semibold tabular-nums">{p.ratio}</span>
                      <span className="mt-1 text-[10px] leading-tight text-muted tabular-nums">
                        {p.width} × {p.height}
                      </span>
                      <span className="sr-only">{p.usage}</span>
                    </button>
                  ))}
                  {group.orientation === "square" && (
                    <button
                      type="button"
                      aria-pressed={presetId === "custom"}
                      onClick={() => setPresetId("custom")}
                      className={cn(
                        "flex flex-col items-center rounded-md border px-1 pt-2 pb-1.5",
                        presetId === "custom" ? "border-ink bg-sunken" : "border-line hover:border-line-strong",
                      )}
                    >
                      <RatioIcon width={custom.width} height={custom.height} dashed />
                      <span className="mt-1.5 text-[13px] leading-none font-semibold">Custom</span>
                      <span className="mt-1 text-[10px] leading-tight text-muted">Any size</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {preset ? (
            <p className="text-xs text-muted">
              {preset.ratio} · {preset.usage} · {preset.width} × {preset.height} px
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <NumberField label="Width" prefix="W" min={16} max={8192} value={custom.width} onChange={(width) => setCustom({ ...custom, width: Math.round(width) })} />
                <NumberField label="Height" prefix="H" min={16} max={8192} value={custom.height} onChange={(height) => setCustom({ ...custom, height: Math.round(height) })} />
              </div>
              <p className="text-xs text-muted">
                Ratio {aspectRatioLabel(custom.width, custom.height)} · {custom.width} × {custom.height} px
              </p>
            </>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Carousel type</Label>
          <Segmented
            label="Carousel type"
            value={mode}
            onChange={setMode}
            options={[
              { value: "independent", label: "Independent slides" },
              { value: "seamless", label: "Seamless panorama" },
            ]}
          />
          <p className="text-xs text-muted">
            {mode === "seamless"
              ? `One continuous ${size.width * slideCount} × ${size.height} px canvas, sliced into ${slideCount} slides on export.`
              : "Every slide has its own background and layers."}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Slides</Label>
          <div className="w-24">
            <NumberField label="Number of slides" min={1} max={MAX_SLIDES} value={slideCount} onChange={(n) => setSlideCount(Math.round(n))} />
          </div>
          <p className="text-xs text-muted">Instagram allows up to {MAX_SLIDES} slides per carousel.</p>
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}
