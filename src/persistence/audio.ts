/**
 * Music import: validate by signature, read the length from an <audio> element, and store the
 * untouched original together with a small waveform (peaks) for the timeline.
 */
import { createId } from "@/document/ids";
import type { AssetRef } from "@/document/schema";
import { once } from "@/render/videoDom";
import { AssetError } from "./assets";
import { putAsset } from "./db";
import { sniffAudioType } from "./videoSniff";

export const AUDIO_ACCEPT_ATTR = "audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,.mp3,.m4a,.wav";
export const MAX_AUDIO_BYTES = 60 * 1024 * 1024;
/** Number of bars stored for the waveform. */
export const WAVEFORM_BARS = 240;
/** Decoding a whole song to draw its waveform needs a lot of memory: skipped for long files. */
const WAVEFORM_MAX_SECONDS = 12 * 60;

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/** Loudest sample in each of `bars` equal slices, 0..1. */
export function computePeaks(channels: Float32Array[], bars = WAVEFORM_BARS): number[] {
  const length = channels[0]?.length ?? 0;
  if (length === 0) return [];
  const peaks: number[] = [];
  // Looking at every 8th sample is plenty for a picture and 8 times cheaper.
  const stride = 8;
  for (let bar = 0; bar < bars; bar++) {
    const from = Math.floor((bar / bars) * length);
    const to = Math.max(from + 1, Math.floor(((bar + 1) / bars) * length));
    let max = 0;
    for (const data of channels) {
      for (let i = from; i < to; i += stride) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
    }
    peaks.push(Math.min(1, Number(max.toFixed(3))));
  }
  return peaks;
}

async function readDuration(blob: Blob, label: string): Promise<number> {
  const url = URL.createObjectURL(blob);
  const audio = document.createElement("audio");
  audio.preload = "metadata";
  audio.src = url;
  try {
    if (audio.readyState < 1 && !(await once(audio, "loadedmetadata", 20_000))) {
      throw new AssetError(`"${label}" cannot be played by this browser.`);
    }
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) throw new AssetError(`The length of "${label}" could not be read.`);
    return audio.duration;
  } finally {
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(url);
  }
}

async function readPeaks(blob: Blob, duration: number): Promise<number[] | undefined> {
  if (duration > WAVEFORM_MAX_SECONDS || typeof OfflineAudioContext === "undefined") return undefined;
  try {
    const ctx = new OfflineAudioContext(1, 1, 44_100);
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    return computePeaks(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)));
  } catch {
    return undefined; // the waveform is decoration: the track still works without it
  }
}

/** Validate, measure and store an imported music file. */
export async function importAudioFile(file: File): Promise<AssetRef> {
  const name = file.name || "music";
  if (file.size > MAX_AUDIO_BYTES) throw new AssetError(`"${name}" is ${mb(file.size)}. The limit for music is ${mb(MAX_AUDIO_BYTES)}.`);
  const mime = sniffAudioType(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (!mime) throw new AssetError(`"${name}" is not a supported music file (MP3, M4A or WAV).`);
  const blob = file.slice(0, file.size, mime);
  const duration = await readDuration(blob, name);
  const peaks = await readPeaks(blob, duration);
  const ref: AssetRef = { id: createId(), name, mime, width: 0, height: 0, size: file.size, duration };
  try {
    await putAsset({ ...ref, blob, peaks, createdAt: new Date().toISOString() });
  } catch {
    throw new AssetError(`"${name}" could not be stored on this device (storage may be full).`);
  }
  return ref;
}
