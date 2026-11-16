/**
 * Built-in sticker and doodle library. Every sticker is original vector artwork
 * described as path data, so it stays crisp at any size and can be recolored.
 * To add one, append an entry here; nothing else needs to change.
 */
import { starPoints } from "./shapes";

export interface StickerDef {
  id: string;
  name: string;
  category: "Shapes" | "Doodles" | "Paper & film";
  /** viewBox size the path data is drawn in */
  width: number;
  height: number;
  data: string;
  mode: "fill" | "stroke";
  strokeWidth?: number;
  evenOdd?: boolean;
  /** Suggested color when first placed. */
  color?: string;
}

const poly = (pts: number[]) => pts.reduce((d, v, i) => d + (i % 2 === 0 ? `${i === 0 ? "M" : "L"}${v.toFixed(1)} ` : `${v.toFixed(1)} `), "") + "Z";

function filmFrame(): string {
  let d = "M0 0 H300 V220 H0 Z M24 34 V186 H276 V34 Z";
  for (let i = 0; i < 9; i++) {
    const x = 14 + i * 32;
    d += ` M${x} 8 h16 v16 h-16 Z M${x} 196 h16 v16 h-16 Z`;
  }
  return d;
}

export const STICKERS: StickerDef[] = [
  { id: "sparkle", name: "Sparkle", category: "Shapes", width: 100, height: 100, mode: "fill", data: "M50 0 C54 30 70 46 100 50 C70 54 54 70 50 100 C46 70 30 54 0 50 C30 46 46 30 50 0 Z" },
  { id: "heart", name: "Heart", category: "Shapes", width: 100, height: 92, mode: "fill", color: "#e0245e", data: "M50 90 C20 65 2 48 2 28 C2 12 14 2 27 2 C37 2 46 8 50 17 C54 8 63 2 73 2 C86 2 98 12 98 28 C98 48 80 65 50 90 Z" },
  { id: "burst", name: "Starburst", category: "Shapes", width: 100, height: 100, mode: "fill", color: "#f5b700", data: poly(starPoints(14, 100, 100, 0.78)) },
  { id: "lightning", name: "Lightning", category: "Shapes", width: 100, height: 100, mode: "fill", color: "#f5b700", data: "M58 2 L14 56 H44 L36 98 L86 40 H54 Z" },
  { id: "crown", name: "Crown", category: "Shapes", width: 100, height: 70, mode: "fill", color: "#f5b700", data: "M6 64 L2 14 L28 36 L50 4 L72 36 L98 14 L94 64 Z" },
  { id: "bubble", name: "Speech bubble", category: "Shapes", width: 120, height: 100, mode: "fill", data: "M20 6 H100 Q114 6 114 20 V60 Q114 74 100 74 H52 L30 94 V74 H20 Q6 74 6 60 V20 Q6 6 20 6 Z" },
  { id: "scribble-circle", name: "Circle scribble", category: "Doodles", width: 100, height: 100, mode: "stroke", strokeWidth: 4, data: "M52 8 C22 4 4 26 6 52 C8 80 34 96 60 92 C84 88 98 66 94 42 C90 18 66 4 40 10" },
  { id: "squiggle", name: "Squiggle underline", category: "Doodles", width: 200, height: 30, mode: "stroke", strokeWidth: 5, data: "M4 18 C24 2 40 28 60 14 C80 0 96 28 116 14 C136 0 152 28 172 14 C182 8 190 10 196 14" },
  { id: "arrow-curved", name: "Curved arrow", category: "Doodles", width: 120, height: 80, mode: "stroke", strokeWidth: 5, data: "M6 70 C30 20 70 10 108 30 M108 30 L88 22 M108 30 L96 48" },
  { id: "arrow-doodle", name: "Hand-drawn arrow", category: "Doodles", width: 140, height: 40, mode: "stroke", strokeWidth: 5, data: "M4 22 C40 16 90 24 132 20 M132 20 L114 8 M132 20 L116 34" },
  { id: "check", name: "Check", category: "Doodles", width: 100, height: 100, mode: "stroke", strokeWidth: 10, data: "M10 55 L38 82 L90 18" },
  { id: "cross", name: "Cross", category: "Doodles", width: 100, height: 100, mode: "stroke", strokeWidth: 10, data: "M15 15 L85 85 M85 15 L15 85" },
  { id: "asterisk", name: "Asterisk", category: "Doodles", width: 100, height: 100, mode: "stroke", strokeWidth: 10, data: "M50 8 V92 M14 29 L86 71 M86 29 L14 71" },
  { id: "sun", name: "Sun", category: "Doodles", width: 100, height: 100, mode: "stroke", strokeWidth: 5, data: "M50 30 A20 20 0 1 1 49.9 30 Z M50 4 V16 M50 84 V96 M4 50 H16 M84 50 H96 M17 17 L26 26 M74 74 L83 83 M83 17 L74 26 M26 74 L17 83" },
  { id: "smile", name: "Smile", category: "Doodles", width: 100, height: 100, mode: "stroke", strokeWidth: 5, data: "M50 6 A44 44 0 1 1 49.9 6 Z M34 38 V48 M66 38 V48 M30 62 Q50 82 70 62" },
  { id: "tape", name: "Tape strip", category: "Paper & film", width: 200, height: 50, mode: "fill", color: "#e9dcc0", data: "M6 0 H194 L200 8 L194 16 L200 25 L194 34 L200 42 L194 50 H6 L0 42 L6 34 L0 25 L6 16 L0 8 Z" },
  { id: "torn-paper", name: "Torn paper", category: "Paper & film", width: 300, height: 120, mode: "fill", color: "#f6f1e7", data: "M0 14 L18 6 L34 16 L52 4 L75 14 L96 5 L120 15 L141 6 L165 16 L188 5 L212 14 L236 4 L258 15 L280 6 L300 14 V106 L282 114 L262 104 L240 116 L216 106 L190 115 L168 104 L144 116 L120 105 L96 115 L72 104 L50 116 L26 106 L0 114 Z" },
  { id: "film-frame", name: "Film frame", category: "Paper & film", width: 300, height: 220, mode: "fill", evenOdd: true, data: filmFrame() },
];

export function getSticker(id: string): StickerDef | undefined {
  return STICKERS.find((s) => s.id === id);
}
