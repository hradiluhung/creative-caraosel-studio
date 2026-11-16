/**
 * Video import: validate by signature, check that this browser can really decode the file,
 * read its duration and size from a <video> element, and store the untouched original
 * together with a small poster frame.
 */
import { createId } from "@/document/ids";
import type { AssetRef } from "@/document/schema";
import { AssetError } from "./assets";
import { createSilentVideo, once, releaseVideo, seekVideo } from "@/render/videoDom";
import { putAsset } from "./db";
import { sniffVideoType, VIDEO_LABEL } from "./videoSniff";

export const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
export const VIDEO_ACCEPT_ATTR = ACCEPTED_VIDEO_TYPES.join(",");
export const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 600;
const POSTER_MAX_SIDE = 960;
const LOAD_TIMEOUT_MS = 20_000;

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

export interface VideoProbe {
  width: number;
  height: number;
  duration: number;
  poster: Blob | undefined;
}

/** Read size and duration, and grab a poster frame. Throws AssetError when the file cannot be decoded. */
export async function probeVideo(blob: Blob, label: string): Promise<VideoProbe> {
  const url = URL.createObjectURL(blob);
  const video = createSilentVideo(url);
  try {
    const cannot = new AssetError(`"${label}" cannot be decoded by this browser. Try an MP4 with H.264 video.`);
    if (video.readyState < 1 && !(await once(video, "loadedmetadata", LOAD_TIMEOUT_MS))) throw cannot;
    if (!Number.isFinite(video.duration)) {
      // Recorded WebM files often have no duration in the header: seeking far ahead makes the browser find it.
      const known = once(video, "durationchange", LOAD_TIMEOUT_MS);
      video.currentTime = 1e7;
      await known;
    }
    const { videoWidth: width, videoHeight: height, duration } = video;
    if (!width || !height) throw new AssetError(`"${label}" has no video track this browser can show.`);
    if (!Number.isFinite(duration) || duration <= 0) throw new AssetError(`The length of "${label}" could not be read.`);
    if (!(await seekVideo(video, 0, LOAD_TIMEOUT_MS))) throw cannot;

    let poster: Blob | undefined;
    const scale = Math.min(1, POSTER_MAX_SIDE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      poster = (await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85))) ?? undefined;
    }
    canvas.width = canvas.height = 0;
    return { width, height, duration, poster };
  } finally {
    releaseVideo(video);
    URL.revokeObjectURL(url);
  }
}

/** Validate, measure and store an imported video. The original file is kept untouched. */
export async function importVideoFile(file: File): Promise<AssetRef> {
  const name = file.name || "video";
  if (file.size > MAX_VIDEO_BYTES) throw new AssetError(`"${name}" is ${mb(file.size)}. The limit for videos is ${mb(MAX_VIDEO_BYTES)}.`);
  const mime = sniffVideoType(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
  if (!mime) throw new AssetError(`"${name}" is not a supported video (MP4, MOV or WebM).`);
  if (document.createElement("video").canPlayType(mime) === "") {
    throw new AssetError(`This browser cannot play ${VIDEO_LABEL[mime]} files, so "${name}" was not imported.`);
  }
  // Videos are large: refuse early instead of failing halfway through a write to IndexedDB.
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota !== undefined && estimate.usage !== undefined && estimate.quota - estimate.usage < file.size * 1.1) {
      throw new AssetError(`There is not enough storage left on this device for "${name}" (${mb(file.size)}).`);
    }
  } catch (e) {
    if (e instanceof AssetError) throw e;
    /* estimate is not available everywhere: the write below still reports a real failure */
  }
  const blob = file.slice(0, file.size, mime);
  const probe = await probeVideo(blob, name);
  if (probe.duration > MAX_VIDEO_SECONDS) {
    throw new AssetError(`"${name}" is ${Math.round(probe.duration / 60)} minutes long. The limit is ${MAX_VIDEO_SECONDS / 60} minutes.`);
  }
  const ref: AssetRef = { id: createId(), name, mime, width: probe.width, height: probe.height, size: file.size, duration: probe.duration };
  try {
    await putAsset({ ...ref, blob, poster: probe.poster, createdAt: new Date().toISOString() });
  } catch {
    throw new AssetError(`"${name}" could not be stored on this device (storage may be full).`);
  }
  return ref;
}
