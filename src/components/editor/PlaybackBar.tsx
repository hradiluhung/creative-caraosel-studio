"use client";

import { Pause, Play, Square } from "lucide-react";
import { formatSeconds } from "@/document/timing";
import { useEditorStore } from "@/store/editorStore";
import { canvasApi } from "./canvasApi";

/** Play, pause, stop and the clock for the active slide. Lives in the timeline header. */
export function PlaybackBar({ duration }: { duration: number }) {
  const playback = useEditorStore((s) => s.playback);
  const playhead = useEditorStore((s) => s.playhead);
  const playing = playback === "playing";
  const button = "flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-sunken disabled:opacity-30 [&_svg]:h-4 [&_svg]:w-4";

  return (
    <div role="group" aria-label="Video playback" data-testid="playback-bar" data-state={playback} className="flex items-center gap-0.5">
      <button type="button" aria-label={playing ? "Pause slide" : "Play slide"} className={button} disabled={duration <= 0} onClick={() => canvasApi.togglePlayback()}>
        {playing ? <Pause /> : <Play />}
      </button>
      <button type="button" aria-label="Stop and show poster frames" className={button} disabled={playback === "stopped"} onClick={() => canvasApi.stopPlayback()}>
        <Square />
      </button>
      <span data-testid="playback-clock" className="pl-1 text-[11px] whitespace-nowrap text-muted tabular-nums">
        {formatSeconds(playback === "stopped" ? 0 : playhead)} / {formatSeconds(duration)}
      </span>
    </div>
  );
}
