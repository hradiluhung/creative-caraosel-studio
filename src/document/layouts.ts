/**
 * Photo frame layouts: pure geometry, no elements, no randomness.
 * Every generator returns exactly `count` boxes inside `area` (rotated ones may poke out a little).
 */

export const LAYOUT_KINDS = ["grid", "masonry", "collage", "magazine", "overlap", "contact", "scrapbook"] as const;
export type LayoutKind = (typeof LAYOUT_KINDS)[number];

export const LAYOUT_LABELS: Record<LayoutKind, string> = {
  grid: "Grid",
  masonry: "Masonry",
  collage: "Asymmetric collage",
  magazine: "Magazine",
  overlap: "Overlapping",
  contact: "Contact sheet",
  scrapbook: "Scrapbook",
};

export const MIN_LAYOUT_COUNT = 2;
export const MAX_LAYOUT_COUNT = 12;

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LayoutBox extends Area {
  rotation: number;
}

const flat = (a: Area): LayoutBox => ({ x: Math.round(a.x), y: Math.round(a.y), width: Math.max(1, Math.round(a.width)), height: Math.max(1, Math.round(a.height)), rotation: 0 });

/** Small deterministic generator (mulberry32) so "random looking" layouts are repeatable. */
function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rows and columns for n cells that keep cells close to the shape of the area. */
function gridShape(n: number, area: Area) {
  let best = { cols: 1, rows: n, score: Infinity };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellRatio = area.width / cols / (area.height / rows);
    // Prefer cells near square-to-portrait and few empty slots.
    const score = Math.abs(Math.log(cellRatio / 0.9)) + (cols * rows - n) * 0.35;
    if (score < best.score) best = { cols, rows, score };
  }
  return best;
}

/** Split a length into n parts with gaps between them. */
function split(start: number, length: number, n: number, gap: number, weights?: number[]) {
  const usable = Math.max(n, length - gap * (n - 1));
  const w = weights ?? Array.from({ length: n }, () => 1);
  const total = w.reduce((a, b) => a + b, 0);
  const out: Array<{ start: number; size: number }> = [];
  let at = start;
  for (let i = 0; i < n; i++) {
    const size = (usable * w[i]) / total;
    out.push({ start: at, size });
    at += size + gap;
  }
  return out;
}

/** Equal rows; a short last row is stretched to the full width. */
function grid(n: number, area: Area, gap: number): LayoutBox[] {
  const { cols, rows } = gridShape(n, area);
  const out: LayoutBox[] = [];
  split(area.y, area.height, rows, gap).forEach((row, r) => {
    const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols;
    for (const col of split(area.x, area.width, inRow, gap)) out.push(flat({ x: col.start, y: row.start, width: col.size, height: row.size }));
  });
  return out;
}

const MASONRY_HEIGHTS = [1.35, 0.85, 1, 1.5, 0.9, 1.2, 0.8, 1.4];

/** Equal columns with uneven heights; every column fills the full height. */
function masonry(n: number, area: Area, gap: number): LayoutBox[] {
  const cols = Math.min(n, n <= 4 ? 2 : n <= 9 ? 3 : 4);
  const columns: number[][] = Array.from({ length: cols }, () => []);
  const filled = Array.from({ length: cols }, () => 0);
  for (let i = 0; i < n; i++) {
    const shortest = filled.indexOf(Math.min(...filled));
    const h = MASONRY_HEIGHTS[i % MASONRY_HEIGHTS.length];
    columns[shortest].push(h);
    filled[shortest] += h;
  }
  const out: LayoutBox[] = [];
  split(area.x, area.width, cols, gap).forEach((col, c) => {
    for (const row of split(area.y, area.height, columns[c].length, gap, columns[c])) out.push(flat({ x: col.start, y: row.start, width: col.size, height: row.size }));
  });
  return out;
}

/** Up to three frames split off one after another, turning each time; the remainder is tiled. */
function collage(n: number, area: Area, gap: number): LayoutBox[] {
  const out: LayoutBox[] = [];
  const heroes = Math.min(n - 1, 3);
  let rest = { ...area };
  for (let i = 0; i < heroes; i++) {
    const after = n - i - 1;
    const share = after === 1 ? 0.5 : i === 0 ? 0.58 : 0.5;
    if (rest.width >= rest.height) {
      const w = (rest.width - gap) * share;
      out.push(flat({ ...rest, width: w }));
      rest = { ...rest, x: rest.x + w + gap, width: rest.width - w - gap };
    } else {
      const h = (rest.height - gap) * share;
      out.push(flat({ ...rest, height: h }));
      rest = { ...rest, y: rest.y + h + gap, height: rest.height - h - gap };
    }
  }
  const left = n - heroes;
  return left === 1 ? [...out, flat(rest)] : [...out, ...grid(left, rest, gap)];
}

/** A hero frame with a strip of small ones under it (beside it on wide areas). */
function magazine(n: number, area: Area, gap: number): LayoutBox[] {
  const small = n - 1;
  const wide = area.width > area.height * 1.2;
  const heroShare = small <= 2 ? 0.62 : 0.7;
  if (wide) {
    const w = (area.width - gap) * heroShare;
    const hero = flat({ ...area, width: w });
    return [hero, ...split(area.y, area.height, small, gap).map((r) => flat({ x: area.x + w + gap, y: r.start, width: area.width - w - gap, height: r.size }))];
  }
  const h = (area.height - gap) * heroShare;
  const hero = flat({ ...area, height: h });
  return [hero, ...split(area.x, area.width, small, gap).map((c) => flat({ x: c.start, y: area.y + h + gap, width: c.size, height: area.height - h - gap }))];
}

/** Frames of one size stepping along the diagonal, each covering part of the previous one. */
function overlap(n: number, area: Area): LayoutBox[] {
  const scale = n <= 3 ? 0.6 : n <= 6 ? 0.48 : 0.38;
  const width = area.width * scale;
  const height = Math.min(area.height * scale, width * 1.25);
  const stepX = (area.width - width) / (n - 1);
  const stepY = (area.height - height) / (n - 1);
  return Array.from({ length: n }, (_, i) => ({
    ...flat({ x: area.x + stepX * i, y: area.y + stepY * i, width, height }),
    rotation: i % 2 === 0 ? -3 : 3,
  }));
}

/** Equal 3:2 cells in rows, like a film contact sheet. Cells are never stretched. */
function contact(n: number, area: Area, gap: number): LayoutBox[] {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const space = Math.max(gap, Math.round(area.width * 0.03));
  let width = (area.width - space * (cols - 1)) / cols;
  let height = (width * 2) / 3;
  const maxHeight = (area.height - space * (rows - 1)) / rows;
  if (height > maxHeight) {
    height = maxHeight;
    width = (height * 3) / 2;
  }
  const left = area.x + (area.width - (width * cols + space * (cols - 1))) / 2;
  const top = area.y + (area.height - (height * rows + space * (rows - 1))) / 2;
  return Array.from({ length: n }, (_, i) => flat({ x: left + (i % cols) * (width + space), y: top + Math.floor(i / cols) * (height + space), width, height }));
}

/** Grid positions, shrunk, nudged and tilted by a repeatable amount. */
function scrapbook(n: number, area: Area, gap: number, seed: number): LayoutBox[] {
  const next = seeded(seed + n * 7919);
  return grid(n, area, gap).map((cell) => {
    const width = cell.width * 0.86;
    const height = cell.height * 0.86;
    const freeX = cell.width - width;
    const freeY = cell.height - height;
    return {
      ...flat({ x: cell.x + freeX * next(), y: cell.y + freeY * next(), width, height }),
      rotation: Math.round((next() * 2 - 1) * 8),
    };
  });
}

export function clampLayoutCount(count: number): number {
  return Math.min(MAX_LAYOUT_COUNT, Math.max(MIN_LAYOUT_COUNT, Math.round(count) || MIN_LAYOUT_COUNT));
}

export function layoutBoxes(kind: LayoutKind, count: number, area: Area, options: { gap?: number; seed?: number } = {}): LayoutBox[] {
  const n = clampLayoutCount(count);
  const gap = Math.max(0, Math.min(options.gap ?? 0, Math.min(area.width, area.height) / (n * 2)));
  switch (kind) {
    case "grid":
      return grid(n, area, gap);
    case "masonry":
      return masonry(n, area, gap);
    case "collage":
      return collage(n, area, gap);
    case "magazine":
      return magazine(n, area, gap);
    case "overlap":
      return overlap(n, area);
    case "contact":
      return contact(n, area, gap);
    case "scrapbook":
      return scrapbook(n, area, gap, options.seed ?? 1);
  }
}

/** The area layouts fill on one slide: the slide minus an even margin. */
export function layoutArea(slideWidth: number, slideHeight: number, slideOffset = 0, margin = Math.round(Math.min(slideWidth, slideHeight) * 0.06)): Area {
  return { x: slideOffset + margin, y: margin, width: slideWidth - margin * 2, height: slideHeight - margin * 2 };
}

/**
 * Pair existing frames with layout boxes in reading order (top to bottom, then left to right),
 * so rearranging keeps photos roughly where the eye expects them.
 */
export function assignBoxes<T extends { id: string; x: number; y: number; width: number; height: number }>(elements: T[], boxes: LayoutBox[]): Map<string, LayoutBox> {
  const rowTolerance = Math.max(1, Math.min(...elements.map((e) => e.height)) / 2);
  const reading = <B extends Area>(a: B, b: B) => {
    const ay = a.y + a.height / 2;
    const by = b.y + b.height / 2;
    return Math.abs(ay - by) > rowTolerance ? ay - by : a.x + a.width / 2 - (b.x + b.width / 2);
  };
  const sorted = [...elements].sort(reading);
  const out = new Map<string, LayoutBox>();
  sorted.forEach((el, i) => boxes[i] && out.set(el.id, boxes[i]));
  return out;
}
