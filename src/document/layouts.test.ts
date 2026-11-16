import { describe, expect, it } from "vitest";
import { assignBoxes, clampLayoutCount, LAYOUT_KINDS, layoutArea, layoutBoxes, MAX_LAYOUT_COUNT, MIN_LAYOUT_COUNT, type Area, type LayoutBox } from "./layouts";

const portrait: Area = { x: 65, y: 65, width: 950, height: 1220 };
const wide: Area = { x: 0, y: 0, width: 1600, height: 900 };
const overlaps = (a: LayoutBox, b: LayoutBox) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
const inside = (b: LayoutBox, area: Area, slack = 1) =>
  b.x >= area.x - slack && b.y >= area.y - slack && b.x + b.width <= area.x + area.width + slack && b.y + b.height <= area.y + area.height + slack;
const anyOverlap = (boxes: LayoutBox[]) => boxes.some((a, i) => boxes.some((b, j) => j > i && overlaps(a, b)));
const bounds = (boxes: LayoutBox[]) => ({
  x: Math.min(...boxes.map((b) => b.x)),
  y: Math.min(...boxes.map((b) => b.y)),
  right: Math.max(...boxes.map((b) => b.x + b.width)),
  bottom: Math.max(...boxes.map((b) => b.y + b.height)),
});

describe("photo layouts", () => {
  it("returns exactly the requested number of whole-pixel boxes inside the area, for every kind and count", () => {
    for (const area of [portrait, wide]) {
      for (const kind of LAYOUT_KINDS) {
        for (let n = MIN_LAYOUT_COUNT; n <= MAX_LAYOUT_COUNT; n++) {
          const boxes = layoutBoxes(kind, n, area, { gap: 16 });
          expect(boxes, `${kind} ${n}`).toHaveLength(n);
          for (const b of boxes) {
            expect(inside(b, area), `${kind} ${n} ${JSON.stringify(b)}`).toBe(true);
            expect(b.width).toBeGreaterThan(8);
            expect(b.height).toBeGreaterThan(8);
            expect([b.x, b.y, b.width, b.height, b.rotation].every(Number.isInteger)).toBe(true);
          }
        }
      }
    }
  });

  it("tiles without overlap and fills the whole area: grid, masonry, collage, magazine", () => {
    for (const area of [portrait, wide]) {
      for (const kind of ["grid", "masonry", "collage", "magazine"] as const) {
        for (let n = MIN_LAYOUT_COUNT; n <= MAX_LAYOUT_COUNT; n++) {
          const boxes = layoutBoxes(kind, n, area, { gap: 12 });
          expect(anyOverlap(boxes), `${kind} ${n}`).toBe(false);
          const b = bounds(boxes);
          expect(Math.abs(b.x - area.x) <= 1 && Math.abs(b.y - area.y) <= 1, `${kind} ${n}`).toBe(true);
          expect(Math.abs(b.right - (area.x + area.width)) <= 1 && Math.abs(b.bottom - (area.y + area.height)) <= 1, `${kind} ${n}`).toBe(true);
          expect(boxes.every((x) => x.rotation === 0)).toBe(true);
        }
      }
    }
  });

  it("keeps the gap between neighbours in a grid", () => {
    const [a, b, c] = layoutBoxes("grid", 4, { x: 0, y: 0, width: 1000, height: 1000 }, { gap: 20 });
    expect(b.x - (a.x + a.width)).toBe(20);
    expect(c.y - (a.y + a.height)).toBe(20);
    expect(a.width).toBe(490);
  });

  it("stretches a short last grid row to the full width", () => {
    const boxes = layoutBoxes("grid", 5, { x: 0, y: 0, width: 900, height: 900 }, { gap: 0 });
    const lastRowY = Math.max(...boxes.map((b) => b.y));
    const last = boxes.filter((b) => b.y === lastRowY);
    expect(last.reduce((w, b) => w + b.width, 0)).toBe(900);
  });

  it("gives each kind its character", () => {
    const mag = layoutBoxes("magazine", 4, portrait, { gap: 10 });
    expect(mag[0].width).toBe(portrait.width);
    expect(mag[0].height).toBeGreaterThan(mag[1].height * 1.5);
    expect(layoutBoxes("magazine", 4, wide, { gap: 10 })[0].height).toBe(wide.height); // hero on the left when wide

    const col = layoutBoxes("collage", 5, portrait, { gap: 10 });
    const sizes = col.map((b) => b.width * b.height);
    expect(sizes[0]).toBe(Math.max(...sizes));
    expect(new Set(sizes).size).toBeGreaterThan(2);

    const mas = layoutBoxes("masonry", 6, portrait, { gap: 10 });
    expect(new Set(mas.map((b) => b.width)).size).toBeLessThanOrEqual(2); // equal columns (rounding)
    expect(new Set(mas.map((b) => b.height)).size).toBeGreaterThan(2);

    const con = layoutBoxes("contact", 6, portrait, { gap: 10 });
    expect(new Set(con.map((b) => `${b.width}x${b.height}`)).size).toBe(1);
    expect(con[0].width / con[0].height).toBeCloseTo(1.5, 1);
    expect(anyOverlap(con)).toBe(false);

    const ov = layoutBoxes("overlap", 4, portrait);
    expect(overlaps(ov[0], ov[1]) && overlaps(ov[1], ov[2])).toBe(true);
    expect(ov.map((b) => b.rotation)).toEqual([-3, 3, -3, 3]);

    const scr = layoutBoxes("scrapbook", 6, portrait, { gap: 10 });
    expect(scr.some((b) => b.rotation !== 0)).toBe(true);
    expect(scr.every((b) => Math.abs(b.rotation) <= 8)).toBe(true);
  });

  it("is repeatable, and the scrapbook changes with the seed only", () => {
    for (const kind of LAYOUT_KINDS) expect(layoutBoxes(kind, 7, portrait, { gap: 8 })).toEqual(layoutBoxes(kind, 7, portrait, { gap: 8 }));
    expect(layoutBoxes("scrapbook", 5, portrait, { seed: 2 })).not.toEqual(layoutBoxes("scrapbook", 5, portrait, { seed: 3 }));
  });

  it("clamps count and an oversized gap", () => {
    expect([clampLayoutCount(0), clampLayoutCount(99), clampLayoutCount(3.6), clampLayoutCount(NaN)]).toEqual([2, 12, 4, 2]);
    expect(layoutBoxes("grid", 1, portrait)).toHaveLength(2);
    const boxes = layoutBoxes("grid", 9, { x: 0, y: 0, width: 300, height: 300 }, { gap: 5000 });
    expect(boxes.every((b) => b.width >= 50 && inside(b, { x: 0, y: 0, width: 300, height: 300 }))).toBe(true);
  });

  it("computes the slide area with a margin, shifted for seamless slides", () => {
    expect(layoutArea(1080, 1350)).toEqual({ x: 65, y: 65, width: 950, height: 1220 });
    expect(layoutArea(1080, 1350, 2160)).toMatchObject({ x: 2225, width: 950 });
    expect(layoutArea(1000, 1000, 0, 0)).toEqual({ x: 0, y: 0, width: 1000, height: 1000 });
  });

  it("assigns boxes in reading order", () => {
    const els = [
      { id: "bottom-right", x: 600, y: 610, width: 300, height: 300 },
      { id: "top-right", x: 600, y: 20, width: 300, height: 300 },
      { id: "top-left", x: 10, y: 60, width: 300, height: 300 }, // slightly lower than top-right, same row
      { id: "bottom-left", x: 0, y: 600, width: 300, height: 300 },
    ];
    const boxes = layoutBoxes("grid", 4, { x: 0, y: 0, width: 1000, height: 1000 });
    const map = assignBoxes(els, boxes);
    expect(map.get("top-left")).toEqual(boxes[0]);
    expect(map.get("top-right")).toEqual(boxes[1]);
    expect(map.get("bottom-left")).toEqual(boxes[2]);
    expect(map.get("bottom-right")).toEqual(boxes[3]);
    expect(assignBoxes(els, boxes.slice(0, 2)).size).toBe(2);
  });
});
