/**
 * Pure, immutable document operations. Every editor action goes through one of
 * these, which keeps undo/redo (snapshot based) and tests simple.
 */
import { createId } from "./ids";
import { createSlide } from "./factory";
import { PANORAMA_ID } from "./geometry";
import { splitClip } from "./timing";
import { MAX_SLIDE_SECONDS, MAX_SLIDES, type AssetRef, type AudioTrack, type Background, type DesignElement, type Project, type Slide } from "./schema";

type Container = { background: Background; elements: DesignElement[] };

function mapContainer(project: Project, surfaceId: string, fn: (c: Container) => Container): Project {
  if (surfaceId === PANORAMA_ID) {
    const next = fn(project.panorama);
    return next === project.panorama ? project : { ...project, panorama: { ...project.panorama, ...next } };
  }
  let changed = false;
  const slides = project.slides.map((s) => {
    if (s.id !== surfaceId) return s;
    const next = fn(s);
    if (next === s) return s;
    changed = true;
    return { ...s, ...next };
  });
  return changed ? { ...project, slides } : project;
}

export function getElements(project: Project, surfaceId: string): DesignElement[] {
  if (surfaceId === PANORAMA_ID) return project.panorama.elements;
  return project.slides.find((s) => s.id === surfaceId)?.elements ?? [];
}

export function addElements(project: Project, surfaceId: string, elements: DesignElement[]): Project {
  if (elements.length === 0) return project;
  return mapContainer(project, surfaceId, (c) => ({ ...c, elements: [...c.elements, ...elements] }));
}

export function updateElements(
  project: Project,
  surfaceId: string,
  ids: string[],
  patch: Partial<DesignElement> | ((el: DesignElement) => Partial<DesignElement>),
): Project {
  const set = new Set(ids);
  return mapContainer(project, surfaceId, (c) => {
    let changed = false;
    const elements = c.elements.map((el) => {
      if (!set.has(el.id)) return el;
      const p = typeof patch === "function" ? patch(el) : patch;
      changed = true;
      // id and type are identity: a patch may never change them.
      return { ...el, ...p, id: el.id, type: el.type } as DesignElement;
    });
    return changed ? { ...c, elements } : c;
  });
}

export function removeElements(project: Project, surfaceId: string, ids: string[]): Project {
  const set = new Set(ids);
  return mapContainer(project, surfaceId, (c) => {
    const elements = c.elements.filter((el) => !set.has(el.id));
    return elements.length === c.elements.length ? c : { ...c, elements };
  });
}

/** Clone elements with fresh ids. Used by duplicate and paste. */
export function cloneElements(elements: DesignElement[], offset = 0): DesignElement[] {
  return elements.map((el) => ({ ...el, id: createId(), x: el.x + offset, y: el.y + offset }));
}

export function duplicateElements(project: Project, surfaceId: string, ids: string[], offset = 24) {
  const set = new Set(ids);
  const source = getElements(project, surfaceId).filter((el) => set.has(el.id));
  const copies = cloneElements(source, offset).map((el) => ({ ...el, locked: false }));
  return { project: addElements(project, surfaceId, copies), newIds: copies.map((c) => c.id) };
}

/**
 * Cut a video clip in two at a slide time. The second half is a copy that starts where the
 * first one ends and sits directly above it. Returns the new element's id, or null when the
 * time is not inside the clip.
 */
export function splitVideo(project: Project, surfaceId: string, id: string, slideTime: number, newId = createId()) {
  const elements = getElements(project, surfaceId);
  const index = elements.findIndex((el) => el.id === id);
  const el = elements[index];
  const cut = el?.type === "video" ? splitClip(el, slideTime) : null;
  if (!el || el.type !== "video" || !cut) return { project, newId: null };
  const first = { ...el, ...cut.first };
  const second = { ...el, ...cut.second, id: newId, name: `${el.name} (2)` };
  const next = mapContainer(project, surfaceId, (c) => ({ ...c, elements: [...c.elements.slice(0, index), first, second, ...c.elements.slice(index + 1)] }));
  return { project: next, newId };
}

/** Set a slide's length in seconds, or pass undefined to follow its clips again. */
export function setSlideDuration(project: Project, slideId: string, duration: number | undefined): Project {
  const slides = project.slides.map((s) => {
    if (s.id !== slideId || s.duration === duration) return s;
    const { duration: _old, ...rest } = s;
    void _old;
    return duration === undefined ? rest : { ...rest, duration: Math.min(Math.max(duration, 0.1), MAX_SLIDE_SECONDS) };
  });
  return slides.some((s, i) => s !== project.slides[i]) ? { ...project, slides } : project;
}

/** Set, change or (with undefined) remove a slide's background music. */
export function setSlideAudio(project: Project, slideId: string, audio: AudioTrack | undefined): Project {
  let changed = false;
  const slides = project.slides.map((s) => {
    if (s.id !== slideId || s.audio === audio) return s;
    changed = true;
    const { audio: _old, ...rest } = s;
    void _old;
    return audio ? { ...rest, audio } : rest;
  });
  return changed ? { ...project, slides } : project;
}

export type ReorderDirection = "forward" | "backward" | "front" | "back";

export function reorderElement(project: Project, surfaceId: string, id: string, direction: ReorderDirection): Project {
  const els = getElements(project, surfaceId);
  const from = els.findIndex((el) => el.id === id);
  if (from < 0) return project;
  const last = els.length - 1;
  const to = { forward: Math.min(from + 1, last), backward: Math.max(from - 1, 0), front: last, back: 0 }[direction];
  return moveElementToIndex(project, surfaceId, id, to);
}

export function moveElementToIndex(project: Project, surfaceId: string, id: string, to: number): Project {
  return mapContainer(project, surfaceId, (c) => {
    const from = c.elements.findIndex((el) => el.id === id);
    const target = Math.max(0, Math.min(to, c.elements.length - 1));
    if (from < 0 || from === target) return c;
    const elements = c.elements.slice();
    const [moved] = elements.splice(from, 1);
    elements.splice(target, 0, moved);
    return { ...c, elements };
  });
}

export function setBackground(project: Project, surfaceId: string, background: Background): Project {
  return mapContainer(project, surfaceId, (c) => ({ ...c, background }));
}

// --- Slides ---------------------------------------------------------------

export function addSlide(project: Project, atIndex = project.slides.length): { project: Project; slide: Slide | null } {
  if (project.slides.length >= MAX_SLIDES) return { project, slide: null };
  const slide = createSlide(project.slides.length);
  const slides = project.slides.slice();
  slides.splice(Math.max(0, Math.min(atIndex, slides.length)), 0, slide);
  return { project: { ...project, slides }, slide };
}

export function removeSlide(project: Project, slideId: string): Project {
  if (project.slides.length <= 1) return project;
  const slides = project.slides.filter((s) => s.id !== slideId);
  return slides.length === project.slides.length ? project : { ...project, slides };
}

export function duplicateSlide(project: Project, slideId: string): { project: Project; slide: Slide | null } {
  const index = project.slides.findIndex((s) => s.id === slideId);
  if (index < 0 || project.slides.length >= MAX_SLIDES) return { project, slide: null };
  const source = project.slides[index];
  const slide: Slide = {
    ...source,
    id: createId(),
    name: `${source.name} copy`,
    elements: cloneElements(source.elements),
  };
  const slides = project.slides.slice();
  slides.splice(index + 1, 0, slide);
  return { project: { ...project, slides }, slide };
}

export function moveSlide(project: Project, slideId: string, toIndex: number): Project {
  const from = project.slides.findIndex((s) => s.id === slideId);
  const to = Math.max(0, Math.min(toIndex, project.slides.length - 1));
  if (from < 0 || from === to) return project;
  const slides = project.slides.slice();
  const [moved] = slides.splice(from, 1);
  slides.splice(to, 0, moved);
  return { ...project, slides };
}

export function renameSlide(project: Project, slideId: string, name: string): Project {
  return {
    ...project,
    slides: project.slides.map((s) => (s.id === slideId ? { ...s, name: name.trim() || s.name } : s)),
  };
}

export function renameProject(project: Project, name: string): Project {
  const next = name.trim();
  return next && next !== project.name ? { ...project, name: next } : project;
}

// --- Assets ---------------------------------------------------------------

export function addAssetRef(project: Project, asset: AssetRef): Project {
  if (project.assets.some((a) => a.id === asset.id)) return project;
  return { ...project, assets: [...project.assets, asset] };
}

/** Every asset id that is referenced by at least one element. */
export function usedAssetIds(project: Project): Set<string> {
  const ids = new Set<string>();
  const scan = (els: DesignElement[]) => {
    for (const el of els) if ((el.type === "image" || el.type === "video") && el.assetId) ids.add(el.assetId);
  };
  scan(project.panorama.elements);
  project.slides.forEach((s) => {
    scan(s.elements);
    if (s.audio) ids.add(s.audio.assetId);
  });
  return ids;
}

/** Deep copy with new project, slide and element ids. Asset ids are shared on purpose. */
export function cloneProject(project: Project, name: string, now = new Date()): Project {
  const iso = now.toISOString();
  return {
    ...project,
    id: createId(),
    name,
    slides: project.slides.map((s) => ({ ...s, id: createId(), elements: cloneElements(s.elements) })),
    panorama: { ...project.panorama, elements: cloneElements(project.panorama.elements) },
    createdAt: iso,
    updatedAt: iso,
  };
}

/** Number of photo placeholders that still have no image. */
export function countPlaceholders(project: Project): number {
  const count = (els: DesignElement[]) => els.filter((el) => el.type === "image" && !el.assetId).length;
  return project.mode === "seamless"
    ? count(project.panorama.elements)
    : project.slides.reduce((n, s) => n + count(s.elements), 0);
}

/** Number of video layers that end up in an export. */
export function countVideos(project: Project): number {
  const count = (els: DesignElement[]) => els.filter((el) => el.type === "video" && el.visible).length;
  return project.mode === "seamless"
    ? count(project.panorama.elements)
    : project.slides.reduce((n, s) => n + count(s.elements), 0);
}
