/**
 * Font registry shared by the editor and the exporter.
 * Built-in faces are self-hosted through @fontsource (all SIL Open Font License), so they
 * work offline. Custom fonts uploaded by the user are registered at runtime through the
 * FontFace API (src/persistence/customFonts.ts) and appear in the same catalog, which is
 * what guarantees that preview and export resolve exactly the same faces.
 */
export type FontCategory =
  | "Sans Serif"
  | "Serif"
  | "Display"
  | "Editorial"
  | "Monospace"
  | "Handwriting"
  | "Script"
  | "Retro"
  | "Custom";

export interface FontDef {
  /** Stable CSS family name stored in documents. Never changes once in use. */
  family: string;
  /** Name shown in the UI (custom fonts can be renamed without breaking documents). */
  label: string;
  category: FontCategory;
  weights: number[];
  italics: boolean;
  custom: boolean;
}

/** Keep in sync with src/app/fonts.css. */
export const BUILT_IN_FONTS: FontDef[] = [
  { family: "Inter", label: "Inter", category: "Sans Serif", weights: [400, 500, 600, 700], italics: true, custom: false },
  { family: "Montserrat", label: "Montserrat", category: "Sans Serif", weights: [400, 700], italics: true, custom: false },
  { family: "Poppins", label: "Poppins", category: "Sans Serif", weights: [400, 600, 700], italics: true, custom: false },
  { family: "Manrope", label: "Manrope", category: "Sans Serif", weights: [400, 700], italics: false, custom: false },
  { family: "Outfit", label: "Outfit", category: "Sans Serif", weights: [400, 700], italics: false, custom: false },
  { family: "Sora", label: "Sora", category: "Sans Serif", weights: [400, 700], italics: false, custom: false },
  { family: "DM Sans", label: "DM Sans", category: "Sans Serif", weights: [400, 700], italics: true, custom: false },
  { family: "Playfair Display", label: "Playfair Display", category: "Serif", weights: [400, 700], italics: true, custom: false },
  { family: "Cormorant Garamond", label: "Cormorant Garamond", category: "Serif", weights: [400, 700], italics: true, custom: false },
  { family: "Lora", label: "Lora", category: "Serif", weights: [400, 700], italics: true, custom: false },
  { family: "Libre Baskerville", label: "Libre Baskerville", category: "Serif", weights: [400, 700], italics: true, custom: false },
  { family: "DM Serif Display", label: "DM Serif Display", category: "Serif", weights: [400], italics: true, custom: false },
  { family: "Bebas Neue", label: "Bebas Neue", category: "Display", weights: [400], italics: false, custom: false },
  { family: "Anton", label: "Anton", category: "Display", weights: [400], italics: false, custom: false },
  { family: "Oswald", label: "Oswald", category: "Display", weights: [400, 700], italics: false, custom: false },
  { family: "Abril Fatface", label: "Abril Fatface", category: "Display", weights: [400], italics: false, custom: false },
  { family: "Bodoni Moda", label: "Bodoni Moda", category: "Editorial", weights: [400, 700], italics: true, custom: false },
  { family: "Instrument Serif", label: "Instrument Serif", category: "Editorial", weights: [400], italics: true, custom: false },
  { family: "Prata", label: "Prata", category: "Editorial", weights: [400], italics: false, custom: false },
  { family: "Roboto Mono", label: "Roboto Mono", category: "Monospace", weights: [400, 700], italics: true, custom: false },
  { family: "Space Mono", label: "Space Mono", category: "Monospace", weights: [400, 700], italics: true, custom: false },
  { family: "IBM Plex Mono", label: "IBM Plex Mono", category: "Monospace", weights: [400, 700], italics: true, custom: false },
  { family: "Caveat", label: "Caveat", category: "Handwriting", weights: [400, 700], italics: false, custom: false },
  { family: "Dancing Script", label: "Dancing Script", category: "Handwriting", weights: [400, 700], italics: false, custom: false },
  { family: "Kalam", label: "Kalam", category: "Handwriting", weights: [400, 700], italics: false, custom: false },
  { family: "Pacifico", label: "Pacifico", category: "Script", weights: [400], italics: false, custom: false },
  { family: "Great Vibes", label: "Great Vibes", category: "Script", weights: [400], italics: false, custom: false },
  { family: "Special Elite", label: "Special Elite", category: "Retro", weights: [400], italics: false, custom: false },
];

export const FONT_CATEGORIES: FontCategory[] = ["Sans Serif", "Serif", "Display", "Editorial", "Monospace", "Handwriting", "Script", "Retro", "Custom"];

let catalog: FontDef[] = BUILT_IN_FONTS;
const listeners = new Set<() => void>();

export function getFontCatalog(): FontDef[] {
  return catalog;
}

/** Called by the custom font store whenever uploaded fonts change. */
export function setCustomFontDefs(defs: FontDef[]) {
  catalog = [...BUILT_IN_FONTS, ...defs];
  listeners.forEach((l) => l());
}

export function subscribeFonts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const FONT_FALLBACK = "Helvetica, Arial, sans-serif";

export function getFont(family: string): FontDef | undefined {
  return catalog.find((f) => f.family === family);
}

export function fontLabel(family: string): string {
  return getFont(family)?.label ?? family;
}

/** Closest available weight, so a font switch never produces faux bold. */
export function resolveWeight(family: string, weight: number): number {
  const def = getFont(family);
  if (!def || def.weights.length === 0) return weight;
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
