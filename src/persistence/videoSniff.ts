/**
 * Video container detection by file signature. Pure, so it is unit tested in Node.
 * The extension and the type reported by the browser are never trusted.
 */
export type VideoMime = "video/mp4" | "video/quicktime" | "video/webm";

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));

/** Needs the first 64 bytes of the file (fewer is fine for MP4 and MOV). */
export function sniffVideoType(bytes: Uint8Array): VideoMime | null {
  // ISO base media (MP4, MOV): a box header, 4 bytes of size followed by the box type.
  if (bytes.length >= 12) {
    const box = ascii(bytes, 4, 8);
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
