/**
 * What a device can export as video, and the numbers the export dialog shows. Kept apart from
 * src/export/video.ts so the dialog does not pull in the encoder and demuxer libraries: those are
 * loaded only when a video is really exported.
 */
export const VIDEO_FPS = 30;
export type VideoResolution = 720 | 1080;
export type VideoQuality = "small" | "standard" | "high";
/** Sound is always AAC: it is what Instagram and phones expect. */
export type AudioCodec = "aac";

/** Encoded bits per pixel per frame. 1080 x 1350 at 30 fps: about 2.6, 4.8 and 8.7 Mbit/s. */
const BITS_PER_PIXEL: Record<VideoQuality, number> = { small: 0.06, standard: 0.11, high: 0.2 };
export const AUDIO_SAMPLE_RATE = 48_000;
export const AUDIO_BITRATE = 128_000;

export interface VideoSupport {
  /** WebCodecs H.264 encoding works for this output size. */
  mp4: boolean;
  /** Sound codecs that can be produced here. Empty: the MP4 has no sound. */
  audio: AudioCodec[];
  /** Real-time fallback: what MediaRecorder would produce here, or null when it cannot record. */
  recorder: { mime: string; ext: "mp4" | "webm" } | null;
}

export interface VideoSize {
  width: number;
  height: number;
  /** Output pixels per document pixel. */
  scale: number;
}

/** Output size: the short side becomes 720 or 1080 (never larger than the slide), both sides even. */
export function videoOutputSize(frameWidth: number, frameHeight: number, resolution: VideoResolution): VideoSize {
  const scale = Math.min(1, resolution / Math.min(frameWidth, frameHeight));
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(frameWidth * scale), height: even(frameHeight * scale), scale };
}

export function videoBitrate(size: VideoSize, quality: VideoQuality, fps = VIDEO_FPS): number {
  return Math.round(size.width * size.height * fps * BITS_PER_PIXEL[quality]);
}

/** H.264 profile and level strings to try, best first, for a frame size. */
function avcCandidates(size: VideoSize): string[] {
  const large = size.width * size.height > 1920 * 1088;
  // High, Main and Baseline profile; level 4.0 (up to 1080p) or 5.1 (up to 4K).
  return large ? ["avc1.640033", "avc1.4d0033", "avc1.42E033"] : ["avc1.640028", "avc1.4d0028", "avc1.42E028"];
}

export function videoEncoderConfig(codec: string, size: VideoSize, bitrate: number): VideoEncoderConfig {
  return { codec, width: size.width, height: size.height, bitrate, framerate: VIDEO_FPS, latencyMode: "quality", avc: { format: "avc" } };
}

export async function pickAvcCodec(size: VideoSize, bitrate: number): Promise<string | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
  for (const codec of avcCandidates(size)) {
    try {
      if ((await VideoEncoder.isConfigSupported(videoEncoderConfig(codec, size, bitrate))).supported) return codec;
    } catch {
      /* try the next profile */
    }
  }
  return null;
}

/** Feature detection for the export dialog: says honestly what this device can produce. */
export async function detectVideoSupport(size: VideoSize): Promise<VideoSupport> {
  const mp4 = (await pickAvcCodec(size, videoBitrate(size, "standard"))) !== null;
  // Sound is encoded by a WebAssembly AAC encoder that ships with the app, so it does not depend on
  // what the browser's own encoders can do. It only needs Web Audio (to mix) and WebAssembly.
  const audio: AudioCodec[] = typeof OfflineAudioContext !== "undefined" && typeof WebAssembly !== "undefined" ? ["aac"] : [];
  let recorder: VideoSupport["recorder"] = null;
  if (typeof MediaRecorder !== "undefined" && "captureStream" in HTMLCanvasElement.prototype) {
    const mime = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
    if (mime) recorder = { mime, ext: mime.startsWith("video/mp4") ? "mp4" : "webm" };
  }
  return { mp4, audio, recorder };
}
