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
import { getExportFrames } from "@/document/geometry";
import { countPlaceholders } from "@/document/operations";
import { formatSeconds, frameDuration } from "@/document/timing";
import { detectVideoSupport, videoBitrate, videoOutputSize, type AudioCodec, type VideoQuality, type VideoResolution, type VideoSupport } from "@/export/videoSupport";
import { FORMAT_INFO, zipFileName, type ImageFormat } from "@/export/naming";
import type { ImageStore } from "@/render/resources";
import { useEditorStore } from "@/store/editorStore";
import { Button, Dialog, Label, Segmented, Slider } from "../ui/primitives";

type Phase =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number; detail?: string }
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
  const [videoMode, setVideoMode] = useState<"video" | "still">("video");
  const [resolution, setResolution] = useState<"720" | "1080">("1080");
  const [videoQuality, setVideoQuality] = useState<VideoQuality>("standard");
  const [soundChoice, setSound] = useState<AudioCodec | "none" | null>(null);
  const [support, setSupport] = useState<VideoSupport | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // What this device can really produce, for the chosen video size.
  const sizeKey = project ? `${project.width}x${project.height}@${resolution}` : "";
  useEffect(() => {
    if (!sizeKey) return;
    let live = true;
    const [dims, res] = sizeKey.split("@");
    const [w, h] = dims.split("x").map(Number);
    void detectVideoSupport(videoOutputSize(w, h, Number(res) as VideoResolution)).then((s) => live && setSupport(s));
    return () => {
      live = false;
    };
  }, [sizeKey]);

  if (!project) return null;

  const placeholders = countPlaceholders(project);
  const frames = getExportFrames(project);
  const canDouble = maxPixelRatio(project.width, project.height) >= 2;
  const pixelRatio = Number(scale);
  const indices = range === "all" ? project.slides.map((_, i) => i) : [focusIndex];
  const videoSlides = indices.filter((i) => frames[i] && frameDuration(project, frames[i]) > 0);
  const videoSeconds = videoSlides.reduce((sum, i) => sum + frameDuration(project, frames[i]), 0);
  const asVideo = videoSlides.length > 0 && videoMode === "video";
  const videoSize = videoOutputSize(project.width, project.height, Number(resolution) as VideoResolution);
  const sound: AudioCodec | null = soundChoice === "none" ? null : (soundChoice ?? support?.audio[0] ?? null);
  const cannotExportVideo = asVideo && support !== null && !support.mp4 && !support.recorder;
  const stillSlides = indices.length - (asVideo ? videoSlides.length : 0);

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
        video: { mode: videoMode, resolution: Number(resolution) as VideoResolution, quality: videoQuality, audio: sound },
        signal: controller.signal,
        onProgress: (done, total, detail) => setPhase({ kind: "running", done, total, detail }),
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
            <Button variant="primary" onClick={run} disabled={cannotExportVideo || (asVideo && support === null)}>
              Export {indices.length} {indices.length === 1 ? "slide" : "slides"}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <fieldset disabled={running || phase.kind === "done"} className="space-y-4 disabled:opacity-50">
          {videoSlides.length > 0 && (
            <div className="space-y-2 rounded-md border border-line p-3" data-testid="video-export">
              <div className="space-y-1.5">
                <Label>
                  {videoSlides.length === 1 ? "1 slide has video" : `${videoSlides.length} slides have video`} ({formatSeconds(videoSeconds)})
                </Label>
                <Segmented
                  label="Video slides"
                  value={videoMode}
                  onChange={setVideoMode}
                  options={[
                    { value: "video", label: "Video file" },
                    { value: "still", label: "Still image" },
                  ]}
                />
              </div>
              {videoMode === "video" ? (
                <>
                  <div className="space-y-1.5">
                    <Label>Video size</Label>
                    <Segmented
                      label="Video size"
                      value={resolution}
                      onChange={setResolution}
                      options={[
                        { value: "720", label: "720p" },
                        { value: "1080", label: "1080p" },
                      ]}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Video quality</Label>
                    <Segmented
                      label="Video quality"
                      value={videoQuality}
                      onChange={setVideoQuality}
                      options={[
                        { value: "small", label: "Small" },
                        { value: "standard", label: "Standard" },
                        { value: "high", label: "High" },
                      ]}
                    />
                    <p className="text-xs text-muted" data-testid="video-summary">
                      {videoSize.width} × {videoSize.height}, 30 fps, about {(videoBitrate(videoSize, videoQuality) / 1e6).toFixed(1)} Mbit/s. One file per slide.
                    </p>
                  </div>
                  {support?.mp4 && support.audio.length > 0 && (
                    <div className="space-y-1.5">
                      <Label>Sound</Label>
                      <Segmented
                        label="Sound"
                        value={sound ?? "none"}
                        onChange={setSound}
                        options={[
                          ...support.audio.map((codec) => ({ value: codec, label: codec === "aac" ? "AAC" : "Opus" })),
                          { value: "none" as const, label: "No sound" },
                        ]}
                      />
                    </div>
                  )}
                  <p role="note" data-testid="video-note" className="rounded-md bg-sunken px-3 py-2 text-xs">
                    {support === null
                      ? "Checking what this device can export…"
                      : support.mp4
                        ? support.audio.length === 0
                          ? "MP4 (H.264). This browser cannot encode sound, so the video will be silent."
                          : sound === "opus"
                            ? "MP4 (H.264) with Opus sound. Opus plays in Chrome and Firefox, but Instagram and the iPhone Photos app expect AAC, which this browser cannot encode."
                            : sound === "aac"
                              ? "MP4 (H.264) with AAC sound. Clips that are sped up or slowed down change pitch in the export."
                              : "MP4 (H.264) without sound."
                        : support.recorder
                          ? `This browser cannot encode MP4 directly. Each video slide is recorded in real time as ${support.recorder.ext === "mp4" ? "MP4" : "WebM"}, without sound, and takes as long as it plays. Keep this tab in front while it records.`
                          : "This browser can neither encode nor record video. Choose Still image to export the poster frames."}
                  </p>
                </>
              ) : (
                <p role="note" data-testid="video-warning" className="rounded-md bg-sunken px-3 py-2 text-xs">
                  Video layers are exported as a still image of their poster frame.
                </p>
              )}
            </div>
          )}
          {stillSlides > 0 && videoSlides.length > 0 && asVideo && <p className="text-xs text-muted">The settings below apply to the {stillSlides} still {stillSlides === 1 ? "slide" : "slides"}.</p>}
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
                ? asVideo
                  ? `One ZIP with ${indices.length} numbered files in slide order: ${stillSlides} ${info.label} and ${videoSlides.length} video.`
                  : `One ZIP with ${indices.length} numbered ${info.label} files, in slide order.`
                : asVideo
                  ? "One video file."
                  : `One ${info.label} file.`}
              {project.mode === "seamless" && " The panorama is sliced exactly at the slide boundaries."}
            </p>
          </div>
        </fieldset>

        {placeholders > 0 && phase.kind === "idle" && (
          <p role="note" data-testid="placeholder-warning" className="rounded-md border border-line bg-sunken px-3 py-2 text-xs">
            {placeholders} empty photo {placeholders === 1 ? "frame is" : "frames are"} still waiting for a photo. Empty frames are left out of the export.
          </p>
        )}
        {running && (
          <div role="status" aria-live="polite" className="space-y-1.5">
            <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
              <div className="h-full bg-ink transition-[width]" style={{ width: `${(phase.done / phase.total) * 100}%` }} />
            </div>
            <p className="text-xs text-muted" data-testid="export-progress">
              {phase.detail ?? `Rendering slide ${Math.min(Math.floor(phase.done) + 1, phase.total)} of ${phase.total}`}…
            </p>
          </div>
        )}
        {phase.kind === "done" && (
          <p role="status" data-testid="export-done" className="rounded-md border border-line bg-sunken px-3 py-2 text-xs">
            Exported {phase.files.length} {phase.files.length === 1 ? "file" : "files"}
            {phase.files.every((f) => f.kind === "image") ? ` at ${phase.files[0].width} × ${phase.files[0].height} px` : `: ${phase.files.map((f) => f.name.split(".").pop()).join(", ")}`}. The download
            has started.
            {phase.files.some((f) => f.kind === "video" && !f.hasAudio) && " The video has no sound."}
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
