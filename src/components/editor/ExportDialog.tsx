"use client";

import { CircleCheck, Film } from "lucide-react";
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
import { useObjectUrl } from "@/lib/useObjectUrl";
import { formatBytes } from "@/persistence/libraryModel";
import { Button, Dialog, Label, Segmented, Slider } from "../ui/primitives";

type Phase =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number; detail?: string }
  | { kind: "done"; files: ExportedFile[]; zip: Blob | null; viaShare: boolean }
  | { kind: "error"; message: string };

/** Files the share sheet accepts, or null when this browser cannot share them. */
function shareable(files: ExportedFile[]): File[] | null {
  try {
    const list = files.map((f) => new File([f.blob], f.name, { type: f.blob.type }));
    return typeof navigator.canShare === "function" && navigator.canShare({ files: list }) ? list : null;
  } catch {
    return null;
  }
}

const isTouchScreen = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;

/** Small picture of one exported file: the image itself, or a film tile for a video. */
function ExportedThumb({ file }: { file: ExportedFile }) {
  const url = useObjectUrl(file.kind === "image" ? file.blob : null);
  return (
    <span className="flex h-20 shrink-0 items-center justify-center overflow-hidden rounded-[4px] border border-line bg-sunken" style={{ aspectRatio: `${file.width} / ${file.height}` }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- local blob preview
        <img src={url} alt={file.name} className="h-full w-full object-cover" />
      ) : (
        <Film aria-label={file.name} className="h-5 w-5 text-muted" />
      )}
    </span>
  );
}

/** What the dialog shows once the export is done: the result, how to save it, and where to go next. */
function ExportSuccess({
  files,
  viaShare,
  hasZip,
  canShare,
  onShare,
  onDownload,
  onAgain,
}: {
  files: ExportedFile[];
  viaShare: boolean;
  hasZip: boolean;
  canShare: boolean;
  onShare: () => void;
  onDownload: () => void;
  onAgain: () => void;
}) {
  const bytes = files.reduce((n, f) => n + f.blob.size, 0);
  const allImages = files.every((f) => f.kind === "image");
  return (
    <div className="space-y-4" data-testid="export-success">
      <div className="flex items-start gap-3">
        <CircleCheck className="mt-0.5 h-6 w-6 shrink-0 text-ink" aria-hidden />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">Export complete</p>
          <p role="status" data-testid="export-done" className="text-xs text-muted">
            Exported {files.length} {files.length === 1 ? "file" : "files"}
            {allImages ? ` at ${files[0].width} × ${files[0].height} px` : `: ${files.map((f) => f.name.split(".").pop()).join(", ")}`}, {formatBytes(bytes)} in total.
            {viaShare ? " Save them to Photos or to Files below." : " The download has started."}
            {files.some((f) => f.kind === "video" && !f.hasAudio) && " The video has no sound."}
          </p>
        </div>
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Exported files">
        {files.map((f) => (
          <ExportedThumb key={f.name} file={f} />
        ))}
      </div>

      {viaShare ? (
        <div className="space-y-1.5">
          <Button variant="primary" className="w-full" data-testid="share-export" onClick={onShare}>
            Save to Photos or Files
          </Button>
          <Button variant="ghost" className="w-full" onClick={onDownload}>
            {hasZip ? "Download ZIP" : "Download"}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onDownload}>
            Download again
          </Button>
          {canShare && (
            <Button size="sm" onClick={onShare}>
              Share
            </Button>
          )}
        </div>
      )}

      <button type="button" onClick={onAgain} className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
        Export again with other settings
      </button>
    </div>
  );
}

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
      // Phones and tablets that can share files (iPhone, iPad, Android): offer the share sheet,
      // which saves straight to Photos or Files. It needs a fresh tap, so it is a button rather
      // than opening by itself. Everywhere else the download starts at once, as before.
      const viaShare = isTouchScreen() && shareable(files) !== null;
      setPhase({ kind: "done", files, zip, viaShare });
      if (!viaShare) deliver(files, zip);
    } catch (e) {
      if (e instanceof ExportCancelled) setPhase({ kind: "idle" });
      else setPhase({ kind: "error", message: e instanceof Error ? e.message : "Export failed." });
    }
  };


  // Touch screens get the files one by one through the share sheet (with a ZIP as the option).
  const packaging = isTouchScreen() ? "" : "One ZIP with";
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
            <Button variant="ghost" className="mr-auto" onClick={() => (window.location.href = "/")}>
              Back to projects
            </Button>
            <Button variant={phase.viaShare ? "outline" : "primary"} onClick={onClose}>
              Continue editing
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
        <fieldset disabled={running} hidden={phase.kind === "done"} className="space-y-4 disabled:opacity-50">
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
                          ...support.audio.map((codec) => ({ value: codec, label: "With sound" })),
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
                          ? "MP4 (H.264). Sound cannot be mixed in this browser, so the video will be silent."
                          : sound
                            ? "MP4 (H.264) with AAC sound. Clips that are sped up or slowed down change pitch."
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
                  ? `${packaging ? `${packaging} ` : ""}${indices.length} numbered files in slide order: ${stillSlides} ${info.label} and ${videoSlides.length} video.`
                  : `${packaging ? `${packaging} ` : ""}${indices.length} numbered ${info.label} files, in slide order.`
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
          <ExportSuccess
            files={phase.files}
            viaShare={phase.viaShare}
            hasZip={phase.zip !== null}
            onShare={() => {
              const files = shareable(phase.files);
              // Cancelling the share sheet rejects too; that is not an error.
              if (files) void navigator.share({ files }).catch(() => undefined);
            }}
            canShare={shareable(phase.files) !== null}
            onDownload={() => deliver(phase.files, phase.zip)}
            onAgain={() => setPhase({ kind: "idle" })}
          />
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
