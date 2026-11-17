"use client";

import Konva from "konva";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { fitToViewport, getSlideOffsets, getSurface } from "@/document/geometry";
import { getElements, updateElements } from "@/document/operations";
import type { DesignElement, TextElement } from "@/document/schema";
import { collectSnapTargets, edgesForAnchor, snapMove, snapResize, unionBox, type Guide, type SnapBox, type SnapTargets } from "@/document/snapping";
import { groupState } from "@/document/groups";
import { playbackScope } from "@/document/timing";
import { ensureFontsLoaded, FONT_FALLBACK, resolveItalic, resolveWeight } from "@/render/fonts";
import type { ImageStore } from "@/render/resources";
import { buildSurfaceContent, collectFonts, ELEMENT_NAME, measureTextHeight, refreshVideoFrames, type BuildOptions } from "@/render/scene";
import { useEditorStore } from "@/store/editorStore";
import { FloatingMenu, type MenuItem } from "../ui/primitives";
import { IMAGE_ACCEPT_ATTR } from "@/persistence/assets";
import { VIDEO_ACCEPT_ATTR } from "@/persistence/video";
import { replaceMedia } from "./actions";
import { canvasApi } from "./canvasApi";

const MIN_SCALE = 0.02;
const MAX_SCALE = 8;
const SNAP_PX = 6;
const LONG_PRESS_MS = 550;
const ACCENT = "#2f5bea";
const GUIDE = "#e5388a";

interface View {
  scale: number;
  x: number;
  y: number;
}

interface Refs {
  stage: Konva.Stage;
  contentLayer: Konva.Layer;
  backdrop: Konva.Group;
  holder: Konva.Group;
  boundaries: Konva.Group;
  guides: Konva.Group;
  transformer: Konva.Transformer;
}

/** How the editor canvas asks the scene builder to draw (see BuildOptions). */
const EDITOR_BUILD: BuildOptions = { interactive: true, quality: 1, maxImageSide: 1600, showPlaceholders: true, progressive: true };
/** The playback clock is reported to the UI this often; the canvas itself redraws every frame. */
const PLAYHEAD_REPORT_S = 0.1;
/** Longest time the clock holds for a clip that is starting or buffering. */
const MAX_WAIT_MS = 3000;
/** Highest canvas pixel density while a slide is playing (see the playback effect). */
const PLAYBACK_PIXEL_RATIO = Number(process.env.NEXT_PUBLIC_PLAYBACK_RATIO || 1.5);

const playbackPixelRatio = () => Math.min(window.devicePixelRatio || 1, PLAYBACK_PIXEL_RATIO);
/** Video frames are drawn at the size they have on screen while playing, never larger than the document. */
const playingVideoQuality = (stage: Konva.Stage) => Math.min(1, stage.scaleX() * playbackPixelRatio());

const store = () => useEditorStore.getState();
/** The visible clips one press on play covers (see playbackScope), and how long they play. */
function activeClips() {
  const s = store();
  const surface = s.project && getSurface(s.project, s.activeSurfaceId);
  const scope = s.project ? playbackScope(s.project, s.activeSurfaceId, s.focusSlideIndex, s.selection) : null;
  const clips = scope ? scope.clips.filter((el) => el.visible) : [];
  return { surface, clips, duration: scope?.duration ?? 0, ids: new Set(scope?.clips.map((el) => el.id)) };
}
/** Breathing room around a fitted canvas. Phones get less so the canvas stays large. */
const viewPadding = () => (window.matchMedia("(max-width: 767px)").matches ? 20 : 56);
const snippet = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 40) || "Text";

function elementNodeOf(target: Konva.Node): Konva.Group | null {
  return (target.findAncestor(`.${ELEMENT_NAME}`, true) as Konva.Group | undefined) ?? null;
}

let checker: HTMLCanvasElement | null = null;
function checkerPattern() {
  if (!checker) {
    checker = document.createElement("canvas");
    checker.width = checker.height = 32;
    const ctx = checker.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = "#e4e4e4";
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillRect(16, 16, 16, 16);
  }
  return checker;
}

export function CanvasStage({ images }: { images: ImageStore }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const refs = useRef<Refs | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sizeKeyRef = useRef("");
  const discardDragRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<string | null>(null);
  /** Slide time of the video preview. The store only gets a throttled copy for the clock display. */
  const playTimeRef = useRef(0);

  const project = useEditorStore((s) => s.project);
  const activeSurfaceId = useEditorStore((s) => s.activeSurfaceId);
  const selection = useEditorStore((s) => s.selection);
  const editingTextId = useEditorStore((s) => s.editingTextId);
  const playback = useEditorStore((s) => s.playback);
  /** Seamless only: the slide whose clips play. Selecting a video on another slide moves it. */
  const scopeSlide = useEditorStore((s) => (s.project ? playbackScope(s.project, s.activeSurfaceId, s.focusSlideIndex, s.selection).slideIndex : null));
  useEffect(() => {
    // Another slide's clips are a different playback: the running one ends.
    if (store().playback !== "stopped") store().setPlayback("stopped");
  }, [scopeSlide]);

  const [resourceTick, setResourceTick] = useState(0);
  const [view, setViewState] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [fillError, setFillError] = useState<string | null>(null);

  // --- View (zoom and pan) --------------------------------------------------

  const applyView = useCallback((next: View) => {
    const r = refs.current;
    if (!r) return;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next.scale));
    r.stage.scale({ x: scale, y: scale });
    r.stage.position({ x: next.x, y: next.y });
    r.stage.batchDraw();
    setViewState({ scale, x: next.x, y: next.y });
    const s = store();
    s.setZoom(scale);
    if (s.project?.mode === "seamless") {
      const worldCenter = (r.stage.width() / 2 - next.x) / scale;
      s.setFocusSlide(Math.floor(worldCenter / s.project.width));
    }
  }, []);

  const zoomAt = useCallback(
    (point: { x: number; y: number }, nextScale: number) => {
      const r = refs.current;
      if (!r) return;
      const old = r.stage.scaleX();
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
      const world = { x: (point.x - r.stage.x()) / old, y: (point.y - r.stage.y()) / old };
      applyView({ scale, x: point.x - world.x * scale, y: point.y - world.y * scale });
    },
    [applyView],
  );

  const fit = useCallback(() => {
    const r = refs.current;
    const s = store();
    const surface = s.project && getSurface(s.project, s.activeSurfaceId);
    if (!r || !surface) return;
    applyView(fitToViewport(surface.width, surface.height, r.stage.width(), r.stage.height(), viewPadding()));
  }, [applyView]);

  const focusSlide = useCallback(
    (index: number) => {
      const r = refs.current;
      const p = store().project;
      if (!r || !p) return;
      if (p.mode !== "seamless") return fit();
      const v = fitToViewport(p.width, p.height, r.stage.width(), r.stage.height(), viewPadding());
      applyView({ scale: v.scale, x: v.x - index * p.width * v.scale, y: v.y });
    },
    [applyView, fit],
  );

  // --- Selection handles ----------------------------------------------------

  const syncTransformer = useCallback(() => {
    const r = refs.current;
    const s = store();
    if (!r || !s.project) return;
    const selected = new Set(s.selection);
    const els = getElements(s.project, s.activeSurfaceId).filter((e) => selected.has(e.id) && e.visible);
    const nodes = s.editingTextId
      ? []
      : els.map((e) => r.holder.findOne(`#${e.id}`)).filter((n): n is Konva.Node => !!n);
    const single = els.length === 1 ? els[0] : null;
    const locked = els.some((e) => e.locked);
    const isLine = single?.type === "shape" && (single.shape === "line" || single.shape === "arrow");
    r.transformer.setAttrs({
      resizeEnabled: !locked,
      rotateEnabled: !locked,
      keepRatio: !single || single.type !== "shape",
      enabledAnchors: isLine
        ? ["middle-left", "middle-right"]
        : single?.type === "text"
          ? ["top-left", "top-right", "bottom-left", "bottom-right", "middle-left", "middle-right"]
          : ["top-left", "top-center", "top-right", "middle-right", "middle-left", "bottom-left", "bottom-center", "bottom-right"],
    });
    r.transformer.nodes(nodes);
    r.transformer.getLayer()?.batchDraw();
  }, []);

  // --- Text editing ---------------------------------------------------------

  const startTextEdit = useCallback((id: string) => {
    // Synchronous so the focus() below still counts as part of the user gesture (iOS keyboard).
    flushSync(() => store().setEditingText(id));
    const ta = textareaRef.current;
    if (ta) {
      ta.focus();
      ta.select();
    }
  }, []);

  const finishTextEdit = useCallback(() => {
    const s = store();
    const id = s.editingTextId;
    const ta = textareaRef.current;
    if (!id || !ta || !s.project) return;
    const el = getElements(s.project, s.activeSurfaceId).find((e) => e.id === id);
    s.setEditingText(null);
    if (!el || el.type !== "text") return;
    const text = ta.value;
    if (text.trim() === "") {
      s.select([id]);
      s.deleteSelected();
      return;
    }
    if (text === el.text) return;
    const name = el.name === snippet(el.text) ? snippet(text) : el.name;
    s.updateElement(id, { text, name, height: measureTextHeight({ ...el, text }) } as Partial<DesignElement>);
  }, []);

  // --- Context menu ----------------------------------------------------------

  const buildMenuItems = useCallback((): MenuItem[] => {
    const s = store();
    const all = s.project ? getElements(s.project, s.activeSurfaceId) : [];
    const els = all.filter((e) => s.selection.includes(e.id));
    if (els.length === 0) {
      return [{ label: "Paste", disabled: s.clipboard.length === 0, onSelect: () => store().paste() }];
    }
    const first = els[0];
    const allLocked = els.every((e) => e.locked);
    const { canGroup, canUngroup } = groupState(all, s.selection);
    const items: MenuItem[] = [];
    if (els.length === 1 && first.type === "text" && !first.locked) items.push({ label: "Edit text", onSelect: () => startTextEdit(first.id) });
    items.push({ label: "Duplicate", onSelect: () => store().duplicateSelected() }, { label: "Copy", onSelect: () => store().copySelected() });
    if (canGroup) items.push({ label: "Group", onSelect: () => store().groupSelected() });
    if (canUngroup) items.push({ label: "Ungroup", onSelect: () => store().ungroupSelected() });
    // Every stacking action works on the whole selection, keeping its order.
    items.push(
      { label: "Bring forward", onSelect: () => store().reorderSelected("forward") },
      { label: "Send backward", onSelect: () => store().reorderSelected("backward") },
      { label: "Bring to front", onSelect: () => store().reorderSelected("front") },
      { label: "Send to back", onSelect: () => store().reorderSelected("back") },
      { label: allLocked ? "Unlock" : "Lock", onSelect: () => store().updateSelected({ locked: !allLocked }) },
      { label: els.length > 1 ? `Delete ${els.length} objects` : "Delete", danger: true, onSelect: () => store().deleteSelected() },
    );
    return items;
  }, [startTextEdit]);

  // --- Stage setup (once) ---------------------------------------------------

  // Layout effect, declared before the render effect below, so the stage exists when that one runs.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const coarse = window.matchMedia("(pointer: coarse)").matches;

    const stage = new Konva.Stage({ container: host, width: host.clientWidth || 1, height: host.clientHeight || 1 });
    const contentLayer = new Konva.Layer();
    const uiLayer = new Konva.Layer();
    const backdrop = new Konva.Group({ listening: false });
    const holder = new Konva.Group();
    const boundaries = new Konva.Group({ listening: false });
    const guides = new Konva.Group({ listening: false });
    const transformer = new Konva.Transformer({
      rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315],
      rotationSnapTolerance: 4,
      rotateAnchorOffset: coarse ? 36 : 28,
      anchorSize: coarse ? 16 : 9,
      anchorCornerRadius: 2,
      anchorStroke: ACCENT,
      anchorFill: "#ffffff",
      borderStroke: ACCENT,
      borderStrokeWidth: 1.5,
      ignoreStroke: true,
      flipEnabled: false,
      padding: 0,
    });
    contentLayer.add(backdrop, holder);
    uiLayer.add(boundaries, guides, transformer);
    stage.add(contentLayer, uiLayer);
    refs.current = { stage, contentLayer, backdrop, holder, boundaries, guides, transformer };

    const gesture = {
      suppressTap: false,
      pinch: null as null | { dist: number; cx: number; cy: number; scale: number; x: number; y: number },
      longPress: null as null | { timer: number; x: number; y: number },
      spaceDown: false,
      tempPan: false,
    };

    const sid = () => store().activeSurfaceId;
    const elementsById = () => {
      const s = store();
      return new Map((s.project ? getElements(s.project, s.activeSurfaceId) : []).map((e) => [e.id, e]));
    };
    const cancelLongPress = () => {
      if (gesture.longPress) window.clearTimeout(gesture.longPress.timer);
      gesture.longPress = null;
    };
    /** Abort an in-flight drag or resize without committing it. */
    // Smart guides. Targets are collected once per gesture; the pure rules live in document/snapping.ts.
    const snap = { targets: null as SnapTargets | null, moving: null as Map<Konva.Node, SnapBox> | null, off: false, committed: false };
    const drawGuides = (list: Guide[]) => {
      guides.destroyChildren();
      for (const g of list) {
        const points = g.axis === "x" ? [g.pos, g.from, g.pos, g.to] : [g.from, g.pos, g.to, g.pos];
        guides.add(new Konva.Line({ points, stroke: GUIDE, strokeWidth: 1, strokeScaleEnabled: false }));
      }
      // Read by the end-to-end tests; has no effect on the app.
      host.dataset.guides = list.map((g) => `${g.axis}:${Math.round(g.pos)}`).join(" ");
    };
    const snapThreshold = () => SNAP_PX / stage.scaleX();
    const targetsExcept = (nodes: Konva.Node[]) => {
      const p = store().project;
      return p ? collectSnapTargets(p, sid(), new Set(nodes.map((n) => n.id()))) : null;
    };
    const toSurface = (point: { x: number; y: number }) => holder.getAbsoluteTransform().copy().invert().point(point);
    /** Holding Ctrl or Cmd turns snapping off for the rest of the gesture step. */
    const trackModifier = (e: MouseEvent) => {
      snap.off = e.ctrlKey || e.metaKey;
    };

    /**
     * Snap the whole selection while it is dragged. Runs before Konva applies a position.
     * Konva drags every selected node on its own, so each one gets this function and works out the
     * same box around the selection from its own position: they all receive the same correction.
     */
    const snapDrag = (node: Konva.Node, pos: { x: number; y: number }, evt?: Event) => {
      const mods = evt as MouseEvent | undefined;
      const offset = snap.moving?.get(node);
      // Until every selected node has joined the drag, positions are not rigid yet: do not snap.
      if (!snap.targets || !snap.moving || !offset || mods?.ctrlKey || mods?.metaKey || [...snap.moving.keys()].some((n) => !n.isDragging())) {
        drawGuides([]);
        return pos;
      }
      const origin = toSurface(pos);
      const box = { ...offset, x: origin.x + offset.x, y: origin.y + offset.y };
      const result = snapMove(box, snap.targets, snapThreshold());
      drawGuides(result.guides);
      const scale = stage.scaleX();
      return { x: pos.x + result.dx * scale, y: pos.y + result.dy * scale };
    };

    /** Snap the edges that follow the pointer while resizing. Rotated single elements are left alone. */
    transformer.boundBoxFunc((oldBox, newBox) => {
      if (Math.abs(newBox.width) < 6 || Math.abs(newBox.height) < 6) return oldBox;
      const edges = edgesForAnchor(transformer.getActiveAnchor());
      if (!edges || !snap.targets || snap.off || Math.abs(newBox.rotation) > 1e-4) {
        drawGuides([]);
        return newBox;
      }
      const scale = stage.scaleX();
      const topLeft = toSurface({ x: newBox.x, y: newBox.y });
      const corner = (edges.left || edges.right) && (edges.top || edges.bottom);
      // Konva keeps the shape for corner handles (always, or with Shift): detect it from the boxes.
      const keepRatio = !!corner && Math.abs(newBox.width * oldBox.height - oldBox.width * newBox.height) < 1e-3 * newBox.height * oldBox.height;
      const result = snapResize({ x: topLeft.x, y: topLeft.y, width: newBox.width / scale, height: newBox.height / scale }, edges, snap.targets, snapThreshold(), {
        keepRatio,
        minSize: 6 / scale,
      });
      drawGuides(result.guides);
      const back = holder.getAbsoluteTransform().point({ x: result.box.x, y: result.box.y });
      return { x: back.x, y: back.y, width: result.box.width * scale, height: result.box.height * scale, rotation: newBox.rotation };
    });
    transformer.on("transformstart", () => {
      snap.off = false;
      snap.targets = targetsExcept(transformer.nodes());
      window.addEventListener("mousemove", trackModifier);
    });

    const abortManipulation = () => {
      discardDragRef.current = true;
      stage.find(`.${ELEMENT_NAME}`).forEach((n) => n.isDragging() && n.stopDrag());
      if (transformer.isTransforming()) transformer.stopTransform();
      discardDragRef.current = false;
      drawGuides([]);
      setResourceTick((t) => t + 1);
    };

    // Selection
    stage.on("click tap", (e) => {
      if (gesture.suppressTap) return;
      if (e.evt instanceof MouseEvent && e.evt.button !== 0) return;
      if (e.target.findAncestor("Transformer", true)) return;
      const s = store();
      if (s.editingTextId) return;
      const node = elementNodeOf(e.target);
      if (!node) return s.select([]);
      const evt = e.evt as MouseEvent;
      s.selectOnCanvas(node.id(), evt.shiftKey || evt.metaKey || evt.ctrlKey || s.multiSelect);
    });

    // Pressing a grouped element that is not selected yet selects its whole group before a drag
    // can start, so Konva drags every member together (it moves the transformer's nodes as one).
    stage.on("mousedown touchstart", (e) => {
      const mouse = e.evt instanceof MouseEvent ? e.evt : null;
      if (mouse && (mouse.button !== 0 || mouse.shiftKey || mouse.metaKey || mouse.ctrlKey)) return;
      const s = store();
      if (s.editingTextId || s.multiSelect) return;
      const node = elementNodeOf(e.target);
      if (!node || s.selection.includes(node.id()) || !elementsById().get(node.id())?.groupId) return;
      s.selectOnCanvas(node.id(), false);
      syncTransformer();
    });

    stage.on("dblclick dbltap", (e) => {
      const node = elementNodeOf(e.target);
      const el = node && elementsById().get(node.id());
      if (el?.type === "text" && !el.locked) startTextEdit(el.id);
      if (el?.type === "image" && !el.locked && !el.assetId) {
        // Still inside the user gesture, which iOS requires for opening a file picker.
        replaceTargetRef.current = el.id;
        fileRef.current?.click();
      }
    });

    stage.on("contextmenu", (e) => {
      e.evt.preventDefault();
      const s = store();
      const node = elementNodeOf(e.target);
      if (node && !s.selection.includes(node.id())) s.selectOnCanvas(node.id(), false);
      if (!node && !e.target.findAncestor("Transformer", true)) s.select([]);
      setMenu({ x: e.evt.clientX, y: e.evt.clientY, items: buildMenuItems() });
    });

    // Dragging elements, with smart guides for single selections
    stage.on("dragstart", (e) => {
      cancelLongPress();
      const node = elementNodeOf(e.target);
      if (!node || (e.target as Konva.Node) !== node) return;
      if (snap.moving) return; // another node of the same selection joining the drag
      const s = store();
      if (!s.selection.includes(node.id())) {
        s.selectOnCanvas(node.id(), false);
        const ids = store().selection;
        transformer.nodes(ids.map((id) => holder.findOne(`#${id}`)).filter((n): n is Konva.Node => !!n));
      }
      // The dragged node carries the rest of the selection, so guides work on the box around all of it.
      const moving = [...new Set<Konva.Node>([node, ...transformer.nodes()])];
      const union = unionBox(moving.map((n) => n.getClientRect({ relativeTo: holder })));
      snap.targets = targetsExcept(moving);
      snap.moving = new Map();
      snap.committed = false;
      for (const n of moving) {
        const origin = toSurface(n.getAbsolutePosition());
        if (union) snap.moving.set(n, { x: union.x - origin.x, y: union.y - origin.y, width: union.width, height: union.height });
        n.dragBoundFunc((pos, evt) => snapDrag(n, pos, evt));
      }
    });

    stage.on("dragmove", (e) => {
      if (e.target === stage) {
        setViewState({ scale: stage.scaleX(), x: stage.x(), y: stage.y() });
        return;
      }
    });

    stage.on("dragend", (e) => {
      drawGuides([]);
      elementNodeOf(e.target)?.setAttr("dragBoundFunc", undefined);
      if (!snap.moving || [...snap.moving.keys()].every((n) => !n.isDragging())) snap.targets = snap.moving = null;
      if (e.target === stage) {
        if (gesture.tempPan) {
          gesture.tempPan = false;
          stage.draggable(gesture.spaceDown);
        }
        applyView({ scale: stage.scaleX(), x: stage.x(), y: stage.y() });
        return;
      }
      const node = elementNodeOf(e.target);
      if (!node || (e.target as Konva.Node) !== node || discardDragRef.current) return;
      // Every node of a multi-selection ends its own drag; the first one commits them all (one undo step).
      if (snap.committed) return;
      snap.committed = true;
      const moved = new Set<Konva.Node>([node, ...transformer.nodes()]);
      const next = new Map<string, { x: number; y: number }>();
      moved.forEach((n) =>
        next.set(n.id(), { x: Math.round(n.x() - n.width() / 2), y: Math.round(n.y() - n.height() / 2) }),
      );
      store().commit((p) => updateElements(p, sid(), [...next.keys()], (el) => next.get(el.id) ?? {}));
    });

    // Resize and rotate: fold the transformer's scale back into real document values
    transformer.on("transformend", () => {
      window.removeEventListener("mousemove", trackModifier);
      snap.targets = null;
      drawGuides([]);
      if (discardDragRef.current) return;
      const byId = elementsById();
      const patches = new Map<string, Partial<DesignElement>>();
      for (const node of transformer.nodes()) {
        const el = byId.get(node.id());
        if (!el) continue;
        const sx = Math.abs(node.scaleX());
        const sy = Math.abs(node.scaleY());
        const rotation = Math.round(((node.rotation() % 360) + 360) % 360 * 10) / 10;
        if (el.type === "text") {
          const uniform = Math.abs(sx - sy) < 0.001;
          const width = Math.max(20, Math.round(el.width * sx));
          const fontSize = uniform ? Math.max(4, Math.round(el.fontSize * sy * 10) / 10) : el.fontSize;
          const height = measureTextHeight({ ...el, width, fontSize });
          patches.set(el.id, {
            width,
            fontSize,
            height,
            rotation,
            x: Math.round(node.x() - width / 2),
            y: Math.round(node.y() - height / 2),
          } as Partial<TextElement>);
        } else {
          const width = Math.max(4, Math.round(el.width * sx));
          const height = Math.max(4, Math.round(el.height * sy));
          patches.set(el.id, {
            width,
            height,
            rotation,
            x: Math.round(node.x() - width / 2),
            y: Math.round(node.y() - height / 2),
          });
        }
        node.scale({ x: 1, y: 1 });
      }
      store().commit((p) => updateElements(p, sid(), [...patches.keys()], (el) => patches.get(el.id) ?? {}));
    });

    // Wheel: pinch or Ctrl/Cmd zooms at the pointer, plain scroll pans
    stage.on("wheel", (e) => {
      e.evt.preventDefault();
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      if (e.evt.ctrlKey || e.evt.metaKey) {
        zoomAt(pointer, stage.scaleX() * Math.exp(-e.evt.deltaY * 0.01));
      } else {
        applyView({ scale: stage.scaleX(), x: stage.x() - e.evt.deltaX, y: stage.y() - e.evt.deltaY });
      }
    });

    // Middle mouse button pans
    stage.on("mousedown", (e) => {
      if (e.evt.button !== 1) return;
      e.evt.preventDefault();
      gesture.tempPan = true;
      stage.draggable(true);
      stage.startDrag();
    });

    // Touch: two fingers pinch-zoom and pan, long press opens the context menu
    const local = (t: Touch) => {
      const rect = host.getBoundingClientRect();
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    };
    const onTouchStart = (ev: TouchEvent) => {
      if (ev.touches.length === 2) {
        ev.preventDefault();
        cancelLongPress();
        abortManipulation();
        gesture.suppressTap = true;
        const a = local(ev.touches[0]);
        const b = local(ev.touches[1]);
        gesture.pinch = {
          dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
          scale: stage.scaleX(),
          x: stage.x(),
          y: stage.y(),
        };
      } else if (ev.touches.length === 1) {
        const t = ev.touches[0];
        const point = local(t);
        cancelLongPress();
        gesture.longPress = {
          x: t.clientX,
          y: t.clientY,
          timer: window.setTimeout(() => {
            gesture.longPress = null;
            const hit = stage.getIntersection(point);
            const node = hit && elementNodeOf(hit);
            if (!node) return;
            abortManipulation();
            gesture.suppressTap = true;
            // Keep a multi-selection the press is part of, so the menu acts on all of it.
            if (!store().selection.includes(node.id())) store().selectOnCanvas(node.id(), false);
            setMenu({ x: t.clientX, y: t.clientY, items: buildMenuItems() });
          }, LONG_PRESS_MS),
        };
      }
    };
    const onTouchMove = (ev: TouchEvent) => {
      const lp = gesture.longPress;
      if (lp && ev.touches.length === 1 && Math.hypot(ev.touches[0].clientX - lp.x, ev.touches[0].clientY - lp.y) > 10) {
        cancelLongPress();
      }
      const pinch = gesture.pinch;
      if (!pinch || ev.touches.length !== 2) return;
      ev.preventDefault();
      const a = local(ev.touches[0]);
      const b = local(ev.touches[1]);
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (pinch.scale * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.dist));
      const world = { x: (pinch.cx - pinch.x) / pinch.scale, y: (pinch.cy - pinch.y) / pinch.scale };
      applyView({ scale, x: (a.x + b.x) / 2 - world.x * scale, y: (a.y + b.y) / 2 - world.y * scale });
    };
    const onTouchEnd = (ev: TouchEvent) => {
      cancelLongPress();
      if (ev.touches.length < 2) gesture.pinch = null;
      if (ev.touches.length === 0 && gesture.suppressTap) window.setTimeout(() => (gesture.suppressTap = false), 80);
    };
    host.addEventListener("touchstart", onTouchStart, { passive: false });
    host.addEventListener("touchmove", onTouchMove, { passive: false });
    host.addEventListener("touchend", onTouchEnd);
    host.addEventListener("touchcancel", onTouchEnd);

    // Hold Space to pan with the mouse
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
    const setSpace = (down: boolean) => {
      gesture.spaceDown = down;
      stage.draggable(down);
      holder.listening(!down);
      transformer.listening(!down);
      host.style.cursor = down ? "grab" : "";
      contentLayer.batchDraw();
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.code !== "Space" || typing(ev.target)) return;
      ev.preventDefault();
      if (!gesture.spaceDown) setSpace(true);
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.code === "Space" && gesture.spaceDown) setSpace(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const observer = new ResizeObserver(() => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w < 1 || h < 1) return;
      const dx = (w - stage.width()) / 2;
      const dy = (h - stage.height()) / 2;
      stage.size({ width: w, height: h });
      // Keep whatever is centered in view centered after a resize (panels, keyboard, rotation).
      applyView({ scale: stage.scaleX(), x: stage.x() + dx, y: stage.y() + dy });
    });
    observer.observe(host);

    const unsubscribeImages = images.subscribe(() => setResourceTick((t) => t + 1));
    const unsubscribeProcessed = images.subscribeProcessed(() => setResourceTick((t) => t + 1));

    canvasApi.fit = fit;
    canvasApi.focusSlide = focusSlide;
    canvasApi.emptyFrameAt = (clientX, clientY) => {
      const box = stage.container().getBoundingClientRect();
      const hit = stage.getIntersection({ x: clientX - box.left, y: clientY - box.top });
      const node = hit && elementNodeOf(hit);
      const el = node ? elementsById().get(node.id()) : undefined;
      return el?.type === "image" && !el.assetId && !el.locked ? el.id : null;
    };
    canvasApi.zoomBy = (factor) => zoomAt({ x: stage.width() / 2, y: stage.height() / 2 }, stage.scaleX() * factor);
    canvasApi.zoomTo = (scale) => zoomAt({ x: stage.width() / 2, y: stage.height() / 2 }, scale);
    canvasApi.togglePlayback = () => {
      const s = store();
      if (s.playback === "playing") return s.setPlayback("paused", playTimeRef.current);
      const { surface, clips, duration } = activeClips();
      if (clips.length === 0 || duration <= 0) return;
      if (s.playback === "stopped" || playTimeRef.current >= duration) playTimeRef.current = 0;
      s.setPlaybackNotice(null);
      images.videos.resetAudioBlock();
      // Started right here, inside the tap, because browsers only allow sound from a user gesture.
      images.videos.sync(clips, playTimeRef.current, true);
      images.music.sync(surface?.audio, playTimeRef.current, true, duration);
      s.setPlayback("playing", playTimeRef.current);
    };
    canvasApi.stopPlayback = () => store().setPlayback("stopped");
    canvasApi.seek = (seconds) => {
      const { surface, clips, duration, ids } = activeClips();
      if (!surface || clips.length === 0) return;
      const time = Math.min(Math.max(0, seconds), Math.max(0, duration - 0.001));
      const wasPaused = store().playback === "paused";
      playTimeRef.current = time;
      images.videos.sync(clips, time, false);
      images.music.sync(surface.audio, time, false, duration);
      store().setPlayback("paused", time);
      // Already paused: nothing re-renders, so put the frames of the new time on screen directly.
      // (Each video also asks for a rebuild as soon as its seek has landed.)
      if (wasPaused) {
        refreshVideoFrames(holder, surface.elements, images, { ...EDITOR_BUILD, videoTime: time, videoScope: ids });
        contentLayer.batchDraw();
      }
    };
    // A hidden tab stops painting but media keeps playing: pause instead of drifting apart.
    const onHidden = () => {
      if (document.hidden && store().playback === "playing") store().setPlayback("paused", playTimeRef.current);
    };
    document.addEventListener("visibilitychange", onHidden);
    const unsubscribeAudio = images.videos.subscribeAudioBlocked(() =>
      store().setPlaybackNotice("This browser blocked the sound. Pause and press play again to hear it."),
    );

    return () => {
      cancelLongPress();
      observer.disconnect();
      unsubscribeImages();
      unsubscribeProcessed();
      host.removeEventListener("touchstart", onTouchStart);
      host.removeEventListener("touchmove", onTouchMove);
      host.removeEventListener("touchend", onTouchEnd);
      host.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("mousemove", trackModifier);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvasApi.fit = canvasApi.focusSlide = canvasApi.zoomBy = canvasApi.zoomTo = () => {};
      canvasApi.emptyFrameAt = () => null;
      canvasApi.togglePlayback = canvasApi.stopPlayback = canvasApi.seek = () => {};
      unsubscribeAudio();
      document.removeEventListener("visibilitychange", onHidden);
      images.videos.stop();
      images.music.stop();
      stage.destroy();
      refs.current = null;
    };
  }, [applyView, buildMenuItems, fit, focusSlide, images, startTextEdit, syncTransformer, zoomAt]);

  // --- Fonts: text can only be measured correctly once its face is loaded ----

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void ensureFontsLoaded(collectFonts(project)).then(() => !cancelled && setResourceTick((t) => t + 1));
    return () => {
      cancelled = true;
    };
    // Re-run only when the set of faces changes, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project && collectFonts(project).map((f) => `${f.family}/${f.weight}/${f.italic}`).sort().join("|")]);

  // --- Document -> canvas ----------------------------------------------------

  useLayoutEffect(() => {
    const r = refs.current;
    const surface = project && getSurface(project, activeSurfaceId);
    if (!r || !project || !surface) return;

    r.holder.destroyChildren();
    r.backdrop.destroyChildren();
    r.boundaries.destroyChildren();

    r.backdrop.add(
      new Konva.Rect({
        width: surface.width,
        height: surface.height,
        fillPatternImage: checkerPattern() as unknown as HTMLImageElement,
        // A hairline instead of a blurred drop shadow: canvas shadows are re-rasterized on every
        // redraw and are one of the slowest things a 2D canvas can do, especially on iOS.
        stroke: "rgba(0,0,0,0.18)",
        strokeWidth: 1,
        strokeScaleEnabled: false,
      }),
    );
    // Stopped: every video shows its poster frame, exactly like thumbnails and image exports.
    const videoTime = playback === "stopped" ? undefined : playTimeRef.current;
    const { clips, duration: scopeDuration, ids: videoScope } = activeClips();
    if (playback === "paused") {
      // Nothing left to preview (the last clip was deleted or hidden): back to the idle state.
      if (clips.length === 0) store().setPlayback("stopped");
      else images.videos.sync(clips, playTimeRef.current, false);
      images.music.sync(surface.audio, playTimeRef.current, false, scopeDuration);
    }
    const videoQuality = playback === "playing" ? playingVideoQuality(r.stage) : undefined;
    const content = buildSurfaceContent(surface, images, { ...EDITOR_BUILD, videoTime, videoQuality, videoScope });
    r.holder.add(content);
    if (editingTextId) content.findOne(`#${editingTextId}`)?.visible(false);

    for (const offset of getSlideOffsets(project, surface.id).slice(1)) {
      r.boundaries.add(
        new Konva.Line({
          points: [offset, 0, offset, surface.height],
          stroke: ACCENT,
          strokeWidth: 1,
          dash: [6, 5],
          strokeScaleEnabled: false,
          opacity: 0.85,
        }),
      );
    }

    syncTransformer();

    const sizeKey = `${surface.id}:${surface.width}x${surface.height}`;
    if (sizeKey !== sizeKeyRef.current) {
      const grewPanorama = sizeKeyRef.current.startsWith(`${surface.id}:`);
      sizeKeyRef.current = sizeKey;
      // First display of a surface: frame it. A panorama that only changed length keeps its view.
      if (!grewPanorama) {
        if (project.mode === "seamless") focusSlide(store().focusSlideIndex);
        else fit();
      }
    }
    r.stage.batchDraw();
  }, [project, activeSurfaceId, editingTextId, resourceTick, images, syncTransformer, fit, focusSlide, playback, scopeSlide]);

  // --- Video preview ----------------------------------------------------------

  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    if (playback === "stopped") {
      playTimeRef.current = 0;
      images.videos.stop();
      images.music.stop();
      return;
    }
    if (playback !== "playing") return;
    // While playing, the canvas is drawn at a lower pixel density (text is a little softer) and the
    // video frames at the size they have on screen: on a 3x phone that is 4 times fewer pixels per frame.
    const canvas = r.contentLayer.getCanvas();
    const fullRatio = canvas.getPixelRatio();
    const playRatio = Math.min(fullRatio, playbackPixelRatio());
    if (playRatio !== fullRatio) canvas.setPixelRatio(playRatio);

    let reported = playTimeRef.current;
    let last = performance.now();
    let waitingSince = 0;
    const animation = new Konva.Animation(() => {
      const { surface, clips, duration, ids } = activeClips();
      if (!surface || clips.length === 0) {
        store().setPlayback("stopped");
        return false;
      }
      const now = performance.now();
      const step = Math.min(0.25, (now - last) / 1000);
      last = now;
      // The clock follows the video (see VideoPool.sync): it advances with real time, holds while a
      // clip is still starting or buffering, and is then moved to where the leading clip really is.
      let time = playTimeRef.current;
      const state = images.videos.sync(clips, time + step, true);
      // A clip that never gets going (a file the browser gives up on) must not freeze the slide.
      if (!state.waiting) waitingSince = 0;
      else if (!waitingSince) waitingSince = now;
      if (!state.waiting || now - waitingSince > MAX_WAIT_MS) time = Math.max(0, time + step + state.lead);
      if (time >= duration) {
        store().setPlayback("stopped");
        return false;
      }
      playTimeRef.current = time;
      images.music.sync(surface.audio, time, true, duration);
      if (Math.abs(time - reported) >= PLAYHEAD_REPORT_S) {
        reported = time;
        store().setPlayhead(time);
      }
      // Repaint only when a video has a new frame: a 30 fps clip does not need 60 paints a second.
      if (!images.videos.takeNewFrames()) return false;
      refreshVideoFrames(r.holder, surface.elements, images, { ...EDITOR_BUILD, videoTime: time, videoQuality: playingVideoQuality(r.stage), videoScope: ids });
    }, r.contentLayer);
    animation.start();
    return () => {
      animation.stop();
      if (playRatio !== fullRatio) {
        canvas.setPixelRatio(fullRatio);
        r.contentLayer.batchDraw();
      }
    };
  }, [playback, images]);

  useEffect(() => {
    syncTransformer();
  }, [selection, syncTransformer]);

  // --- Inline text editor overlay ---------------------------------------------

  const editing =
    project && editingTextId
      ? (getElements(project, activeSurfaceId).find((e) => e.id === editingTextId && e.type === "text") as TextElement | undefined)
      : undefined;

  const autosize = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  };
  useLayoutEffect(autosize, [editing?.id, view.scale]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-workspace">
      <div
        ref={hostRef}
        data-testid="canvas-host"
        className="absolute inset-0 touch-none select-none [-webkit-touch-callout:none]"
      />
      {editing && (
        <textarea
          ref={textareaRef}
          aria-label="Edit text"
          defaultValue={editing.text}
          spellCheck={false}
          onInput={autosize}
          onBlur={finishTextEdit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") e.currentTarget.blur();
          }}
          style={{
            position: "absolute",
            left: view.x + editing.x * view.scale,
            top: view.y + editing.y * view.scale,
            width: editing.width * view.scale,
            transform: `rotate(${editing.rotation}deg)`,
            transformOrigin: "50% 50%",
            fontSize: `${editing.fontSize * view.scale}px`,
            fontFamily: `"${editing.fontFamily}", ${FONT_FALLBACK}`,
            fontWeight: resolveWeight(editing.fontFamily, editing.fontWeight),
            fontStyle: resolveItalic(editing.fontFamily, editing.italic) ? "italic" : "normal",
            lineHeight: editing.lineHeight,
            letterSpacing: `${editing.letterSpacing * view.scale}px`,
            textAlign: editing.align,
            textTransform: editing.transform,
            color: editing.fill,
            caretColor: ACCENT,
          }}
          className="canvas-text-editor z-10 m-0 resize-none overflow-hidden border-0 bg-transparent p-0 whitespace-pre-wrap outline-1 outline-accent outline-dashed"
        />
      )}
      <input
        ref={fileRef}
        type="file"
        accept={`${IMAGE_ACCEPT_ATTR},${VIDEO_ACCEPT_ATTR}`}
        hidden
        data-testid="placeholder-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const target = replaceTargetRef.current ?? store().selection[0];
          e.target.value = "";
          if (file && target) void replaceMedia(target, file).then(setFillError);
        }}
      />
      {fillError && (
        <div role="alert" className="absolute top-3 left-1/2 z-20 w-[min(90%,420px)] -translate-x-1/2 rounded-md border border-danger/40 bg-panel px-3 py-2 text-xs text-danger shadow-lg">
          <p>{fillError}</p>
          <button type="button" className="mt-1 underline" onClick={() => setFillError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {menu && <FloatingMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
