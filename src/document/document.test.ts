import { describe, expect, it } from "vitest";
import { createImage, createProject, createShape, createText, placementFor } from "./factory";
import {
  coverCrop,
  fitToViewport,
  fitWithin,
  getExportFrames,
  getSlideOffsets,
  getSurfaces,
  PANORAMA_ID,
  rotatedBounds,
  slidesTouched,
} from "./geometry";
import { DocumentError, migrateProject, parseProject } from "./migrations";
import * as ops from "./operations";
import { projectSchema, SCHEMA_VERSION } from "./schema";

const portrait = (slideCount: number, mode: "independent" | "seamless") =>
  createProject({ name: "Test", width: 1080, height: 1350, slideCount, mode });
const place = { centerX: 540, centerY: 675, maxWidth: 1080, maxHeight: 1350 };

describe("factory", () => {
  it("creates a valid project with the requested slides", () => {
    const p = portrait(10, "independent");
    expect(p.slides).toHaveLength(10);
    expect(new Set(p.slides.map((s) => s.id)).size).toBe(10);
    expect(projectSchema.safeParse(p).success).toBe(true);
  });

  it("creates valid elements centered on the placement", () => {
    let p = portrait(1, "independent");
    const id = p.slides[0].id;
    const text = createText("heading", place);
    const star = createShape("star", place);
    const arrow = createShape("arrow", place);
    const image = createImage({ id: "a1", name: "pic.jpg", mime: "image/jpeg", width: 4000, height: 3000, size: 10 }, place);
    p = ops.addElements(p, id, [text, star, arrow, image]);
    expect(projectSchema.safeParse(p).success).toBe(true);
    expect(star.x + star.width / 2).toBeCloseTo(540, 0);
    expect(image.width / image.height).toBeCloseTo(4 / 3, 2);
    expect(image.width).toBeLessThanOrEqual(1080 * 0.8);
  });

  it("places new elements on the focused slide of a panorama", () => {
    const pl = placementFor({ width: 6480, height: 1350 }, 1080, 3 * 1080);
    expect(pl.centerX).toBe(3780);
    expect(pl.maxWidth).toBe(1080);
  });
});

describe("geometry", () => {
  it("seamless: one panorama surface as wide as all slides", () => {
    const p = portrait(6, "seamless");
    const surfaces = getSurfaces(p);
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]).toMatchObject({ id: PANORAMA_ID, width: 6480, height: 1350 });
    expect(getSlideOffsets(p, PANORAMA_ID)).toEqual([0, 1080, 2160, 3240, 4320, 5400]);
  });

  it("seamless: export frames tile the panorama exactly, with no gap or overlap", () => {
    const p = portrait(6, "seamless");
    const frames = getExportFrames(p);
    expect(frames.map((f) => f.x)).toEqual([0, 1080, 2160, 3240, 4320, 5400]);
    frames.forEach((f, i) => {
      expect(f).toMatchObject({ slideIndex: i, surfaceId: PANORAMA_ID, y: 0, width: 1080, height: 1350 });
      if (i > 0) expect(f.x).toBe(frames[i - 1].x + frames[i - 1].width);
    });
    expect(frames[5].x + frames[5].width).toBe(getSurfaces(p)[0].width);
  });

  it("independent: one surface and one frame per slide, in slide order", () => {
    const p = portrait(3, "independent");
    expect(getSurfaces(p).map((s) => s.id)).toEqual(p.slides.map((s) => s.id));
    expect(getExportFrames(p).map((f) => [f.slideIndex, f.surfaceId, f.x])).toEqual(p.slides.map((s, i) => [i, s.id, 0]));
  });

  it("coverCrop keeps the box aspect ratio and stays inside the image", () => {
    const wide = coverCrop(4000, 2000, 1000, 1000);
    expect(wide).toEqual({ x: 1000, y: 0, width: 2000, height: 2000 });
    const tall = coverCrop(2000, 4000, 1000, 500);
    expect(tall.width / tall.height).toBeCloseTo(2);
    expect(tall.y).toBe(1500);
    expect(coverCrop(800, 600, 400, 300)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it("fitWithin never upscales", () => {
    expect(fitWithin(200, 100, 1000, 1000)).toEqual({ width: 200, height: 100 });
    expect(fitWithin(4000, 2000, 1000, 1000)).toEqual({ width: 1000, height: 500 });
  });

  it("fitToViewport centers the surface", () => {
    const v = fitToViewport(1080, 1350, 1000, 800, 40);
    expect(v.scale).toBeCloseTo(720 / 1350);
    expect(v.x + (1080 * v.scale) / 2).toBeCloseTo(500);
    expect(v.y + (1350 * v.scale) / 2).toBeCloseTo(400);
  });

  it("rotatedBounds and slidesTouched detect elements crossing slide boundaries", () => {
    const rb = rotatedBounds({ x: 0, y: 0, width: 100, height: 50, rotation: 90 });
    expect(rb.x).toBeCloseTo(25);
    expect(rb.y).toBeCloseTo(-25);
    expect(rb.width).toBeCloseTo(50);
    const p = portrait(6, "seamless");
    const el = { ...createShape("rect", place), x: 1000, y: 100, width: 300, height: 100 };
    expect(slidesTouched(p, el)).toEqual([0, 1]);
    expect(slidesTouched(p, { ...el, x: 1080, width: 1080 })).toEqual([1]);
  });
});

describe("operations", () => {
  const setup = () => {
    let p = portrait(3, "independent");
    const sid = p.slides[0].id;
    const a = createShape("rect", place);
    const b = createShape("ellipse", place);
    const c = createText("body", place);
    p = ops.addElements(p, sid, [a, b, c]);
    return { p, sid, a, b, c };
  };
  const order = (p: ReturnType<typeof portrait>, sid: string) => ops.getElements(p, sid).map((e) => e.id);

  it("never mutates the previous document", () => {
    const { p, sid, a } = setup();
    const frozen = JSON.stringify(p);
    const next = ops.updateElements(p, sid, [a.id], { x: 999 });
    expect(JSON.stringify(p)).toBe(frozen);
    expect(ops.getElements(next, sid)[0].x).toBe(999);
    // Untouched slides are shared, which is what makes undo snapshots cheap.
    expect(next.slides[1]).toBe(p.slides[1]);
  });

  it("a patch cannot change element identity", () => {
    const { p, sid, a } = setup();
    const next = ops.updateElements(p, sid, [a.id], { id: "hack", type: "text" } as never);
    expect(ops.getElements(next, sid)[0]).toMatchObject({ id: a.id, type: "shape" });
  });

  it("reorders layers", () => {
    const { p, sid, a, b, c } = setup();
    expect(order(ops.reorderElement(p, sid, a.id, "forward"), sid)).toEqual([b.id, a.id, c.id]);
    expect(order(ops.reorderElement(p, sid, a.id, "front"), sid)).toEqual([b.id, c.id, a.id]);
    expect(order(ops.reorderElement(p, sid, c.id, "back"), sid)).toEqual([c.id, a.id, b.id]);
    expect(order(ops.reorderElement(p, sid, c.id, "backward"), sid)).toEqual([a.id, c.id, b.id]);
    expect(ops.reorderElement(p, sid, c.id, "forward")).toBe(p);
    expect(order(ops.moveElementToIndex(p, sid, a.id, 99), sid)).toEqual([b.id, c.id, a.id]);
  });

  it("duplicates with new ids on top of the stack and removes", () => {
    const { p, sid, a, b } = setup();
    const { project, newIds } = ops.duplicateElements(p, sid, [a.id, b.id]);
    expect(newIds).toHaveLength(2);
    expect(order(project, sid).slice(-2)).toEqual(newIds);
    expect(newIds).not.toContain(a.id);
    expect(order(ops.removeElements(project, sid, newIds), sid)).toEqual(order(p, sid));
  });

  it("adds, duplicates, reorders, renames and removes slides", () => {
    const { p } = setup();
    const added = ops.addSlide(p, 1);
    expect(added.project.slides[1].id).toBe(added.slide!.id);
    const dup = ops.duplicateSlide(p, p.slides[0].id);
    expect(dup.project.slides).toHaveLength(4);
    expect(dup.project.slides[1].elements).toHaveLength(3);
    expect(dup.project.slides[1].elements[0].id).not.toBe(p.slides[0].elements[0].id);
    const moved = ops.moveSlide(p, p.slides[0].id, 2);
    expect(moved.slides.map((s) => s.id)).toEqual([p.slides[1].id, p.slides[2].id, p.slides[0].id]);
    expect(ops.renameSlide(p, p.slides[0].id, " Cover ").slides[0].name).toBe("Cover");
    expect(ops.removeSlide(p, p.slides[0].id).slides).toHaveLength(2);
    const single = portrait(1, "independent");
    expect(ops.removeSlide(single, single.slides[0].id)).toBe(single);
  });

  it("caps the slide count", () => {
    const full = portrait(20, "independent");
    expect(ops.addSlide(full).slide).toBeNull();
    expect(ops.duplicateSlide(full, full.slides[0].id).slide).toBeNull();
  });

  it("works on the panorama surface", () => {
    let p = portrait(4, "seamless");
    const el = createShape("rect", place);
    p = ops.addElements(p, PANORAMA_ID, [el]);
    p = ops.setBackground(p, PANORAMA_ID, { type: "solid", color: "#ff0000" });
    expect(p.panorama.elements).toHaveLength(1);
    expect(getSurfaces(p)[0].background).toEqual({ type: "solid", color: "#ff0000" });
    expect(projectSchema.safeParse(p).success).toBe(true);
  });

  it("tracks used assets and clones projects with fresh ids", () => {
    let p = portrait(2, "independent");
    const asset = { id: "asset-1", name: "a.png", mime: "image/png", width: 100, height: 100, size: 1 };
    p = ops.addAssetRef(ops.addAssetRef(p, asset), asset);
    expect(p.assets).toHaveLength(1);
    expect(ops.usedAssetIds(p).size).toBe(0);
    p = ops.addElements(p, p.slides[1].id, [createImage(asset, place)]);
    expect([...ops.usedAssetIds(p)]).toEqual(["asset-1"]);
    const copy = ops.cloneProject(p, "Copy");
    expect(copy.id).not.toBe(p.id);
    expect(copy.slides[1].id).not.toBe(p.slides[1].id);
    expect(copy.slides[1].elements[0].id).not.toBe(p.slides[1].elements[0].id);
    expect([...ops.usedAssetIds(copy)]).toEqual(["asset-1"]);
    expect(projectSchema.safeParse(copy).success).toBe(true);
  });
});

describe("migrations and validation", () => {
  it("round-trips a current document through JSON", () => {
    const p = portrait(2, "seamless");
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it("upgrades a version 0 document", () => {
    const { schemaVersion: _v, mode: _m, panorama: _p, assets: _a, ...legacy } = portrait(2, "independent");
    void [_v, _m, _p, _a];
    const upgraded = parseProject(legacy);
    expect(upgraded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(upgraded.mode).toBe("independent");
    expect(upgraded.panorama.elements).toEqual([]);
  });

  it("rejects documents from the future and corrupted documents", () => {
    expect(() => migrateProject({ schemaVersion: SCHEMA_VERSION + 1 })).toThrow(DocumentError);
    expect(() => parseProject(null)).toThrow(DocumentError);
    const p = portrait(1, "independent");
    const broken = { ...p, slides: [{ ...p.slides[0], elements: [{ ...createShape("rect", place), width: -5 }] }] };
    expect(() => parseProject(broken)).toThrow(/validation/);
    const dupId = createShape("rect", place);
    const dup = { ...p, slides: [{ ...p.slides[0], elements: [dupId, dupId] }] };
    expect(() => parseProject(dup)).toThrow(DocumentError);
  });
});
