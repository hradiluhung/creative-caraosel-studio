/**
 * Built-in font catalog. Font files are self-hosted through @fontsource (all
 * SIL Open Font License), so they work offline and the editor and the exporter
 * resolve exactly the same faces. Custom font upload arrives in Phase 2 and
 * will register into this same catalog.
 */
export interface FontDef {
  family: string;
  category: "Sans Serif" | "Serif" | "Display" | "Monospace" | "Handwriting";
  weights: number[];
  italics: boolean;
}

export const FONT_CATALOG: FontDef[] = [
  { family: "Inter", category: "Sans Serif", weights: [400, 500, 600, 700], italics: true },
  { family: "Montserrat", category: "Sans Serif", weights: [400, 700], italics: true },
  { family: "DM Sans", category: "Sans Serif", weights: [400, 700], italics: true },
  { family: "Playfair Display", category: "Serif", weights: [400, 700], italics: true },
  { family: "Lora", category: "Serif", weights: [400, 700], italics: true },
  { family: "Bebas Neue", category: "Display", weights: [400], italics: false },
  { family: "Space Mono", category: "Monospace", weights: [400, 700], italics: true },
  { family: "Caveat", category: "Handwriting", weights: [400, 700], italics: false },
];

export const FONT_FALLBACK = "Helvetica, Arial, sans-serif";

export function getFont(family: string): FontDef | undefined {
  return FONT_CATALOG.find((f) => f.family === family);
}

/** Closest available weight, so a font switch never produces faux bold. */
export function resolveWeight(family: string, weight: number): number {
  const def = getFont(family);
  if (!def) return weight;
  return def.weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), def.weights[0]);
}

export function resolveItalic(family: string, italic: boolean): boolean {
  const def = getFont(family);
  return def ? italic && def.italics : italic;
}

export interface FontFaceRequest {
  family: string;
  weight: number;
  italic: boolean;
}

export function fontShorthand(f: FontFaceRequest, size = 16) {
  return `${f.italic ? "italic " : ""}${f.weight} ${size}px "${f.family}"`;
}

/** Wait until every requested face is usable by canvas text. Never rejects. */
export async function ensureFontsLoaded(requests: FontFaceRequest[]): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const unique = new Map<string, FontFaceRequest>();
  for (const r of requests) unique.set(fontShorthand(r), r);
  await Promise.all(
    [...unique.keys()].map((shorthand) =>
      document.fonts.load(shorthand, "AaBbGg123").catch(() => undefined),
    ),
  );
}
