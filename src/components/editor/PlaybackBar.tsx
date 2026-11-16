"use client";

import { Pause, Play, Square } from "lucide-react";
import { getSurface } from "@/document/geometry";
import { formatSeconds, surfaceDuration, videoElements } from "@/document/timing";
import { useEditorStore } from "@/store/editorStore";
import { canvasApi } from "./canvasApi";

/** Play / pause for the active slide. Only shown when that slide has a visible video. */
export function PlaybackBar() {
  const project = useEditorStore((s) => s.project);
  const activeSurfaceId = useEditorStore((s) => s.activeSurfaceId);
  const playback = useEditorStore((s) => s.playback);
  const playhead = useEditorStore((s) => s.playhead);
  const notice = useEditorStore((s) => s.playbackNotice);
  const surface = project && getSurface(project, activeSurfaceId);
  if (!surface || !videoElements(surface.elements).some((el) => el.visible)) return null;
  const duration = surfaceDuration(surface.elements, surface.duration);
  const playing = playback === "playing";
  const button = "flex h-8 w-8 items-center justify-center rounded-full hover:bg-sunken disabled:opacity-30 [&_svg]:h-4 [&_svg]:w-4";

  return (
    <div className="pointer-events-none absolute right-2 bottom-3 left-2 flex flex-col items-center gap-1.5">
      {notice && (
        <p role="status" className="pointer-events-auto max-w-xs rounded-md border border-line bg-panel px-2.5 py-1.5 text-center text-[11px] shadow-sm">
          {notice}
        </p>
      )}
      <div
        role="group"
        aria-label="Video playback"
        data-testid="playback-bar"
        data-state={playback}
        className="pointer-events-auto flex items-center gap-1 rounded-full border border-line bg-panel/95 py-1 pr-3 pl-1 shadow-sm backdrop-blur"
      >
        <button type="button" aria-label={playing ? "Pause slide" : "Play slide"} className={button} disabled={duration <= 0} onClick={() => canvasApi.togglePlayback()}>
          {playing ? <Pause /> : <Play />}
        </button>
        <button type="button" aria-label="Stop and show poster frames" className={button} disabled={playback === "stopped"} onClick={() => canvasApi.stopPlayback()}>
          <Square />
        </button>
        <span data-testid="playback-clock" className="pl-1 text-[11px] text-muted tabular-nums">
          {formatSeconds(playback === "stopped" ? 0 : playhead)} / {formatSeconds(duration)}
        </span>
      </div>
    </div>
  );
}
