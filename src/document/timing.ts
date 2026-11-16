/**
 * Time model for video. Pure functions shared by the editor preview now and by the
 * timeline and the video exporter later, so they can never disagree about which source
 * frame belongs to which moment of a slide.
 *
 * Every clip starts at slide time 0 and plays its trimmed range at its playback rate.
 */
import type { DesignElement, VideoElement } from "./schema";

type ClipTiming = Pick<VideoElement, "trimStart" | "trimEnd" | "playbackRate" | "loop">;

/** How long one pass of the trimmed range takes on the slide, in seconds. */
export function clipDuration(el: ClipTiming): number {
  return Math.max(0, el.trimEnd - el.trimStart) / el.playbackRate;
}

/**
 * Source time (seconds inside the file) shown at a given slide time.
 * A looping clip wraps around; any other clip holds its last frame once it has ended.
 */
export function videoTimeAt(el: ClipTiming, slideTime: number): number {
  const span = Math.max(0, el.trimEnd - el.trimStart);
  const played = Math.max(0, slideTime) * el.playbackRate;
  if (span === 0) return el.trimStart;
  if (played < span) return el.trimStart + played;
  return el.loop ? el.trimStart + (played % span) : el.trimEnd;
}

/** True once a non-looping clip has played through. */
export function clipEnded(el: ClipTiming, slideTime: number): boolean {
  return !el.loop && slideTime >= clipDuration(el);
}

export function videoElements(elements: DesignElement[]): VideoElement[] {
  return elements.filter((el): el is VideoElement => el.type === "video");
}

/**
 * Length of a surface in seconds: the manual duration when one is set, otherwise the
 * longest visible clip. 0 means the surface has no video (a still slide).
 */
export function surfaceDuration(elements: DesignElement[], manual?: number): number {
  if (manual !== undefined) return manual;
  return videoElements(elements).reduce((max, el) => (el.visible ? Math.max(max, clipDuration(el)) : max), 0);
}

/** Keep trim values inside the source and at least one frame apart. */
export function clampTrim(trimStart: number, trimEnd: number, sourceDuration: number, minLength = 0.05): { trimStart: number; trimEnd: number } {
  const total = Math.max(sourceDuration, minLength);
  const start = Math.min(Math.max(0, trimStart), total - minLength);
  const end = Math.min(Math.max(trimEnd, start + minLength), total);
  return { trimStart: start, trimEnd: end };
}

/** m:ss.t label for playback clocks. */
export function formatSeconds(seconds: number): string {
  const s = Math.max(0, seconds);
  const whole = Math.floor(s);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}.${Math.floor((s - whole) * 10)}`;
}
