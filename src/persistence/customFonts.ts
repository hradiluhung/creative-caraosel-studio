/**
 * Custom font upload. Files are validated, stored in IndexedDB and registered through the
 * FontFace API. On every app start loadCustomFonts() re-registers them, which is what makes
 * uploaded fonts survive restarts of the PWA. Fonts are only available inside this app:
 * a web app cannot install fonts system-wide (on iOS or anywhere else).
 */
import { createId } from "@/document/ids";
import { BUILT_IN_FONTS, setCustomFontDefs, type FontDef } from "@/render/fonts";
import { deleteStoredFont, listStoredFonts, putStoredFont, type StoredFont } from "./db";

export const FONT_ACCEPT_ATTR = ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2,application/font-sfnt,application/x-font-ttf,application/x-font-otf";
export const MAX_FONT_BYTES = 12 * 1024 * 1024;

export type FontFormat = "ttf" | "otf" | "woff" | "woff2";

/** Identify a font by its file signature, never by its extension. */
export function sniffFontFormat(bytes: Uint8Array): FontFormat | "collection" | null {
  if (bytes.length < 4) return null;
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (tag === "wOFF") return "woff";
  if (tag === "wOF2") return "woff2";
  if (tag === "OTTO") return "otf";
  if (tag === "ttcf") return "collection";
  if (tag === "true" || tag === "typ1") return "ttf";
  if (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) return "ttf";
  return null;
}

const WEIGHT_WORDS: Array<[RegExp, number]> = [
  [/(extra|ultra)[\s_-]*light/i, 200],
  [/(extra|ultra)[\s_-]*bold/i, 800],
  [/(semi|demi)[\s_-]*bold/i, 600],
  [/thin|hairline/i, 100],
  [/light/i, 300],
  [/medium/i, 500],
  [/black|heavy/i, 900],
  [/bold/i, 700],
  [/regular|normal|book|roman/i, 400],
];

/** Best guess of family, weight and style from a file name like "Acme-Sans_SemiBoldItalic.ttf". */
export function guessFontMeta(fileName: string): { family: string; weight: number; italic: boolean } {
  let base = fileName.replace(/\.[^.]+$/, "");
  const italic = /italic|oblique/i.test(base);
  base = base.replace(/italic|oblique/gi, "");
  let weight = 400;
  for (const [re, w] of WEIGHT_WORDS) {
    if (re.test(base)) {
      weight = w;
      base = base.replace(re, "");
      break;
    }
  }
  const family = base
    .replace(/variable|\[.*?\]/gi, "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return { family: family || "Custom font", weight, italic };
}

const faces = new Map<string, FontFace>();

async function register(font: StoredFont): Promise<void> {
  const face = new FontFace(font.family, await font.blob.arrayBuffer(), {
    weight: String(font.weight),
    style: font.italic ? "italic" : "normal",
  });
  await face.load(); // rejects for corrupted or unsupported files
  const old = faces.get(font.id);
  if (old) document.fonts.delete(old);
  document.fonts.add(face);
  faces.set(font.id, face);
}

function publish(fonts: StoredFont[]) {
  const byFamily = new Map<string, FontDef>();
  for (const f of fonts) {
    if (!faces.has(f.id)) continue;
    const def = byFamily.get(f.family) ?? { family: f.family, label: f.label, category: "Custom" as const, weights: [], italics: false, custom: true };
    if (!def.weights.includes(f.weight)) def.weights.push(f.weight);
    def.italics = def.italics || f.italic;
    byFamily.set(f.family, def);
  }
  const defs = [...byFamily.values()];
  defs.forEach((d) => d.weights.sort((a, b) => a - b));
  setCustomFontDefs(defs.sort((a, b) => a.label.localeCompare(b.label)));
}

let loaded: Promise<void> | null = null;

/** Register every stored font. Safe to call many times; work happens once. */
export function loadCustomFonts(): Promise<void> {
  loaded ??= (async () => {
    try {
      const fonts = await listStoredFonts();
      await Promise.all(fonts.map((f) => register(f).catch(() => undefined)));
      publish(fonts);
    } catch {
      /* storage unavailable: built-in fonts still work */
    }
  })();
  return loaded;
}

export interface FontImportResult {
  added: StoredFont[];
  errors: string[];
}

export async function importFontFiles(files: Iterable<File>): Promise<FontImportResult> {
  await loadCustomFonts();
  const existing = await listStoredFonts();
  const result: FontImportResult = { added: [], errors: [] };
  const reserved = new Set(BUILT_IN_FONTS.map((f) => f.family.toLowerCase()));
  for (const file of files) {
    try {
      if (file.size > MAX_FONT_BYTES) throw new Error(`is larger than ${MAX_FONT_BYTES / 1024 / 1024} MB`);
      const format = sniffFontFormat(new Uint8Array(await file.slice(0, 4).arrayBuffer()));
      if (format === "collection") throw new Error("is a font collection (.ttc), which browsers cannot load. Upload single font files");
      if (!format) throw new Error("is not a TTF, OTF, WOFF or WOFF2 font");
      const meta = guessFontMeta(file.name);
      // A custom family must not shadow a built-in one, or documents would become ambiguous.
      const family = reserved.has(meta.family.toLowerCase()) ? `${meta.family} (Custom)` : meta.family;
      const all = [...existing, ...result.added];
      if (all.some((f) => f.family === family && f.weight === meta.weight && f.italic === meta.italic)) {
        throw new Error("is already in your library with the same weight and style");
      }
      const font: StoredFont = {
        id: createId(),
        family,
        label: all.find((f) => f.family === family)?.label ?? family,
        weight: meta.weight,
        italic: meta.italic,
        fileName: file.name,
        format,
        size: file.size,
        blob: file.slice(0, file.size),
        createdAt: new Date().toISOString(),
      };
      try {
        await register(font);
      } catch {
        throw new Error("could not be read by this browser. The file may be corrupted");
      }
      await putStoredFont(font);
      result.added.push(font);
    } catch (e) {
      result.errors.push(`"${file.name}" ${e instanceof Error ? e.message : "could not be imported"}.`);
    }
  }
  publish([...existing, ...result.added]);
  return result;
}

/** Change the mapping of one file (weight / style) or rename its whole family in the UI. */
export async function updateCustomFont(id: string, patch: { label?: string; weight?: number; italic?: boolean }): Promise<void> {
  const fonts = await listStoredFonts();
  const target = fonts.find((f) => f.id === id);
  if (!target) return;
  const label = patch.label?.trim();
  for (const f of fonts) {
    if (f.family !== target.family) continue;
    let changed = false;
    if (label && label !== f.label) {
      f.label = label;
      changed = true;
    }
    if (f.id === id && ((patch.weight !== undefined && patch.weight !== f.weight) || (patch.italic !== undefined && patch.italic !== f.italic))) {
      f.weight = patch.weight ?? f.weight;
      f.italic = patch.italic ?? f.italic;
      await register(f);
      changed = true;
    }
    if (changed) await putStoredFont(f);
  }
  publish(fonts);
}

export async function deleteCustomFont(id: string): Promise<void> {
  const face = faces.get(id);
  if (face) document.fonts.delete(face);
  faces.delete(id);
  await deleteStoredFont(id);
  publish(await listStoredFonts());
}

export { listStoredFonts as listCustomFontFiles };
