/**
 * Smart guides: pure geometry shared by moving and resizing.
 * Everything is in surface coordinates. "x" lines are vertical (a fixed x), "y" lines horizontal.
 */
import { getSlideOffsets, getSurface, rotatedBounds } from "./geometry";
import type { Project } from "./schema";

export interface SnapBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A line something can snap to, with the stretch of it that the target really occupies. */
export interface SnapLine {
  pos: number;
  from: number;
  to: number;
}

export interface SnapTargets {
  x: SnapLine[];
  y: SnapLine[];
}

export interface Guide extends SnapLine {
  axis: "x" | "y";
}

/** Which edges of the box follow the pointer during a resize. */
export interface MovingEdges {
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
}

const EPS = 0.01;

/** Lines of one box: both edges and the centre, per axis. */
export function boxLines(box: SnapBox): SnapTargets {
  const v = { from: box.y, to: box.y + box.height };
  const h = { from: box.x, to: box.x + box.width };
  return {
    x: [box.x, box.x + box.width / 2, box.x + box.width].map((pos) => ({ pos, ...v })),
    y: [box.y, box.y + box.height / 2, box.y + box.height].map((pos) => ({ pos, ...h })),
  };
}

/**
 * Everything on a surface that can be snapped to: the edges and centre of every slide, and the
 * edges and centre of every visible element that is not being manipulated (locked ones included).
 */
export function collectSnapTargets(project: Project, surfaceId: string, exclude: ReadonlySet<string>): SnapTargets {
  const surface = getSurface(project, surfaceId);
  const out: SnapTargets = { x: [], y: [] };
  if (!surface) return out;
  for (const offset of getSlideOffsets(project, surfaceId)) {
    const slide = boxLines({ x: offset, y: 0, width: project.width, height: surface.height });
    out.x.push(...slide.x);
  }
  out.y.push(...boxLines({ x: 0, y: 0, width: surface.width, height: surface.height }).y);
  for (const el of surface.elements) {
    if (!el.visible || exclude.has(el.id)) continue;
    const lines = boxLines(rotatedBounds(el));
    out.x.push(...lines.x);
    out.y.push(...lines.y);
  }
  return out;
}

interface Hit {
  delta: number;
}

/** Smallest shift that puts one of `edges` on one of `lines`, if any is within the threshold. */
function nearest(edges: number[], lines: SnapLine[], threshold: number): Hit | null {
  let best: Hit | null = null;
  for (const edge of edges)
    for (const line of lines) {
      const delta = line.pos - edge;
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta };
    }
  return best;
}

/** Guides for every target line that one of the given edge positions now sits on. */
function guidesFor(axis: "x" | "y", edges: number[], lines: SnapLine[], box: SnapBox): Guide[] {
  const from = axis === "x" ? box.y : box.x;
  const to = axis === "x" ? box.y + box.height : box.x + box.width;
  const byPos = new Map<number, Guide>();
  for (const edge of edges)
    for (const line of lines) {
      if (Math.abs(line.pos - edge) > EPS) continue;
      const key = Math.round(line.pos * 100);
      const g = byPos.get(key);
      if (g) {
        g.from = Math.min(g.from, line.from);
        g.to = Math.max(g.to, line.to);
      } else byPos.set(key, { axis, pos: line.pos, from: Math.min(from, line.from), to: Math.max(to, line.to) });
    }
  return [...byPos.values()];
}

const xEdges = (b: SnapBox) => [b.x, b.x + b.width / 2, b.x + b.width];
const yEdges = (b: SnapBox) => [b.y, b.y + b.height / 2, b.y + b.height];

/** Snap a box that is being moved. Returns the shift to apply and the guides to draw. */
export function snapMove(box: SnapBox, targets: SnapTargets, threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const dx = nearest(xEdges(box), targets.x, threshold)?.delta ?? 0;
  const dy = nearest(yEdges(box), targets.y, threshold)?.delta ?? 0;
  const moved = { ...box, x: box.x + dx, y: box.y + dy };
  return { dx, dy, guides: [...guidesFor("x", xEdges(moved), targets.x, moved), ...guidesFor("y", yEdges(moved), targets.y, moved)] };
}

/**
 * Snap a box that is being resized. Only the edges that follow the pointer snap; the others stay.
 * With `keepRatio` (corner handles of photos, text and multi-selections) one axis snaps, the
 * closer one, and the other follows so the shape is kept.
 */
export function snapResize(
  box: SnapBox,
  edges: MovingEdges,
  targets: SnapTargets,
  threshold: number,
  options: { keepRatio?: boolean; minSize?: number } = {},
): { box: SnapBox; guides: Guide[] } {
  const min = options.minSize ?? 1;
  const movesX = !!edges.left !== !!edges.right;
  const movesY = !!edges.top !== !!edges.bottom;
  const xEdge = edges.left ? box.x : box.x + box.width;
  const yEdge = edges.top ? box.y : box.y + box.height;
  let hx = movesX ? nearest([xEdge], targets.x, threshold) : null;
  let hy = movesY ? nearest([yEdge], targets.y, threshold) : null;

  // Width and height after moving the pointer-side edge by a delta.
  const widthWith = (delta: number) => (edges.left ? box.width - delta : box.width + delta);
  const heightWith = (delta: number) => (edges.top ? box.height - delta : box.height + delta);
  if (hx && widthWith(hx.delta) < min) hx = null;
  if (hy && heightWith(hy.delta) < min) hy = null;

  let width = box.width;
  let height = box.height;
  if (options.keepRatio && movesX && movesY && box.width > 0 && box.height > 0) {
    const ratio = box.width / box.height;
    if (hx && hy) {
      if (Math.abs(hx.delta) <= Math.abs(hy.delta)) hy = null;
      else hx = null;
    }
    if (hx) {
      width = widthWith(hx.delta);
      height = width / ratio;
    } else if (hy) {
      height = heightWith(hy.delta);
      width = height * ratio;
    }
    if (width < min || height < min) return { box, guides: [] };
  } else {
    if (hx) width = widthWith(hx.delta);
    if (hy) height = heightWith(hy.delta);
  }

  const next: SnapBox = {
    x: edges.left ? box.x + box.width - width : box.x,
    y: edges.top ? box.y + box.height - height : box.y,
    width,
    height,
  };
  const guides: Guide[] = [];
  // Guides are found from the final box, so an edge that lands on a line by following the ratio shows too.
  if (movesX && (hx || hy)) guides.push(...guidesFor("x", [edges.left ? next.x : next.x + next.width], targets.x, next));
  if (movesY && (hx || hy)) guides.push(...guidesFor("y", [edges.top ? next.y : next.y + next.height], targets.y, next));
  return { box: next, guides };
}

/** Edges that follow the pointer for a Konva transformer anchor name such as "bottom-right". */
export function edgesForAnchor(anchor: string | null | undefined): MovingEdges | null {
  if (!anchor || anchor === "rotater") return null;
  const edges: MovingEdges = { left: anchor.includes("left"), right: anchor.includes("right"), top: anchor.includes("top"), bottom: anchor.includes("bottom") };
  return edges.left || edges.right || edges.top || edges.bottom ? edges : null;
}

export function unionBox(boxes: SnapBox[]): SnapBox | null {
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
}
