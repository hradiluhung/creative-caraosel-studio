"use client";

import Konva from "konva";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { fitToViewport, getSlideOffsets, getSurface } from "@/document/geometry";
import { getElements, updateElements } from "@/document/operations";
import type { DesignElement, TextElement } from "@/document/schema";
import { ensureFontsLoaded, FONT_FALLBACK, resolveItalic, resolveWeight } from "@/render/fonts";
import type { ImageStore } from "@/render/resources";
import { buildSurfaceContent, collectFonts, ELEMENT_NAME, measureTextHeight } from "@/render/scene";
import { useEditorStore } from "@/store/editorStore";
import { FloatingMenu, type MenuItem } from "../ui/primitives";
import { IMAGE_ACCEPT_ATTR } from "@/persistence/assets";
import { replaceImage } from "./actions";
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

const store = () => useEditorStore.getState();
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

  const project = useEditorStore((s) => s.project);
  const activeSurfaceId = useEditorStore((s) => s.activeSurfaceId);
  const selection = useEditorStore((s) => s.selection);
  const editingTextId = useEditorStore((s) => s.editingTextId);

  const [resourceTick, setResourceTick] = useState(0);
  const [view, setViewState] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

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
    const els = s.project ? getElements(s.project, s.activeSurfaceId).filter((e) => s.selection.includes(e.id)) : [];
    if (els.length === 0) {
      return [{ label: "Paste", disabled: s.clipboard.length === 0, onSelect: () => store().paste() }];
    }
    const first = els[0];
    const allLocked = els.every((e) => e.locked);
    const items: MenuItem[] = [
      { label: "Duplicate", onSelect: () => store().duplicateSelected() },
      { label: "Copy", onSelect: () => store().copySelected() },
    ];
    if (els.length === 1) {
      if (first.type === "text" && !first.locked) items.unshift({ label: "Edit text", onSelect: () => startTextEdit(first.id) });
      items.push(
        { label: "Bring forward", onSelect: () => store().reorder(first.id, "forward") },
        { label: "Send backward", onSelect: () => store().reorder(first.id, "backward") },
        { label: "Bring to front", onSelect: () => store().reorder(first.id, "front") },
        { label: "Send to back", onSelect: () => store().reorder(first.id, "back") },
      );
    }
    items.push(
      { label: allLocked ? "Unlock" : "Lock", onSelect: () => store().updateSelected({ locked: !allLocked }) },
      { label: "Delete", danger: true, onSelect: () => store().deleteSelected() },
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
      boundBoxFunc: (oldBox, newBox) => (Math.abs(newBox.width) < 6 || Math.abs(newBox.height) < 6 ? oldBox : newBox),
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
    const abortManipulation = () => {
      discardDragRef.current = true;
      stage.find(`.${ELEMENT_NAME}`).forEach((n) => n.isDragging() && n.stopDrag());
      if (transformer.isTransforming()) transformer.stopTransform();
      discardDragRef.current = false;
      guides.destroyChildren();
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
      if (evt.shiftKey || evt.metaKey || evt.ctrlKey) s.toggleSelect(node.id());
      else s.select([node.id()]);
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
      if (node && !s.selection.includes(node.id())) s.select([node.id()]);
      if (!node && !e.target.findAncestor("Transformer", true)) s.select([]);
      setMenu({ x: e.evt.clientX, y: e.evt.clientY, items: buildMenuItems() });
    });

    // Dragging elements, with smart guides for single selections
    stage.on("dragstart", (e) => {
      cancelLongPress();
      const node = elementNodeOf(e.target);
      if (!node || (e.target as Konva.Node) !== node) return;
      const s = store();
      if (!s.selection.includes(node.id())) {
        s.select([node.id()]);
        transformer.nodes([node]);
      }
    });

    stage.on("dragmove", (e) => {
      if (e.target === stage) {
        setViewState({ scale: stage.scaleX(), x: stage.x(), y: stage.y() });
        return;
      }
      const node = elementNodeOf(e.target);
      const p = store().project;
      if (!node || (e.target as Konva.Node) !== node || !p || transformer.nodes().length !== 1) return;
      const surface = getSurface(p, sid());
      if (!surface) return;
      const box = node.getClientRect({ relativeTo: holder });
      const threshold = SNAP_PX / stage.scaleX();
      const xs = getSlideOffsets(p, surface.id).flatMap((o) => [o, o + p.width / 2, o + p.width]);
      const ys = [0, surface.height / 2, surface.height];
      const nearest = (edges: number[], lines: number[]) => {
        let best: { delta: number; line: number } | null = null;
        for (const edge of edges)
          for (const line of lines) {
            const delta = line - edge;
            if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, line };
          }
        return best;
      };
      const sx = nearest([box.x, box.x + box.width / 2, box.x + box.width], xs);
      const sy = nearest([box.y, box.y + box.height / 2, box.y + box.height], ys);
      if (sx) node.x(node.x() + sx.delta);
      if (sy) node.y(node.y() + sy.delta);
      guides.destroyChildren();
      const line = (points: number[]) =>
        guides.add(new Konva.Line({ points, stroke: GUIDE, strokeWidth: 1, strokeScaleEnabled: false }));
      if (sx) line([sx.line, 0, sx.line, surface.height]);
      if (sy) line([0, sy.line, surface.width, sy.line]);
    });

    stage.on("dragend", (e) => {
      guides.destroyChildren();
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
      const moved = new Set<Konva.Node>([node, ...transformer.nodes()]);
      const next = new Map<string, { x: number; y: number }>();
      moved.forEach((n) =>
        next.set(n.id(), { x: Math.round(n.x() - n.width() / 2), y: Math.round(n.y() - n.height() / 2) }),
      );
      store().commit((p) => updateElements(p, sid(), [...next.keys()], (el) => next.get(el.id) ?? {}));
    });

    // Resize and rotate: fold the transformer's scale back into real document values
    transformer.on("transformend", () => {
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
            store().select([node.id()]);
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

    canvasApi.fit = fit;
    canvasApi.focusSlide = focusSlide;
    canvasApi.zoomBy = (factor) => zoomAt({ x: stage.width() / 2, y: stage.height() / 2 }, stage.scaleX() * factor);
    canvasApi.zoomTo = (scale) => zoomAt({ x: stage.width() / 2, y: stage.height() / 2 }, scale);

    return () => {
      cancelLongPress();
      observer.disconnect();
      unsubscribeImages();
      host.removeEventListener("touchstart", onTouchStart);
      host.removeEventListener("touchmove", onTouchMove);
      host.removeEventListener("touchend", onTouchEnd);
      host.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvasApi.fit = canvasApi.focusSlide = canvasApi.zoomBy = canvasApi.zoomTo = () => {};
      stage.destroy();
      refs.current = null;
    };
  }, [applyView, buildMenuItems, fit, focusSlide, images, startTextEdit, zoomAt]);

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
        shadowColor: "#000000",
        shadowOpacity: 0.14,
        shadowBlur: 28,
        shadowOffsetY: 6,
      }),
    );
    const content = buildSurfaceContent(surface, images, { interactive: true, quality: 1, maxImageSide: 1600, showPlaceholders: true });
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
  }, [project, activeSurfaceId, editingTextId, resourceTick, images, syncTransformer, fit, focusSlide]);

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
        accept={IMAGE_ACCEPT_ATTR}
        hidden
        data-testid="placeholder-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const target = replaceTargetRef.current ?? store().selection[0];
          e.target.value = "";
          if (file && target) void replaceImage(target, file);
        }}
      />
      {menu && <FloatingMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
