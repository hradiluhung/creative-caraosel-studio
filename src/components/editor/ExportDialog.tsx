"use client";

import { useEffect, useRef, useState } from "react";
import {
  downloadBlob,
  ExportCancelled,
  exportSlides,
  maxPixelRatio,
  packageZip,
  type ExportedFile,
} from "@/export/exporter";
import { FORMAT_INFO, zipFileName, type ImageFormat } from "@/export/naming";
import type { ImageStore } from "@/render/resources";
import { useEditorStore } from "@/store/editorStore";
import { Button, Dialog, Label, Segmented, Slider } from "../ui/primitives";

type Phase =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number }
  | { kind: "done"; files: ExportedFile[]; zip: Blob | null }
  | { kind: "error"; message: string };

export function ExportDialog({ images, onClose }: { images: ImageStore; onClose: () => void }) {
  const project = useEditorStore((s) => s.project);
  const focusIndex = useEditorStore((s) => s.focusSlideIndex);
  const [format, setFormat] = useState<ImageFormat>("jpeg");
  const [quality, setQuality] = useState(0.92);
  const [scale, setScale] = useState<"1" | "2">("1");
  const [range, setRange] = useState<"all" | "current">("all");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  if (!project) return null;

  const canDouble = maxPixelRatio(project.width, project.height) >= 2;
  const pixelRatio = Number(scale);
  const indices = range === "all" ? project.slides.map((_, i) => i) : [focusIndex];

  const deliver = (files: ExportedFile[], zip: Blob | null) => {
    if (zip) downloadBlob(zip, zipFileName(project.name));
    else downloadBlob(files[0].blob, files[0].name);
  };

  const run = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: "running", done: 0, total: indices.length });
    try {
      const files = await exportSlides(project, images, {
        format,
        quality,
        scale: pixelRatio,
        slideIndices: indices,
        signal: controller.signal,
        onProgress: (done, total) => setPhase({ kind: "running", done, total }),
      });
      const zip = files.length > 1 ? await packageZip(files, controller.signal) : null;
      setPhase({ kind: "done", files, zip });
      deliver(files, zip);
    } catch (e) {
      if (e instanceof ExportCancelled) setPhase({ kind: "idle" });
      else setPhase({ kind: "error", message: e instanceof Error ? e.message : "Export failed." });
    }
  };

  /** iOS: the share sheet is the way to put images straight into Photos. */
  const shareable = (files: ExportedFile[]) => {
    try {
      const list = files.map((f) => new File([f.blob], f.name, { type: f.blob.type }));
      return typeof navigator.canShare === "function" && navigator.canShare({ files: list }) ? list : null;
    } catch {
      return null;
    }
  };

  const running = phase.kind === "running";
  const info = FORMAT_INFO[format];

  return (
    <Dialog
      title="Export"
      onClose={() => {
        abortRef.current?.abort();
        onClose();
      }}
      footer={
        running ? (
          <Button onClick={() => abortRef.current?.abort()}>Cancel export</Button>
        ) : phase.kind === "done" ? (
          <>
            {shareable(phase.files) && (
              <Button
                onClick={() => {
                  const files = shareable(phase.files);
                  if (files) void navigator.share({ files }).catch(() => undefined);
                }}
              >
                Share / Save to Photos
              </Button>
            )}
            <Button onClick={() => deliver(phase.files, phase.zip)}>Download again</Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" onClick={run}>
              Export {indices.length} {indices.length === 1 ? "slide" : "slides"}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <fieldset disabled={running || phase.kind === "done"} className="space-y-4 disabled:opacity-50">
          <div className="space-y-1.5">
            <Label>Format</Label>
            <Segmented
              label="Format"
              value={format}
              onChange={setFormat}
              options={[
                { value: "jpeg", label: "JPG" },
                { value: "png", label: "PNG" },
              ]}
            />
          </div>
          {format === "jpeg" && (
            <div className="space-y-1">
              <Label>Quality</Label>
              <Slider label="JPG quality" min={0.5} max={1} step={0.01} value={quality} display={`${Math.round(quality * 100)}%`} onChange={setQuality} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Resolution</Label>
            <Segmented
              label="Resolution"
              value={canDouble ? scale : "1"}
              onChange={setScale}
              options={[
                { value: "1", label: `1× · ${project.width} × ${project.height}` },
                ...(canDouble ? [{ value: "2" as const, label: `2× · ${project.width * 2} × ${project.height * 2}` }] : []),
              ]}
            />
            <p className="text-xs text-muted">1× is the Instagram-ready size.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Slides</Label>
            <Segmented
              label="Slides to export"
              value={range}
              onChange={setRange}
              options={[
                { value: "all", label: `All ${project.slides.length}` },
                { value: "current", label: `Current (slide ${focusIndex + 1})` },
              ]}
            />
            <p className="text-xs text-muted">
              {indices.length > 1
                ? `One ZIP with ${indices.length} numbered ${info.label} files, in slide order.`
                : `One ${info.label} file.`}
              {project.mode === "seamless" && " The panorama is sliced exactly at the slide boundaries."}
            </p>
          </div>
        </fieldset>

        {running && (
          <div role="status" aria-live="polite" className="space-y-1.5">
            <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
              <div className="h-full bg-ink transition-[width]" style={{ width: `${(phase.done / phase.total) * 100}%` }} />
            </div>
            <p className="text-xs text-muted">
              Rendering slide {Math.min(phase.done + 1, phase.total)} of {phase.total}…
            </p>
          </div>
        )}
        {phase.kind === "done" && (
          <p role="status" data-testid="export-done" className="rounded-md border border-line bg-sunken px-3 py-2 text-xs">
            Exported {phase.files.length} {phase.files.length === 1 ? "file" : "files"} at {phase.files[0].width} × {phase.files[0].height} px. The
            download has started.
          </p>
        )}
        {phase.kind === "error" && (
          <p role="alert" className="rounded-md border border-danger/40 px-3 py-2 text-xs text-danger">
            {phase.message}
          </p>
        )}
      </div>
    </Dialog>
  );
}
