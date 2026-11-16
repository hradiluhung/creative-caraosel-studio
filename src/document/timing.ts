/**
 * Time model for video. Pure functions shared by the editor preview, the timeline and the
 * video exporter, so they can never disagree about which source frame belongs to which
 * moment of a slide.
 *
 * A clip begins at its `start` on the slide and plays its trimmed range at its playback rate.
 * It is on screen only while it plays: from `start` until one pass is over, or until the end
 * of the slide when it loops. That is what makes "split" work: the two halves are two clips
 * that follow each other.
 */
import { getSurface, rotatedBounds, type ExportFrame } from "./geometry";
import type { AssetRef, AudioTrack, DesignElement, Project, VideoElement } from "./schema";

type ClipTiming = Pick<VideoElement, "start" | "trimStart" | "trimEnd" | "playbackRate" | "loop">;

/** Shortest clip the editor creates (about one frame at 24 fps). */
export const MIN_CLIP_SECONDS = 0.05;

/** How long one pass of the trimmed range takes on the slide, in seconds. */
export function clipDuration(el: ClipTiming): number {
  return Math.max(0, el.trimEnd - el.trimStart) / el.playbackRate;
}

/** Slide time at which one pass of the clip is over. */
export function clipEnd(el: ClipTiming): number {
  return el.start + clipDuration(el);
}

/** True while the clip is on screen at this slide time. */
export function clipActive(el: ClipTiming, slideTime: number): boolean {
  return slideTime >= el.start && (el.loop || slideTime < clipEnd(el));
}

/**
 * Source time (seconds inside the file) for a slide time. Before the clip starts this is its
 * first frame, after a non-looping clip has ended its last one; a looping clip wraps around.
 */
export function videoTimeAt(el: ClipTiming, slideTime: number): number {
  const span = Math.max(0, el.trimEnd - el.trimStart);
  const played = Math.max(0, slideTime - el.start) * el.playbackRate;
  if (span === 0) return el.trimStart;
  if (played < span) return el.trimStart + played;
  return el.loop ? el.trimStart + (played % span) : el.trimEnd;
}

/** True once a non-looping clip has played through. */
export function clipEnded(el: ClipTiming, slideTime: number): boolean {
  return !el.loop && slideTime >= clipEnd(el);
}

export function videoElements(elements: DesignElement[]): VideoElement[] {
  return elements.filter((el): el is VideoElement => el.type === "video");
}

/**
 * Length of a surface in seconds: the manual duration when one is set, otherwise the end of
 * the last visible clip. 0 means the surface has no video (a still slide).
 */
export function surfaceDuration(elements: DesignElement[], manual?: number): number {
  if (manual !== undefined) return manual;
  return videoElements(elements).reduce((max, el) => (el.visible ? Math.max(max, clipEnd(el)) : max), 0);
}

/**
 * Visible clips that show up in an export frame. On an independent slide that is every visible
 * clip; in a seamless panorama only the clips whose box reaches into that slide's slice.
 */
export function frameClips(project: Project, frame: ExportFrame): VideoElement[] {
  const surface = getSurface(project, frame.surfaceId);
  if (!surface) return [];
  return videoElements(surface.elements).filter((el) => {
    if (!el.visible) return false;
    const b = rotatedBounds(el);
    return b.x < frame.x + frame.width && b.x + b.width > frame.x && b.y < frame.y + frame.height && b.y + b.height > frame.y;
  });
}

/** Seconds an export frame plays: 0 for a still slide. */
export function frameDuration(project: Project, frame: ExportFrame): number {
  const clips = frameClips(project, frame);
  if (clips.length === 0) return 0;
  const surface = getSurface(project, frame.surfaceId);
  return surfaceDuration(clips, surface?.duration);
}

/** Keep trim values inside the source and at least one frame apart. */
export function clampTrim(trimStart: number, trimEnd: number, sourceDuration: number, minLength = MIN_CLIP_SECONDS): { trimStart: number; trimEnd: number } {
  const total = Math.max(sourceDuration, minLength);
  const start = Math.min(Math.max(0, trimStart), total - minLength);
  const end = Math.min(Math.max(trimEnd, start + minLength), total);
  return { trimStart: start, trimEnd: end };
}

type ClipPatch = Partial<Pick<VideoElement, "start" | "trimStart" | "trimEnd">>;

/**
 * Timeline edits, expressed as the slide time the dragged edge should land on. Each returns
 * the patch for the clip, already limited to what the source file and the slide allow.
 */

/** Drag the left edge: the right edge stays where it is, so start and trimStart move together. */
export function trimClipStart(el: ClipTiming, toSlideTime: number): ClipPatch {
  const min = Math.max(0, el.start - el.trimStart / el.playbackRate); // cannot go before the first source frame or slide time 0
  const max = clipEnd(el) - MIN_CLIP_SECONDS / el.playbackRate;
  const start = Math.min(Math.max(toSlideTime, min), max);
  return { start, trimStart: Math.max(0, el.trimStart + (start - el.start) * el.playbackRate) };
}

/** Drag the right edge: only trimEnd changes. */
export function trimClipEnd(el: ClipTiming, toSlideTime: number, sourceDuration: number): ClipPatch {
  const wanted = el.trimStart + (toSlideTime - el.start) * el.playbackRate;
  return { trimEnd: Math.min(Math.max(wanted, el.trimStart + MIN_CLIP_SECONDS), Math.max(sourceDuration, el.trimStart + MIN_CLIP_SECONDS)) };
}

/** Drag the whole clip along the slide. */
export function moveClip(el: ClipTiming, toStart: number, maxStart: number): ClipPatch {
  return { start: Math.min(Math.max(0, toStart), Math.max(0, maxStart)) };
}

/**
 * Cut a clip in two at a slide time. Returns the patches for the first half (the original
 * element) and the second half (a copy), or null when the time is not inside the first pass.
 */
export function splitClip(el: ClipTiming, slideTime: number): { first: ClipPatch & { loop: boolean }; second: ClipPatch } | null {
  const margin = MIN_CLIP_SECONDS / el.playbackRate;
  if (slideTime < el.start + margin || slideTime > clipEnd(el) - margin) return null;
  const cut = el.trimStart + (slideTime - el.start) * el.playbackRate;
  return { first: { trimEnd: cut, loop: false }, second: { start: slideTime, trimStart: cut } };
}

// --- Background music -------------------------------------------------------------------

/** A new track that plays the whole file from the start of the slide. */
export function createAudioTrack(asset: Pick<AssetRef, "id" | "duration">): AudioTrack {
  return { assetId: asset.id, start: 0, trimStart: 0, trimEnd: asset.duration ?? 1, volume: 0.8, fadeIn: 0, fadeOut: 0, loop: false };
}

/** Slide time at which the music stops: the end of its trimmed part, or of the slide when it loops or runs over. */
export function trackEnd(track: AudioTrack, slideDuration: number): number {
  const natural = track.start + (track.trimEnd - track.trimStart);
  return Math.min(slideDuration, track.loop ? slideDuration : natural);
}

/** True while the music is audible at this slide time. */
export function trackActive(track: AudioTrack, slideTime: number, slideDuration: number): boolean {
  return slideTime >= track.start && slideTime < trackEnd(track, slideDuration);
}

/** Position inside the audio file for a slide time (wraps when the track loops). */
export function audioTimeAt(track: AudioTrack, slideTime: number): number {
  const span = track.trimEnd - track.trimStart;
  const played = Math.max(0, slideTime - track.start);
  if (played < span) return track.trimStart + played;
  return track.loop ? track.trimStart + (played % span) : track.trimEnd;
}

/**
 * Volume of the music at a slide time, 0..1: its volume, faded in after its start and faded
 * out before it stops. The preview and the export both follow this curve.
 */
export function trackGainAt(track: AudioTrack, slideTime: number, slideDuration: number): number {
  const end = trackEnd(track, slideDuration);
  if (slideTime < track.start || slideTime >= end) return 0;
  const length = end - track.start;
  // Fades never overlap: on a very short track they share its length.
  const scale = Math.min(1, length / Math.max(track.fadeIn + track.fadeOut, 1e-9));
  const fadeIn = track.fadeIn * scale;
  const fadeOut = track.fadeOut * scale;
  const rise = fadeIn > 0 ? Math.min(1, (slideTime - track.start) / fadeIn) : 1;
  const fall = fadeOut > 0 ? Math.min(1, (end - slideTime) / fadeOut) : 1;
  return track.volume * Math.min(rise, fall);
}

/** Corner points of the gain curve (slide time, gain), for scheduling linear ramps in an export. */
export function trackGainPoints(track: AudioTrack, slideDuration: number): Array<{ time: number; gain: number }> {
  const end = trackEnd(track, slideDuration);
  if (end <= track.start) return [];
  const length = end - track.start;
  const scale = Math.min(1, length / Math.max(track.fadeIn + track.fadeOut, 1e-9));
  const fadeIn = track.fadeIn * scale;
  const fadeOut = track.fadeOut * scale;
  return [
    { time: track.start, gain: fadeIn > 0 ? 0 : track.volume },
    { time: track.start + fadeIn, gain: track.volume },
    { time: end - fadeOut, gain: track.volume },
    { time: end, gain: fadeOut > 0 ? 0 : track.volume },
  ];
}

/** m:ss.t label for playback clocks. */
export function formatSeconds(seconds: number): string {
  const s = Math.max(0, seconds);
  const whole = Math.floor(s);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}.${Math.floor((s - whole) * 10 + 1e-6)}`;
}
