import { describe, expect, it } from "vitest";
import { createImage, createProject } from "@/document/factory";
import { coverCrop, frameCrop, reshapeFrame } from "@/document/geometry";
import { parseProject } from "@/document/migrations";
import * as ops from "@/document/operations";
import { isNeutralLook, NEUTRAL_ADJUSTMENTS, projectSchema, SCHEMA_VERSION } from "@/document/schema";
import { applyColorOverlay, applyDuotone, applyLook } from "./adjust";

const px = (...v: number[]) => new Uint8ClampedArray(v);

describe("free crop", () => {
  it("is the centred cover crop when nothing is set", () => {
    for (const [nw, nh, bw, bh] of [[4000, 3000, 500, 500], [3000, 4000, 800, 200], [100, 100, 300, 600]]) {
      const c = frameCrop(nw, nh, bw, bh);
      expect({ x: c.x, y: c.y, width: c.width, height: c.height }).toEqual(coverCrop(nw, nh, bw, bh));
      expect(frameCrop(nw, nh, bw, bh, { x: 0, y: 0, zoom: 1, turns: 0 })).toEqual(c);
    }
  });

  it("pans across what the frame hides and never leaves the photo", () => {
    // 4000x3000 in a square frame: 1000 px hidden horizontally, nothing vertically
    expect(frameCrop(4000, 3000, 500, 500, { x: -1, y: 0, zoom: 1, turns: 0 })).toMatchObject({ x: 0, y: 0, width: 3000, height: 3000 });
    expect(frameCrop(4000, 3000, 500, 500, { x: 1, y: 1, zoom: 1, turns: 0 })).toMatchObject({ x: 1000, y: 0 });
    expect(frameCrop(4000, 3000, 500, 500, { x: 0.5, y: -1, zoom: 1, turns: 0 }).x).toBe(750);
    for (const x of [-1, -0.3, 0, 0.7, 1])
      for (const zoom of [1, 1.7, 5]) {
        const c = frameCrop(4000, 3000, 640, 360, { x, y: -x, zoom, turns: 0 });
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.x + c.width).toBeLessThanOrEqual(4000 + 1e-9);
        expect(c.y + c.height).toBeLessThanOrEqual(3000 + 1e-9);
        expect(c.width / c.height).toBeCloseTo(640 / 360, 6); // never distorted
      }
  });

  it("zooms towards the pan point", () => {
    const c = frameCrop(4000, 3000, 500, 500, { x: 0, y: 0, zoom: 2, turns: 0 });
    expect(c).toMatchObject({ width: 1500, height: 1500, x: 1250, y: 750 });
    expect(frameCrop(4000, 3000, 500, 500, { x: -1, y: -1, zoom: 2, turns: 0 })).toMatchObject({ x: 0, y: 0 });
    expect(frameCrop(4000, 3000, 500, 500, { x: 1, y: 1, zoom: 2, turns: 0 })).toMatchObject({ x: 2500, y: 1500 });
  });

  it("measures on the turned photo for quarter turns", () => {
    const c = frameCrop(4000, 3000, 300, 400, { x: 0, y: 0, zoom: 1, turns: 1 });
    expect(c).toMatchObject({ turns: 1, sourceWidth: 3000, sourceHeight: 4000, x: 0, y: 0, width: 3000, height: 4000 });
    expect(frameCrop(4000, 3000, 300, 400, { x: 0, y: 0, zoom: 1, turns: 2 })).toMatchObject({ sourceWidth: 4000, sourceHeight: 3000, width: 2250 });
  });

  it("reshapes a frame around its centre", () => {
    expect(reshapeFrame({ x: 100, y: 100, width: 400, height: 300 }, 1)).toEqual({ x: 100, y: 50, width: 400, height: 400 });
    expect(reshapeFrame({ x: 0, y: 0, width: 1600, height: 100 }, 16 / 9)).toEqual({ x: 0, y: -400, width: 1600, height: 900 });
  });
});

describe("duotone and colour overlay", () => {
  it("maps black to the dark colour, white to the light one, grey in between", () => {
    const data = px(0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 200);
    applyDuotone(data, { shadow: "#102030", highlight: "#f0e0d0", amount: 100 });
    expect([...data.slice(0, 4)]).toEqual([0x10, 0x20, 0x30, 255]);
    expect([...data.slice(4, 8)]).toEqual([0xf0, 0xe0, 0xd0, 255]);
    expect(Math.abs(data[8] - 128)).toBeLessThanOrEqual(1);
    expect(data[11]).toBe(200); // alpha untouched
  });

  it("uses brightness, not a single channel, and mixes by amount", () => {
    const green = px(0, 255, 0, 255);
    const blue = px(0, 0, 255, 255);
    applyDuotone(green, { shadow: "#000000", highlight: "#ffffff", amount: 100 });
    applyDuotone(blue, { shadow: "#000000", highlight: "#ffffff", amount: 100 });
    expect(green[0]).toBeGreaterThan(blue[0] * 5);
    const half = px(0, 0, 0, 255);
    applyDuotone(half, { shadow: "#c80000", highlight: "#ffffff", amount: 50 });
    expect([...half]).toEqual([100, 0, 0, 255]);
    const off = px(10, 20, 30, 40);
    applyDuotone(off, { shadow: "#ff0000", highlight: "#00ff00", amount: 0 });
    expect([...off]).toEqual([10, 20, 30, 40]);
  });

  it("blends a flat colour by opacity and keeps alpha", () => {
    const data = px(0, 0, 0, 255, 200, 100, 50, 0);
    applyColorOverlay(data, { color: "#ff8000", opacity: 50 });
    expect([...data]).toEqual([128, 64, 0, 255, 228, 114, 25, 0]);
    const full = px(1, 2, 3, 9);
    applyColorOverlay(full, { color: "#0a0b0cff", opacity: 100 });
    expect([...full]).toEqual([10, 11, 12, 9]);
  });

  it("applies adjustments, then duotone, then overlay", () => {
    const data = px(255, 0, 0, 255);
    applyLook(data, 1, 1, {
      adjustments: { ...NEUTRAL_ADJUSTMENTS, grayscale: 100 },
      duotone: { shadow: "#000000", highlight: "#0000ff", amount: 100 },
      overlay: { color: "#ffffff", opacity: 50 },
    });
    // red -> grey 54 -> blue ramp (0,0,54) -> half white
    expect([...data]).toEqual([128, 128, 154, 255]);
    const same = px(9, 8, 7, 6);
    applyLook(same, 1, 1, { adjustments: NEUTRAL_ADJUSTMENTS });
    expect([...same]).toEqual([9, 8, 7, 6]);
  });

  it("knows when a look changes nothing", () => {
    expect(isNeutralLook({ adjustments: NEUTRAL_ADJUSTMENTS })).toBe(true);
    expect(isNeutralLook({ adjustments: NEUTRAL_ADJUSTMENTS, duotone: { shadow: "#000000", highlight: "#ffffff", amount: 0 }, overlay: { color: "#000000", opacity: 0 } })).toBe(true);
    expect(isNeutralLook({ adjustments: NEUTRAL_ADJUSTMENTS, overlay: { color: "#000000", opacity: 1 } })).toBe(false);
    expect(isNeutralLook({ adjustments: { ...NEUTRAL_ADJUSTMENTS, blur: 3 } })).toBe(false);
  });
});

describe("schema version 6", () => {
  const base = createProject({ name: "t", width: 1080, height: 1350, slideCount: 1, mode: "independent" }, new Date("2026-01-01"));
  const ref = { id: "a", name: "a.jpg", mime: "image/jpeg", width: 400, height: 300, size: 10 };
  const img = createImage(ref, { centerX: 540, centerY: 675, maxWidth: 800, maxHeight: 800 } as never);
  const withImage = ops.addElements(ops.addAssetRef(base, ref), base.slides[0].id, [img]);

  it("accepts images with and without the new fields", () => {
    expect(SCHEMA_VERSION).toBe(6);
    expect(projectSchema.safeParse(withImage).success).toBe(true);
    const styled = ops.updateElements(withImage, base.slides[0].id, [img.id], {
      crop: { x: 0.25, y: -1, zoom: 2.5, turns: 3 },
      duotone: { shadow: "#000000", highlight: "#ffffff", amount: 80 },
      overlay: { color: "#ff0000", opacity: 20 },
    } as never);
    expect(projectSchema.safeParse(styled).success).toBe(true);
    expect(JSON.parse(JSON.stringify(parseProject(JSON.parse(JSON.stringify(styled)))))).toEqual(JSON.parse(JSON.stringify(styled)));
  });

  it("rejects values outside the limits", () => {
    const bad = (patch: object) => projectSchema.safeParse(ops.updateElements(withImage, base.slides[0].id, [img.id], patch as never)).success;
    expect(bad({ crop: { x: 2, y: 0, zoom: 1, turns: 0 } })).toBe(false);
    expect(bad({ crop: { x: 0, y: 0, zoom: 0.5, turns: 0 } })).toBe(false);
    expect(bad({ crop: { x: 0, y: 0, zoom: 1, turns: 4 } })).toBe(false);
    expect(bad({ duotone: { shadow: "red", highlight: "#ffffff", amount: 50 } })).toBe(false);
    expect(bad({ overlay: { color: "#ffffff", opacity: 140 } })).toBe(false);
  });

  it("opens a version 5 document unchanged apart from the version", () => {
    const v5 = { ...JSON.parse(JSON.stringify(withImage)), schemaVersion: 5 };
    const opened = parseProject(v5);
    expect(opened.schemaVersion).toBe(6);
    expect(opened.slides[0].elements[0]).toEqual(JSON.parse(JSON.stringify(img)));
  });
});
