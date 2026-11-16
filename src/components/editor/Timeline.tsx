"use client";

import { ChevronDown, ChevronUp, Music, Scissors, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { getSurface, PANORAMA_ID } from "@/document/geometry";
import type { AudioTrack, DesignElement, VideoElement } from "@/document/schema";
import { clipDuration, clipEnd, clipReach, formatSeconds, MAX_VIDEO_SLIDE_SECONDS, moveClip, splitClip, surfaceDuration, trackEnd, trimClipEnd, trimClipStart, videoElements } from "@/document/timing";
import { AUDIO_ACCEPT_ATTR } from "@/persistence/audio";
import { getAssetPeaks } from "@/persistence/db";
import { proxyState, subscribeProxies } from "@/persistence/proxy";
import { cn } from "@/lib/cn";
import { useIsMobile } from "@/lib/useMediaQuery";
import { useEditorStore } from "@/store/editorStore";
import { NumberField, Slider } from "@/components/ui/primitives";
import { importMusic, setActiveSlideDuration, splitClipAt, updateMusic } from "./actions";
import { canvasApi } from "./canvasApi";
import { PlaybackBar } from "./PlaybackBar";

const ZOOM_STEP = 1.6;
const MAX_PX_PER_SECOND = 600;
/** Room left and right of the tracks so the first and last handle can be grabbed. */
const PAD = 12;
const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60];
/** A press that moves less than this is a tap (select), not a drag. */
const DRAG_THRESHOLD_PX = 3;

type Drag = (event: ReactPointerEvent<HTMLElement>, onMove: (deltaSeconds: number) => void, onTap?: () => void) => void;

/**
 * Bottom timeline of the active slide, shown when it contains video: transport, playhead,
 * one bar per clip with trim handles, split at the playhead, zoom, and the other layers as
 * full-length bars. Every edit is an ordinary document operation (undoable).
 */
export function Timeline() {
  const isMobile = useIsMobile();
  const project = useEditorStore((s) => s.project);
  const activeSurfaceId = useEditorStore((s) => s.activeSurfaceId);
  const selection = useEditorStore((s) => s.selection);
  const playback = useEditorStore((s) => s.playback);
  const playhead = useEditorStore((s) => s.playhead);
  const notice = useEditorStore((s) => s.playbackNotice);
  const select = useEditorStore((s) => s.select);
  const updateElement = useEditorStore((s) => s.updateElement);
  const [openChoice, setOpen] = useState<boolean | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewWidth, setViewWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [, setProxyTick] = useState(0);
  useEffect(() => subscribeProxies(() => setProxyTick((t) => t + 1)), []);
  const musicInput = useRef<HTMLInputElement>(null);
  const [musicBusy, setMusicBusy] = useState(false);
  const [musicError, setMusicError] = useState<string | null>(null);

  const surface = project && getSurface(project, activeSurfaceId);
  const clips = surface ? videoElements(surface.elements) : [];
  const hasVideo = clips.some((el) => el.visible);
  // On a phone the canvas needs the room: the tracks start folded away.
  const open = openChoice ?? !isMobile;

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const measure = () => setViewWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasVideo, open]);

  // The video exporter is loaded on demand. Fetching it as soon as a slide has video lets the
  // service worker cache it, so exporting also works offline later.
  useEffect(() => {
    if (hasVideo) void import("@/export/video").catch(() => undefined);
  }, [hasVideo]);

  if (!project || !surface || !hasVideo) return null;

  const duration = surfaceDuration(surface.elements, surface.duration);
  const autoDuration = surfaceDuration(surface.elements);
  const assetDuration = (el: VideoElement) => project.assets.find((a) => a.id === el.assetId)?.duration ?? el.trimEnd;
  // The ruler covers everything a clip could be stretched back to, not only what is left after
  // trimming. Otherwise a trimmed clip would fill the width again and its handle would have no
  // room to be dragged back out. It never shows more than a video slide may last.
  const span = Math.min(
    MAX_VIDEO_SLIDE_SECONDS,
    Math.max(duration, clips.reduce((max, el) => Math.max(max, clipEnd(el), clipReach(el, assetDuration(el)).to), 0), 0.5),
  );
  const overLimit = clips.some((el) => el.visible && clipEnd(el) > MAX_VIDEO_SLIDE_SECONDS + 1e-6);
  const fit = Math.max(1, viewWidth - PAD * 2) / span;
  // Short clips already fill the width at more than the usual limit: always allow a few zoom steps.
  const maxPxPerSecond = Math.max(MAX_PX_PER_SECOND, fit * 4);
  const pxPerSecond = Math.min(maxPxPerSecond, fit * zoom);
  const width = span * pxPerSecond;
  const time = playback === "stopped" ? 0 : playhead;
  const tick = TICK_STEPS.find((s) => s * pxPerSecond >= 56) ?? 60;
  const ticks = Array.from({ length: Math.floor(span / tick + 1e-6) + 1 }, (_, i) => i * tick);

  // Split the selected clip when the playhead is inside it, otherwise the topmost clip under the playhead.
  const selectedClip = clips.find((el) => selection.length === 1 && el.id === selection[0]);
  const splitTarget = [selectedClip, ...[...clips].reverse()].find((el) => el && !el.locked && splitClip(el, time));

  const drag: Drag = (event, onMove, onTap) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    const startX = event.clientX;
    let moved = false;
    target.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      if (!moved && Math.abs(e.clientX - startX) < DRAG_THRESHOLD_PX) return;
      moved = true;
      onMove((e.clientX - startX) / pxPerSecond);
    };
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      if (!moved) onTap?.();
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };

  const scrub = (event: ReactPointerEvent<HTMLElement>) => {
    const left = event.currentTarget.getBoundingClientRect().left;
    const at = (clientX: number) => canvasApi.seek((clientX - left) / pxPerSecond);
    at(event.clientX);
    drag(event, (delta) => at(event.clientX + delta * pxPerSecond));
  };

  // Progress of the preview proxy of a heavy clip on this slide, if one is being made right now.
  const working = clips.map((el) => proxyState(el.assetId)).find((state) => state?.status === "working");
  const preparing = working?.status === "working" ? working.progress : null;
  const others = surface.elements.filter((el) => el.type !== "video" && el.visible);
  const music = surface.audio;
  const onMusicFile = async (file: File | undefined) => {
    if (!file) return;
    setMusicBusy(true);
    setMusicError(await importMusic(file));
    setMusicBusy(false);
    if (musicInput.current) musicInput.current.value = "";
  };
  const iconButton = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-sunken disabled:opacity-30 [&_svg]:h-4 [&_svg]:w-4";

  return (
    <section aria-label="Timeline" data-testid="timeline" className="shrink-0 border-t border-line bg-panel">
      {notice && (
        <p role="status" className="border-b border-line px-3 py-1.5 text-[11px]">
          {notice}
        </p>
      )}
      {preparing !== null && (
        <p role="status" data-testid="proxy-status" className="border-b border-line px-3 py-1.5 text-[11px] text-muted">
          Preparing a lighter copy of this video for smooth playback: {Math.round(preparing * 100)}%. You can keep working; exports always use the original.
        </p>
      )}
      <div className="flex items-center gap-1 px-2 py-1">
        <PlaybackBar duration={duration} />
        <button
          type="button"
          aria-label="Split clip at playhead"
          title="Split clip at playhead"
          className={iconButton}
          disabled={!splitTarget}
          onClick={() => splitTarget && splitClipAt(splitTarget.id, time)}
        >
          <Scissors />
        </button>
        <div className="flex-1" />
        {open && (
          <>
            <button type="button" aria-label="Zoom timeline out" className={iconButton} disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z / ZOOM_STEP))}>
              <ZoomOut />
            </button>
            <button type="button" aria-label="Zoom timeline in" className={iconButton} disabled={pxPerSecond >= maxPxPerSecond} onClick={() => setZoom((z) => z * ZOOM_STEP)}>
              <ZoomIn />
            </button>
          </>
        )}
        <button type="button" aria-label={open ? "Hide timeline tracks" : "Show timeline tracks"} aria-expanded={open} className={iconButton} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown /> : <ChevronUp />}
        </button>
      </div>

      {open && (
        <>
          <div ref={scrollRef} className="thin-scroll max-h-32 overflow-auto md:max-h-44" data-testid="timeline-scroll">
            <div className="relative select-none" style={{ width: width + PAD * 2, paddingLeft: PAD, paddingRight: PAD }}>
              {/* Ruler: press or drag to move the playhead */}
              <div
                role="slider"
                tabIndex={0}
                aria-label="Playhead"
                aria-valuemin={0}
                aria-valuemax={Number(span.toFixed(2))}
                aria-valuenow={Number(time.toFixed(2))}
                aria-valuetext={formatSeconds(time)}
                data-testid="timeline-ruler"
                className="relative h-6 cursor-ew-resize touch-none border-b border-line"
                style={{ width }}
                onPointerDown={scrub}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    e.preventDefault();
                    canvasApi.seek(time + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 1 / 30));
                  }
                }}
              >
                {ticks.map((t) => (
                  <span key={t} className="pointer-events-none absolute top-0 h-full border-l border-line pl-1 text-[9px] leading-6 text-muted tabular-nums" style={{ left: t * pxPerSecond }}>
                    {tick < 1 ? t.toFixed(1) : t}s
                  </span>
                ))}
              </div>

              <ol aria-label="Video clips" className="space-y-1 py-1">
                {[...clips].reverse().map((el) => (
                  <ClipRow
                    key={el.id}
                    el={el}
                    width={width}
                    pxPerSecond={pxPerSecond}
                    span={span}
                    selected={selection.includes(el.id)}
                    drag={drag}
                    onSelect={() => select([el.id])}
                    onPatch={(patch, key, showAt) => {
                      updateElement(el.id, patch as Partial<DesignElement>, key);
                      canvasApi.seek(showAt);
                    }}
                    sourceDuration={assetDuration(el)}
                  />
                ))}
              </ol>

              {music && (
                <MusicRow
                  track={music}
                  name={project.assets.find((a) => a.id === music.assetId)?.name ?? "Music"}
                  sourceDuration={project.assets.find((a) => a.id === music.assetId)?.duration ?? music.trimEnd}
                  slideDuration={duration}
                  width={width}
                  pxPerSecond={pxPerSecond}
                  drag={drag}
                />
              )}

              {others.length > 0 && (
                <ol aria-label="Other layers" className="space-y-0.5 pb-1.5">
                  {[...others].reverse().map((el) => (
                    <li key={el.id} style={{ width }}>
                      <button
                        type="button"
                        title={`${el.name} is visible for the whole slide`}
                        data-testid="overlay-bar"
                        onClick={() => select([el.id])}
                        className={cn(
                          "block h-4 w-full truncate rounded-[3px] border px-1.5 text-left text-[9px] leading-[14px]",
                          selection.includes(el.id) ? "border-ink bg-ink/10" : "border-line bg-sunken text-muted",
                        )}
                      >
                        {el.name}
                      </button>
                    </li>
                  ))}
                </ol>
              )}

              {/* Playhead */}
              <div
                aria-hidden
                data-testid="timeline-playhead"
                className={cn("pointer-events-none absolute top-0 bottom-0 w-px bg-accent", playback === "playing" && "transition-transform duration-100 ease-linear")}
                style={{ left: PAD, transform: `translateX(${time * pxPerSecond}px)` }}
              >
                <span className="absolute -top-0 -left-[4px] h-2 w-[9px] rounded-b-sm bg-accent" />
              </div>
              {/* End of the slide, when a fixed length cuts clips off */}
              {duration < span - 1e-6 && (
                <div aria-hidden className="pointer-events-none absolute top-0 bottom-0 right-0 border-l border-dashed border-danger bg-danger/5" style={{ left: PAD + duration * pxPerSecond }} />
              )}
            </div>
          </div>

          {activeSurfaceId !== PANORAMA_ID && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3 py-1.5" data-testid="music-controls">
              <input ref={musicInput} type="file" accept={AUDIO_ACCEPT_ATTR} hidden data-testid="music-input" onChange={(e) => void onMusicFile(e.target.files?.[0])} />
              <button
                type="button"
                disabled={musicBusy}
                onClick={() => musicInput.current?.click()}
                className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line px-2 text-xs hover:bg-sunken disabled:opacity-40"
              >
                <Music className="h-3.5 w-3.5" /> {musicBusy ? "Importing…" : music ? "Replace music" : "Add music"}
              </button>
              {music && (
                <>
                  <div className="flex w-48 items-center gap-1.5">
                    <span className="text-[11px] text-muted">Vol</span>
                    <Slider label="Music volume" min={0} max={1} step={0.01} value={music.volume} display={`${Math.round(music.volume * 100)}%`} onChange={(volume) => updateMusic({ volume }, "volume")} />
                  </div>
                  <div className="w-20">
                    <NumberField label="Fade in" prefix="↗" min={0} max={10} step={0.5} decimals={1} value={music.fadeIn} onChange={(fadeIn) => updateMusic({ fadeIn })} />
                  </div>
                  <div className="w-20">
                    <NumberField label="Fade out" prefix="↘" min={0} max={10} step={0.5} decimals={1} value={music.fadeOut} onChange={(fadeOut) => updateMusic({ fadeOut })} />
                  </div>
                  <label className="flex shrink-0 items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={music.loop} onChange={(e) => updateMusic({ loop: e.target.checked })} />
                    Loop music
                  </label>
                  <button type="button" aria-label="Remove music" title="Remove music" className={iconButton} onClick={() => updateMusic(null)}>
                    <Trash2 />
                  </button>
                </>
              )}
              {musicError && (
                <span role="alert" className="text-xs text-danger">
                  {musicError}
                </span>
              )}
            </div>
          )}

          {activeSurfaceId !== PANORAMA_ID && (
            <div className="flex items-center gap-3 border-t border-line px-3 py-1.5">
              <label className="flex shrink-0 items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={surface.duration !== undefined}
                  onChange={(e) => setActiveSlideDuration(e.target.checked ? Number(Math.max(autoDuration, 0.1).toFixed(2)) : undefined)}
                />
                Fixed slide length
              </label>
              <div className="w-28">
                <NumberField
                  label="Slide length"
                  prefix="s"
                  min={0.1}
                  max={MAX_VIDEO_SLIDE_SECONDS}
                  step={0.5}
                  decimals={2}
                  value={Number(duration.toFixed(2))}
                  disabled={surface.duration === undefined}
                  onChange={(v) => setActiveSlideDuration(v)}
                />
              </div>
              <span className="truncate text-[11px] text-muted" data-testid="slide-length-hint">
                {overLimit
                  ? "A video slide can be 60 s at most (Instagram's limit): what runs longer is cut off."
                  : surface.duration === undefined
                    ? "Follows the last clip, up to 60 s."
                    : "Clips that run longer are cut off; a looping clip fills the rest."}
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ClipRow({
  el,
  width,
  pxPerSecond,
  span,
  selected,
  sourceDuration,
  drag,
  onSelect,
  onPatch,
}: {
  el: VideoElement;
  width: number;
  pxPerSecond: number;
  span: number;
  selected: boolean;
  sourceDuration: number;
  drag: Drag;
  onSelect: () => void;
  /** showAt: the slide time whose frame should be on the canvas while dragging. */
  onPatch: (patch: Partial<VideoElement>, coalesceKey: string, showAt: number) => void;
}) {
  const length = clipDuration(el);
  const reach = clipReach(el, sourceDuration);
  const left = el.start * pxPerSecond;
  const barWidth = Math.max(6, length * pxPerSecond);
  const editable = !el.locked;
  const handle = "absolute top-0 bottom-0 z-10 w-3 touch-none cursor-ew-resize rounded-[3px] bg-ink/70 hover:bg-ink pointer-coarse:w-5";

  return (
    <li className="relative h-8" style={{ width }} data-testid="clip-row">
      {/* What trimming has cut away: the handles can be dragged back out over it */}
      {reach.to - reach.from > length + 1e-3 && (
        <div
          aria-hidden
          data-testid="clip-reach"
          className="absolute top-1.5 bottom-1.5 rounded-[4px] border border-dashed border-line"
          style={{ left: reach.from * pxPerSecond, width: Math.max(0, (Math.min(reach.to, span) - reach.from) * pxPerSecond) }}
        />
      )}
      {/* A looping clip keeps going until the slide ends */}
      {el.loop && span > clipEnd(el) && (
        <div aria-hidden className="absolute top-1 bottom-1 rounded-r-[4px] border border-dashed border-line bg-sunken/60" style={{ left: left + barWidth, width: (span - clipEnd(el)) * pxPerSecond }} />
      )}
      <div
        role="button"
        tabIndex={0}
        aria-label={`Clip ${el.name}`}
        aria-pressed={selected}
        data-testid="clip-bar"
        data-start={el.start.toFixed(3)}
        data-length={length.toFixed(3)}
        title={`${el.name}: ${formatSeconds(el.start)} to ${formatSeconds(clipEnd(el))}`}
        className={cn(
          "absolute top-0 bottom-0 flex touch-none items-center overflow-hidden rounded-[4px] border text-[10px]",
          selected ? "border-ink bg-accent/25" : "border-line bg-accent/10",
          !el.visible && "opacity-40",
          editable ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        )}
        style={{ left, width: barWidth }}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect()}
        onPointerDown={(e) => {
          if (!editable) return onSelect();
          const from = el.start;
          drag(
            e,
            (delta) => {
              const patch = moveClip(el, from + delta);
              onPatch(patch, "timeline-move", patch.start ?? from);
            },
            onSelect,
          );
        }}
      >
        <span className="pointer-events-none truncate px-4 pointer-coarse:px-6">{el.name}</span>
        {editable && (
          <>
            <span
              role="slider"
              tabIndex={0}
              aria-label={`Trim start of ${el.name}`}
              aria-valuemin={0}
              aria-valuemax={Number(el.trimEnd.toFixed(2))}
              aria-valuenow={Number(el.trimStart.toFixed(2))}
              className={cn(handle, "left-0")}
              onPointerDown={(e) => {
                const from = el.start;
                drag(e, (delta) => {
                  const patch = trimClipStart(el, from + delta);
                  onPatch(patch, "timeline-trim-start", patch.start ?? from);
                });
              }}
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                e.stopPropagation();
                const patch = trimClipStart(el, el.start + (e.key === "ArrowLeft" ? -0.1 : 0.1));
                onPatch(patch, "timeline-trim-start", patch.start ?? el.start);
              }}
            />
            <span
              role="slider"
              tabIndex={0}
              aria-label={`Trim end of ${el.name}`}
              aria-valuemin={Number(el.trimStart.toFixed(2))}
              aria-valuemax={Number(sourceDuration.toFixed(2))}
              aria-valuenow={Number(el.trimEnd.toFixed(2))}
              className={cn(handle, "right-0")}
              onPointerDown={(e) => {
                const from = clipEnd(el);
                drag(e, (delta) => {
                  const patch = trimClipEnd(el, from + delta, sourceDuration);
                  onPatch(patch, "timeline-trim-end", clipEnd({ ...el, ...patch }) - 1 / 60);
                });
              }}
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                e.stopPropagation();
                const patch = trimClipEnd(el, clipEnd(el) + (e.key === "ArrowLeft" ? -0.1 : 0.1), sourceDuration);
                onPatch(patch, "timeline-trim-end", clipEnd({ ...el, ...patch }) - 1 / 60);
              }}
            />
          </>
        )}
      </div>
    </li>
  );
}

/** The slide's background music as a bar with its waveform: drag to move, handles to trim. */
function MusicRow({
  track,
  name,
  sourceDuration,
  slideDuration,
  width,
  pxPerSecond,
  drag,
}: {
  track: AudioTrack;
  name: string;
  sourceDuration: number;
  slideDuration: number;
  width: number;
  pxPerSecond: number;
  drag: Drag;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  // The trim helpers of video clips fit: music is a clip at normal speed.
  const asClip = { ...track, playbackRate: 1 };
  const end = Math.max(trackEnd(track, slideDuration), track.start);
  const left = track.start * pxPerSecond;
  const barWidth = Math.max(6, (end - track.start) * pxPerSecond);

  useEffect(() => {
    let live = true;
    void getAssetPeaks(track.assetId).then((p) => live && setPeaks(p ?? null), () => undefined);
    return () => {
      live = false;
    };
  }, [track.assetId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const w = Math.max(1, Math.round(barWidth));
    const h = 24;
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    if (!peaks || peaks.length === 0) return;
    ctx.fillStyle = getComputedStyle(canvas).color;
    const span = track.trimEnd - track.trimStart;
    for (let x = 0; x < w; x += 2) {
      // Which moment of the file this pixel column shows (repeating when the music loops).
      const played = (x / w) * (end - track.start);
      const at = track.trimStart + (track.loop ? played % span : played);
      const peak = peaks[Math.min(peaks.length - 1, Math.floor((at / sourceDuration) * peaks.length))] ?? 0;
      const bar = Math.max(1, peak * (h - 2));
      ctx.fillRect(x, (h - bar) / 2, 1, bar);
    }
  }, [peaks, barWidth, end, sourceDuration, track.loop, track.start, track.trimEnd, track.trimStart]);

  const handle = "absolute top-0 bottom-0 z-10 w-3 touch-none cursor-ew-resize rounded-[3px] bg-ink/70 hover:bg-ink pointer-coarse:w-5";
  return (
    <div className="relative mb-1 h-7" style={{ width }} data-testid="music-row">
      <div
        role="button"
        tabIndex={0}
        aria-label={`Music ${name}`}
        data-testid="music-bar"
        data-start={track.start.toFixed(3)}
        data-length={(end - track.start).toFixed(3)}
        title={`${name}: ${formatSeconds(track.start)} to ${formatSeconds(end)}`}
        className="absolute top-0 bottom-0 flex cursor-grab touch-none items-center overflow-hidden rounded-[4px] border border-line bg-sunken text-[10px] text-muted active:cursor-grabbing"
        style={{ left, width: barWidth }}
        onPointerDown={(e) => {
          const from = track.start;
          drag(e, (delta) => updateMusic(moveClip(asClip, from + delta, Math.max(0, slideDuration - 0.1)), "move"));
        }}
      >
        <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full opacity-60" data-testid="music-waveform" data-has-peaks={peaks && peaks.length > 0 ? "yes" : "no"} />
        <span className="pointer-events-none relative truncate px-4 text-ink pointer-coarse:px-6">♪ {name}</span>
        <span
          role="slider"
          tabIndex={0}
          aria-label="Trim start of music"
          aria-valuemin={0}
          aria-valuemax={Number(track.trimEnd.toFixed(2))}
          aria-valuenow={Number(track.trimStart.toFixed(2))}
          className={cn(handle, "left-0")}
          onPointerDown={(e) => {
            const from = track.start;
            drag(e, (delta) => updateMusic(trimClipStart(asClip, from + delta), "trim-start"));
          }}
        />
        {!track.loop && (
          <span
            role="slider"
            tabIndex={0}
            aria-label="Trim end of music"
            aria-valuemin={Number(track.trimStart.toFixed(2))}
            aria-valuemax={Number(sourceDuration.toFixed(2))}
            aria-valuenow={Number(track.trimEnd.toFixed(2))}
            className={cn(handle, "right-0")}
            onPointerDown={(e) => {
              const from = clipEnd(asClip);
              drag(e, (delta) => updateMusic(trimClipEnd(asClip, from + delta, sourceDuration), "trim-end"));
            }}
          />
        )}
      </div>
    </div>
  );
}
