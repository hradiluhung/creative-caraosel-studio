import { describe, expect, it } from "vitest";
import { createProject, createShape } from "./factory";
import { PANORAMA_ID } from "./geometry";
import * as ops from "./operations";
import { boxLines, collectSnapTargets, edgesForAnchor, snapMove, snapResize, unionBox, type SnapTargets } from "./snapping";

const slide: SnapTargets = boxLines({ x: 0, y: 0, width: 1000, height: 1000 });
const withBox = (b: { x: number; y: number; width: number; height: number }): SnapTargets => {
  const l = boxLines(b);
  return { x: [...slide.x, ...l.x], y: [...slide.y, ...l.y] };
};
const pos = (guides: Array<{ axis: string; pos: number }>) => guides.map((g) => `${g.axis}:${g.pos}`).sort();

describe("snap targets", () => {
  const base = createProject({ name: "t", width: 1000, height: 1000, slideCount: 3, mode: "independent" }, new Date("2026-01-01"));
  const place = (x: number, y: number, extra: object = {}) => ({ ...createShape("rect", { centerX: 0, centerY: 0, maxWidth: 100, maxHeight: 100 } as never), x, y, width: 200, height: 100, rotation: 0, ...extra });

  it("offers slide edges and centre plus every other visible element, locked ones too", () => {
    const a = place(100, 100);
    const b = place(500, 600, { locked: true });
    const hidden = place(700, 700, { visible: false });
    const p = ops.addElements(base, base.slides[0].id, [a, b, hidden]);
    const t = collectSnapTargets(p, base.slides[0].id, new Set([a.id]));
    expect(t.x.map((l) => l.pos)).toEqual([0, 500, 1000, 500, 600, 700]);
    expect(t.y.map((l) => l.pos)).toEqual([0, 500, 1000, 600, 650, 700]);
    expect(t.x[3]).toEqual({ pos: 500, from: 600, to: 700 }); // extent of the element, for the guide
    expect(collectSnapTargets(p, "nope", new Set())).toEqual({ x: [], y: [] });
  });

  it("uses the bounding box of rotated elements", () => {
    const r = place(100, 100, { rotation: 90 }); // 200x100 turned: 100 wide, 200 tall around the same centre
    const p = ops.addElements(base, base.slides[0].id, [r]);
    const t = collectSnapTargets(p, base.slides[0].id, new Set());
    expect(t.x.slice(3).map((l) => Math.round(l.pos))).toEqual([150, 200, 250]);
    expect(t.y.slice(3).map((l) => Math.round(l.pos))).toEqual([50, 150, 250]);
  });

  it("offers every slide boundary of a seamless panorama", () => {
    const pano = createProject({ name: "t", width: 1000, height: 1000, slideCount: 3, mode: "seamless" }, new Date("2026-01-01"));
    const t = collectSnapTargets(pano, PANORAMA_ID, new Set());
    expect(t.x.map((l) => l.pos)).toEqual([0, 500, 1000, 1000, 1500, 2000, 2000, 2500, 3000]);
    expect(t.y.map((l) => l.pos)).toEqual([0, 500, 1000]);
    expect(t.y[0]).toEqual({ pos: 0, from: 0, to: 3000 });
  });
});

describe("snapping while moving", () => {
  it("snaps left, centre and right to slide lines within the threshold only", () => {
    expect(snapMove({ x: 4, y: 300, width: 200, height: 100 }, slide, 6)).toMatchObject({ dx: -4, dy: 0 });
    expect(snapMove({ x: 797, y: 300, width: 200, height: 100 }, slide, 6).dx).toBe(3);
    expect(snapMove({ x: 403, y: 300, width: 200, height: 100 }, slide, 6).dx).toBe(-3); // centre to 500
    expect(snapMove({ x: 300, y: 446, width: 200, height: 100 }, slide, 6).dy).toBe(4); // middle to 500
    expect(snapMove({ x: 10, y: 300, width: 200, height: 100 }, slide, 6)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("snaps to the edges and centre of another object, on both axes at once", () => {
    const other = { x: 100, y: 100, width: 300, height: 200 };
    const t = withBox(other);
    // bottom edge to the other's bottom (300), left edge to the other's right (400)
    const r = snapMove({ x: 403, y: 148, width: 150, height: 150 }, t, 6);
    expect(r).toMatchObject({ dx: -3, dy: 2 });
    expect(pos(r.guides)).toEqual(["x:400", "y:300"]);
    // centre to centre
    expect(snapMove({ x: 198, y: 152, width: 100, height: 100 }, t, 6)).toMatchObject({ dx: 2, dy: -2 });
  });

  it("picks the nearest line and shows every line that ends up aligned", () => {
    const t = withBox({ x: 200, y: 600, width: 100, height: 100 });
    // left is 3 from 200, right is 1 from 300: the right edge wins, and the left then sits on 200 as well
    const r = snapMove({ x: 197 + 2, y: 100, width: 100, height: 100 }, t, 6);
    expect(r.dx).toBe(1);
    expect(pos(r.guides)).toEqual(["x:200", "x:250", "x:300"]);
    const g = r.guides.find((x) => x.pos === 200)!;
    expect([g.from, g.to]).toEqual([100, 700]); // spans the moving box and the target
  });
});

describe("snapping while resizing", () => {
  const first = { x: 100, y: 100, width: 300, height: 400 }; // bottom at 500
  const t = withBox(first);

  it("aligns a dragged bottom edge with the bottom of another object and keeps the rest", () => {
    const r = snapResize({ x: 500, y: 150, width: 200, height: 347 }, { bottom: true }, t, 6);
    expect(r.box).toEqual({ x: 500, y: 150, width: 200, height: 350 });
    expect(pos(r.guides)).toEqual(["y:500"]);
    const g = r.guides[0];
    expect([g.from, g.to]).toEqual([0, 1000]); // the slide middle is on the same line
  });

  it("snaps each edge that follows the pointer: left, right, top", () => {
    expect(snapResize({ x: 403, y: 600, width: 200, height: 100 }, { left: true }, t, 6).box).toEqual({ x: 400, y: 600, width: 203, height: 100 });
    expect(snapResize({ x: 600, y: 600, width: 396, height: 100 }, { right: true }, t, 6).box).toEqual({ x: 600, y: 600, width: 400, height: 100 });
    expect(snapResize({ x: 600, y: 103, width: 100, height: 300 }, { top: true }, t, 6).box).toEqual({ x: 600, y: 100, width: 100, height: 303 });
  });

  it("never moves an edge the pointer is not dragging", () => {
    // The fixed left edge is 2 from the other's right (400) but must stay; nothing near the right edge.
    const r = snapResize({ x: 402, y: 700, width: 131, height: 100 }, { right: true }, t, 6);
    expect(r).toEqual({ box: { x: 402, y: 700, width: 131, height: 100 }, guides: [] });
  });

  it("snaps both edges of a free corner resize independently", () => {
    const r = snapResize({ x: 500, y: 150, width: 497, height: 348 }, { right: true, bottom: true }, t, 6);
    expect(r.box).toEqual({ x: 500, y: 150, width: 500, height: 350 });
    expect(pos(r.guides)).toEqual(["x:1000", "y:500"]);
  });

  it("keeps the shape on a proportional corner resize: the closer axis snaps, the other follows", () => {
    // 2:1 box; right edge is 4 from 1000, bottom is 1 from 500: the bottom wins
    const r = snapResize({ x: 600, y: 301, width: 396, height: 198 }, { right: true, bottom: true }, t, 6, { keepRatio: true });
    expect(r.box).toEqual({ x: 600, y: 301, width: 398, height: 199 });
    expect(pos(r.guides)).toEqual(["y:500"]);
    // top-left handle: the bottom-right corner stays where it is
    const tl = snapResize({ x: 403, y: 601.5, width: 397, height: 198.5 }, { left: true, top: true }, t, 6, { keepRatio: true });
    expect(tl.box.x).toBe(400);
    expect(tl.box.x + tl.box.width).toBe(800);
    expect(tl.box.y + tl.box.height).toBe(800);
    expect(tl.box.width / tl.box.height).toBeCloseTo(2);
  });

  it("does not snap to a size below the minimum and ignores handles that move nothing", () => {
    const tiny = withBox({ x: 600, y: 600, width: 3, height: 3 });
    expect(snapResize({ x: 600, y: 700, width: 8, height: 50 }, { right: true }, tiny, 6, { minSize: 6 }).box.width).toBe(8);
    expect(snapResize({ x: 4, y: 4, width: 100, height: 100 }, {}, slide, 6).box).toEqual({ x: 4, y: 4, width: 100, height: 100 });
  });

  it("maps transformer anchors to edges", () => {
    expect(edgesForAnchor("bottom-right")).toEqual({ left: false, right: true, top: false, bottom: true });
    expect(edgesForAnchor("top-center")).toEqual({ left: false, right: false, top: true, bottom: false });
    expect(edgesForAnchor("middle-left")).toMatchObject({ left: true, top: false, bottom: false });
    expect(edgesForAnchor("rotater")).toBeNull();
    expect(edgesForAnchor(null)).toBeNull();
  });

  it("builds the box around a multi-selection", () => {
    expect(unionBox([{ x: 10, y: 20, width: 30, height: 40 }, { x: 0, y: 50, width: 100, height: 5 }])).toEqual({ x: 0, y: 20, width: 100, height: 40 });
    expect(unionBox([])).toBeNull();
  });
});
