/** Pure rules for the template library: categories, cleaning of user input, filtering. */
import { aspectRatioLabel } from "@/document/geometry";
import type { Project } from "@/document/schema";

export const MY_TEMPLATES = "My templates";

/** Categories a user template can be filed under (SPEC 11). Built-in templates use the same names. */
export const TEMPLATE_CATEGORIES = [
  MY_TEMPLATES,
  "Photo Journal",
  "Aesthetic",
  "Minimal",
  "Editorial",
  "Travel",
  "Food",
  "Fashion",
  "Photography",
  "Business",
  "Education",
  "Quotes",
  "Product",
  "Event",
  "Portfolio",
  "Announcement",
  "Tutorial",
  "Lifestyle",
] as const;

export const MAX_TEMPLATE_NAME = 80;
export const MAX_TEMPLATE_DESCRIPTION = 300;
export const MAX_TEMPLATE_CATEGORY = 40;

export const cleanTemplateName = (name: string, fallback = "Untitled template") => name.trim().replace(/\s+/g, " ").slice(0, MAX_TEMPLATE_NAME) || fallback;
export const cleanTemplateCategory = (category: string) => category.trim().replace(/\s+/g, " ").slice(0, MAX_TEMPLATE_CATEGORY) || MY_TEMPLATES;
export const cleanTemplateDescription = (text: string) => text.trim().slice(0, MAX_TEMPLATE_DESCRIPTION);

export type SlideCountFilter = "" | "1-3" | "4-6" | "7+";

export interface TemplateFilter {
  query: string;
  category: string;
  ratio: string;
  count: SlideCountFilter;
  favoritesOnly: boolean;
  source: "" | "user" | "builtin";
}
export const DEFAULT_TEMPLATE_FILTER: TemplateFilter = { query: "", category: "", ratio: "", count: "", favoritesOnly: false, source: "" };

interface Filterable {
  id: string;
  name: string;
  category: string;
  description?: string;
  source: "builtin" | "user";
  doc: Pick<Project, "width" | "height" | "slides">;
}

export function matchesSlideCount(n: number, filter: SlideCountFilter): boolean {
  return filter === "" || (filter === "1-3" ? n <= 3 : filter === "4-6" ? n >= 4 && n <= 6 : n >= 7);
}

/** Filter, then put recently used templates first (most recent first); the rest keeps its order. */
export function filterTemplates<T extends Filterable>(templates: T[], filter: TemplateFilter, favorites: string[], recents: string[]): T[] {
  const q = filter.query.trim().toLowerCase();
  const list = templates.filter(
    (t) =>
      (!q || t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q)) &&
      (!filter.category || t.category === filter.category) &&
      (!filter.ratio || aspectRatioLabel(t.doc.width, t.doc.height) === filter.ratio) &&
      matchesSlideCount(t.doc.slides.length, filter.count) &&
      (!filter.favoritesOnly || favorites.includes(t.id)) &&
      (!filter.source || t.source === filter.source),
  );
  const rank = (t: T) => (recents.includes(t.id) ? recents.indexOf(t.id) : Number.MAX_SAFE_INTEGER);
  return list
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
    .map((x) => x.t);
}

/** Photo frames in a template: how many are empty (waiting for the user's photos) and how many still hold a photo. */
export function countFrames(doc: Pick<Project, "slides" | "panorama">): { empty: number; filled: number } {
  let empty = 0;
  let filled = 0;
  for (const container of [...doc.slides, doc.panorama])
    for (const el of container.elements)
      if (el.type === "image") {
        if (el.assetId) filled += 1;
        else empty += 1;
      }
  return { empty, filled };
}

/** Every photo becomes an empty frame; asset references nothing uses any more are dropped. */
export function stripPhotos<T extends Pick<Project, "slides" | "panorama" | "assets">>(doc: T): T {
  const strip = <C extends { elements: Project["slides"][number]["elements"] }>(c: C): C => ({
    ...c,
    elements: c.elements.map((el) => (el.type === "image" && el.assetId ? { ...el, assetId: null, crop: undefined } : el)),
  });
  const slides = doc.slides.map(strip);
  const panorama = strip(doc.panorama);
  const used = new Set<string>();
  for (const c of [...slides, panorama]) {
    for (const el of c.elements) if ("assetId" in el && el.assetId) used.add(el.assetId);
    const audio = (c as { audio?: { assetId: string } | null }).audio;
    if (audio) used.add(audio.assetId);
  }
  return { ...doc, slides, panorama, assets: doc.assets.filter((a) => used.has(a.id)) };
}
