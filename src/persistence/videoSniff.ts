/**
 * Video container detection by file signature. Pure, so it is unit tested in Node.
 * The extension and the type reported by the browser are never trusted.
 */
export type VideoMime = "video/mp4" | "video/quicktime" | "video/webm";

const AUDIO_BRANDS = new Set(["M4A ", "M4B ", "M4P "]);

export type AudioMime = "audio/mpeg" | "audio/mp4" | "audio/wav";

/** Music files by signature: MP3, M4A (AAC in an MP4 container) and WAV. Needs the first 12 bytes. */
export function sniffAudioType(bytes: Uint8Array): AudioMime | null {
  if (bytes.length < 12) return null;
  const text = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (text(0, 3) === "ID3") return "audio/mpeg";
  // MPEG audio frame sync: 11 set bits, then a valid version and layer III.
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x18) !== 0x08 && (bytes[1] & 0x06) === 0x02) return "audio/mpeg";
  if (text(4, 8) === "ftyp" && AUDIO_BRANDS.has(text(8, 12))) return "audio/mp4";
  if (text(0, 4) === "RIFF" && text(8, 12) === "WAVE") return "audio/wav";
  return null;
}

export const AUDIO_LABEL: Record<AudioMime, string> = { "audio/mpeg": "MP3", "audio/mp4": "M4A", "audio/wav": "WAV" };

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));

/** Needs the first 64 bytes of the file (fewer is fine for MP4 and MOV). */
export function sniffVideoType(bytes: Uint8Array): VideoMime | null {
  // ISO base media (MP4, MOV): a box header, 4 bytes of size followed by the box type.
  if (bytes.length >= 12) {
    const box = ascii(bytes, 4, 8);
    // Audio-only MP4 (.m4a) says so in its brand: that is music, not a video.
    if (box === "ftyp" && AUDIO_BRANDS.has(ascii(bytes, 8, 12))) return null;
    if (box === "ftyp") return ascii(bytes, 8, 12) === "qt  " ? "video/quicktime" : "video/mp4";
    // Classic QuickTime files may start with the movie box itself instead of a file type box.
    if (box === "moov" || box === "wide") return "video/quicktime";
  }
  // EBML header. Matroska (.mkv) shares it, so the document type must say "webm".
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return ascii(bytes, 4, Math.min(bytes.length, 64)).includes("webm") ? "video/webm" : null;
  }
  return null;
}

export const VIDEO_LABEL: Record<VideoMime, string> = {
  "video/mp4": "MP4",
  "video/quicktime": "MOV",
  "video/webm": "WebM",
};
