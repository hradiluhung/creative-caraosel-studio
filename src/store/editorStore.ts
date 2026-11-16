/**
 * Editor session state. The document itself is only ever changed through
 * commit(), which records an undo snapshot. Snapshots are cheap because all
 * document operations are immutable and share unchanged structure.
 */
import { create } from "zustand";
import { getSurface, getSurfaces, PANORAMA_ID } from "@/document/geometry";
import * as ops from "@/document/operations";
import type { DesignElement, Project } from "@/document/schema";
import type { BrandKit } from "@/persistence/db";

export type SaveStatus = "saved" | "dirty" | "saving" | "error";
/** stopped: videos show their poster frame. paused: they hold the frame at the playhead. */
export type PlaybackState = "stopped" | "playing" | "paused";

const HISTORY_LIMIT = 100;
const COALESCE_WINDOW_MS = 800;

interface CommitOptions {
  /** Consecutive commits with the same key (slider drags, typing) merge into one undo step. */
  coalesce?: string;
}

export interface EditorState {
  project: Project | null;
  past: Project[];
  future: Project[];
  lastCommit: { key: string; time: number } | null;
  activeSurfaceId: string;
  /** Slide the user is looking at. In seamless mode new elements land on this slide. */
  focusSlideIndex: number;
  selection: string[];
  clipboard: DesignElement[];
  saveStatus: SaveStatus;
  saveError: string | null;
  zoom: number;
  editingTextId: string | null;
  /** Brand kit attached to the open project (colors, fonts and logos offered in the panels). */
  brandKit: BrandKit | null;
  setBrandKit(kit: BrandKit | null): void;
  /** Video preview of the active surface. Session state only: it is never part of the document. */
  playback: PlaybackState;
  /** Slide time in seconds (updated a few times per second while playing). */
  playhead: number;
  /** Something the device could not do during playback, shown next to the play button. */
  playbackNotice: string | null;
  setPlayback(state: PlaybackState, playhead?: number): void;
  setPlayhead(seconds: number): void;
  setPlaybackNotice(notice: string | null): void;

  open(project: Project): void;
  close(): void;
  commit(fn: (p: Project) => Project, opts?: CommitOptions): void;
  undo(): void;
  redo(): void;

  select(ids: string[]): void;
  toggleSelect(id: string): void;
  setActiveSurface(id: string): void;
  setFocusSlide(index: number): void;
  setZoom(zoom: number): void;
  setEditingText(id: string | null): void;
  setSaveStatus(status: SaveStatus, error?: string | null): void;

  addElement(el: DesignElement): void;
  updateSelected(patch: Partial<DesignElement>, coalesce?: string): void;
  updateElement(id: string, patch: Partial<DesignElement>, coalesce?: string): void;
  deleteSelected(): void;
  duplicateSelected(): void;
  copySelected(): void;
  paste(): void;
  reorder(id: string, direction: ops.ReorderDirection): void;
  nudgeSelected(dx: number, dy: number): void;

  addSlide(): void;
  removeSlide(slideId: string): void;
  duplicateSlide(slideId: string): void;
  moveSlide(slideId: string, toIndex: number): void;
}

/** Keep session pointers valid after the document changed underneath them. */
function reconcile(project: Project, activeSurfaceId: string, selection: string[], focusSlideIndex: number) {
  const surfaces = getSurfaces(project);
  const surface = surfaces.find((s) => s.id === activeSurfaceId) ?? surfaces[Math.min(focusSlideIndex, surfaces.length - 1)] ?? surfaces[0];
  const ids = new Set(surface.elements.map((e) => e.id));
  const focus = project.mode === "seamless"
    ? Math.min(focusSlideIndex, project.slides.length - 1)
    : Math.max(0, project.slides.findIndex((s) => s.id === surface.id));
  return { activeSurfaceId: surface.id, selection: selection.filter((id) => ids.has(id)), focusSlideIndex: focus };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  project: null,
  past: [],
  future: [],
  lastCommit: null,
  activeSurfaceId: PANORAMA_ID,
  focusSlideIndex: 0,
  selection: [],
  clipboard: [],
  saveStatus: "saved",
  saveError: null,
  zoom: 1,
  editingTextId: null,
  brandKit: null,
  setBrandKit(kit) {
    set({ brandKit: kit });
  },
  playback: "stopped",
  playhead: 0,
  playbackNotice: null,
  setPlayback(state, playhead) {
    set({ playback: state, playhead: state === "stopped" ? 0 : (playhead ?? get().playhead) });
  },
  setPlayhead(seconds) {
    if (seconds !== get().playhead) set({ playhead: seconds });
  },
  setPlaybackNotice(notice) {
    set({ playbackNotice: notice });
  },

  open(project) {
    set({
      project,
      past: [],
      future: [],
      lastCommit: null,
      activeSurfaceId: getSurfaces(project)[0].id,
      focusSlideIndex: 0,
      selection: [],
      saveStatus: "saved",
      saveError: null,
      editingTextId: null,
      playback: "stopped",
      playhead: 0,
      playbackNotice: null,
    });
  },

  close() {
    set({ project: null, past: [], future: [], selection: [], editingTextId: null, lastCommit: null, brandKit: null, playback: "stopped", playhead: 0 });
  },

  commit(fn, opts) {
    const s = get();
    if (!s.project) return;
    const changed = fn(s.project);
    if (changed === s.project) return;
    const now = Date.now();
    const next = { ...changed, updatedAt: new Date(now).toISOString() };
    const merge =
      !!opts?.coalesce && s.lastCommit?.key === opts.coalesce && now - s.lastCommit.time < COALESCE_WINDOW_MS && s.past.length > 0;
    set({
      project: next,
      past: merge ? s.past : [...s.past, s.project].slice(-HISTORY_LIMIT),
      future: [],
      lastCommit: opts?.coalesce ? { key: opts.coalesce, time: now } : null,
      saveStatus: "dirty",
      ...reconcile(next, s.activeSurfaceId, s.selection, s.focusSlideIndex),
    });
  },

  undo() {
    const s = get();
    if (!s.project || s.past.length === 0) return;
    const previous = s.past[s.past.length - 1];
    set({
      project: previous,
      past: s.past.slice(0, -1),
      future: [s.project, ...s.future],
      lastCommit: null,
      saveStatus: "dirty",
      editingTextId: null,
      ...reconcile(previous, s.activeSurfaceId, s.selection, s.focusSlideIndex),
    });
  },

  redo() {
    const s = get();
    if (!s.project || s.future.length === 0) return;
    const next = s.future[0];
    set({
      project: next,
      past: [...s.past, s.project],
      future: s.future.slice(1),
      lastCommit: null,
      saveStatus: "dirty",
      editingTextId: null,
      ...reconcile(next, s.activeSurfaceId, s.selection, s.focusSlideIndex),
    });
  },

  select(ids) {
    const cur = get().selection;
    if (cur.length === ids.length && cur.every((id, i) => id === ids[i])) return;
    set({ selection: ids });
  },
  toggleSelect(id) {
    const cur = get().selection;
    set({ selection: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  },
  setActiveSurface(id) {
    const s = get();
    if (!s.project || !getSurface(s.project, id)) return;
    const index = s.project.slides.findIndex((sl) => sl.id === id);
    set({
      activeSurfaceId: id,
      selection: [],
      editingTextId: null,
      focusSlideIndex: index >= 0 ? index : s.focusSlideIndex,
      // Playback belongs to one surface: leaving it stops it.
      ...(id !== s.activeSurfaceId ? { playback: "stopped" as const, playhead: 0 } : {}),
    });
  },
  setFocusSlide(index) {
    const p = get().project;
    if (!p) return;
    set({ focusSlideIndex: Math.max(0, Math.min(index, p.slides.length - 1)) });
  },
  setZoom(zoom) {
    if (Math.abs(zoom - get().zoom) > 0.0005) set({ zoom });
  },
  setEditingText(id) {
    set({ editingTextId: id });
  },
  setSaveStatus(status, error = null) {
    set({ saveStatus: status, saveError: error });
  },

  addElement(el) {
    const { activeSurfaceId, commit } = get();
    commit((p) => ops.addElements(p, activeSurfaceId, [el]));
    set({ selection: [el.id] });
  },
  updateSelected(patch, coalesce) {
    const { activeSurfaceId, selection, commit } = get();
    if (selection.length === 0) return;
    commit((p) => ops.updateElements(p, activeSurfaceId, selection, patch), coalesce ? { coalesce: `${coalesce}:${selection.join(",")}` } : undefined);
  },
  updateElement(id, patch, coalesce) {
    const { activeSurfaceId, commit } = get();
    commit((p) => ops.updateElements(p, activeSurfaceId, [id], patch), coalesce ? { coalesce: `${coalesce}:${id}` } : undefined);
  },
  deleteSelected() {
    const { activeSurfaceId, selection, commit } = get();
    if (selection.length === 0) return;
    commit((p) => ops.removeElements(p, activeSurfaceId, selection));
  },
  duplicateSelected() {
    const s = get();
    if (!s.project || s.selection.length === 0) return;
    const result = ops.duplicateElements(s.project, s.activeSurfaceId, s.selection);
    s.commit(() => result.project);
    set({ selection: result.newIds });
  },
  copySelected() {
    const s = get();
    if (!s.project) return;
    const set_ = new Set(s.selection);
    const els = ops.getElements(s.project, s.activeSurfaceId).filter((e) => set_.has(e.id));
    if (els.length > 0) set({ clipboard: els });
  },
  paste() {
    const s = get();
    if (!s.project || s.clipboard.length === 0) return;
    const copies = ops.cloneElements(s.clipboard, 24).map((e) => ({ ...e, locked: false }));
    s.commit((p) => ops.addElements(p, s.activeSurfaceId, copies));
    // Pasting again keeps cascading instead of stacking on the same spot.
    set({ selection: copies.map((c) => c.id), clipboard: copies });
  },
  reorder(id, direction) {
    const { activeSurfaceId, commit } = get();
    commit((p) => ops.reorderElement(p, activeSurfaceId, id, direction));
  },
  nudgeSelected(dx, dy) {
    const { activeSurfaceId, selection, commit } = get();
    if (selection.length === 0) return;
    commit(
      (p) => ops.updateElements(p, activeSurfaceId, selection, (el) => (el.locked ? {} : { x: el.x + dx, y: el.y + dy })),
      { coalesce: `nudge:${selection.join(",")}` },
    );
  },

  addSlide() {
    const s = get();
    if (!s.project) return;
    const at = s.project.mode === "seamless" ? s.project.slides.length : s.focusSlideIndex + 1;
    const result = ops.addSlide(s.project, at);
    if (!result.slide) return;
    s.commit(() => result.project);
    if (s.project.mode === "independent") get().setActiveSurface(result.slide.id);
    else set({ focusSlideIndex: at });
  },
  removeSlide(slideId) {
    get().commit((p) => ops.removeSlide(p, slideId));
  },
  duplicateSlide(slideId) {
    const s = get();
    if (!s.project) return;
    const result = ops.duplicateSlide(s.project, slideId);
    if (!result.slide) return;
    s.commit(() => result.project);
    if (s.project.mode === "independent") get().setActiveSurface(result.slide.id);
  },
  moveSlide(slideId, toIndex) {
    get().commit((p) => ops.moveSlide(p, slideId, toIndex));
    const p = get().project;
    if (p && p.mode === "independent") {
      const idx = p.slides.findIndex((sl) => sl.id === get().activeSurfaceId);
      if (idx >= 0) set({ focusSlideIndex: idx });
    }
  },
}));

/** Elements of the active surface that are currently selected, in layer order. */
export function selectSelectedElements(s: EditorState): DesignElement[] {
  if (!s.project || s.selection.length === 0) return [];
  const ids = new Set(s.selection);
  return ops.getElements(s.project, s.activeSurfaceId).filter((e) => ids.has(e.id));
}
