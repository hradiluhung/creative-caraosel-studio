import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createImage, createProject, createShape, createText } from "@/document/factory";
import { linearGradientPoints } from "@/document/geometry";
import { parseProject } from "@/document/migrations";
import * as ops from "@/document/operations";
import { NEUTRAL_ADJUSTMENTS, projectSchema, SCHEMA_VERSION, type Adjustments } from "@/document/schema";
import { guessFontMeta, sniffFontFormat } from "@/persistence/customFonts";
import { instantiateTemplate, listBuiltInTemplates } from "@/templates";
import { applyAdjustments, boxBlur, FILTER_PRESETS } from "./adjust";
import { BUILT_IN_FONTS, getFont, resolveItalic, resolveWeight, setCustomFontDefs } from "./fonts";
import { displayText } from "./scene-text";
import { getSticker, STICKERS } from "./stickers";

const px = (...rgba: number[]) => new Uint8ClampedArray(rgba);
const adj = (p: Partial<Adjustments>): Adjustments => ({ ...NEUTRAL_ADJUSTMENTS, ...p });
const place = { centerX: 540, centerY: 675, maxWidth: 1080, maxHeight: 1350 };

describe("image adjustments", () => {
  it("neutral adjustments leave pixels untouched", () => {
    const data = px(10, 120, 250, 255, 0, 0, 0, 128);
    const before = Array.from(data);
    applyAdjustments(data, 2, 1, NEUTRAL_ADJUSTMENTS);
    expect(Array.from(data)).toEqual(before);
  });

  it("brightness and exposure move values in the right direction and clamp", () => {
    const up = px(100, 100, 100, 255);
    applyAdjustments(up, 1, 1, adj({ brightness: 50 }));
    expect(up[0]).toBeGreaterThan(100);
    const down = px(100, 100, 100, 255);
    applyAdjustments(down, 1, 1, adj({ exposure: -100 }));
    expect(down[0]).toBe(50);
    const clamp = px(250, 250, 250, 255);
    applyAdjustments(clamp, 1, 1, adj({ brightness: 100, exposure: 100 }));
    expect(clamp[0]).toBe(255);
  });

  it("contrast pushes values away from mid gray", () => {
    const data = px(60, 60, 60, 255, 200, 200, 200, 255);
    applyAdjustments(data, 2, 1, adj({ contrast: 50 }));
    expect(data[0]).toBeLessThan(60);
    expect(data[4]).toBeGreaterThan(200);
  });

  it("grayscale 100 equalises channels, saturation -100 too, alpha is kept", () => {
    const g = px(200, 40, 90, 77);
    applyAdjustments(g, 1, 1, adj({ grayscale: 100 }));
    expect(g[0]).toBe(g[1]);
    expect(g[1]).toBe(g[2]);
    expect(g[3]).toBe(77);
    const s = px(200, 40, 90, 255);
    applyAdjustments(s, 1, 1, adj({ saturation: -100 }));
    expect(Math.abs(s[0] - s[2])).toBeLessThanOrEqual(1);
  });

  it("temperature warms (more red, less blue) and cools", () => {
    const warm = px(120, 120, 120, 255);
    applyAdjustments(warm, 1, 1, adj({ temperature: 60 }));
    expect(warm[0]).toBeGreaterThan(120);
    expect(warm[2]).toBeLessThan(120);
    const cool = px(120, 120, 120, 255);
    applyAdjustments(cool, 1, 1, adj({ temperature: -60 }));
    expect(cool[2]).toBeGreaterThan(cool[0]);
  });

  it("vignette darkens corners but not the center", () => {
    const w = 21;
    const data = new Uint8ClampedArray(w * w * 4).fill(200);
    applyAdjustments(data, w, w, adj({ vignette: 100 }));
    const at = (x: number, y: number) => data[(y * w + x) * 4];
    expect(at(10, 10)).toBe(200);
    expect(at(0, 0)).toBeLessThan(80);
  });

  it("grain is deterministic, so preview and export match", () => {
    const a = new Uint8ClampedArray(16 * 16 * 4).fill(128);
    const b = a.slice();
    applyAdjustments(a, 16, 16, adj({ grain: 80 }));
    applyAdjustments(b, 16, 16, adj({ grain: 80 }));
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(new Set(a).size).toBeGreaterThan(5);
  });

  it("blur spreads a single bright pixel and keeps total brightness roughly constant", () => {
    const w = 15;
    const data = new Uint8ClampedArray(w * w * 4);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const c = (7 * w + 7) * 4;
    data[c] = data[c + 1] = data[c + 2] = 255;
    const out = boxBlur(data, w, w, 2);
    expect(out[c]).toBeLessThan(60);
    expect(out[c + 4]).toBeGreaterThan(0);
    expect(out[3]).toBe(255);
    let sum = 0;
    for (let i = 0; i < out.length; i += 4) sum += out[i];
    expect(sum).toBeGreaterThan(150);
    expect(sum).toBeLessThan(360);
  });

  it("every filter preset uses valid adjustment keys and ranges", () => {
    for (const preset of FILTER_PRESETS) {
      for (const [k, v] of Object.entries(preset.adjustments)) {
        expect(k in NEUTRAL_ADJUSTMENTS).toBe(true);
        expect(Math.abs(v as number)).toBeLessThanOrEqual(100);
      }
    }
    expect(FILTER_PRESETS).toHaveLength(10);
  });
});

describe("schema v2", () => {
  it("migrates a version 1 project and fills neutral defaults", () => {
    const now = createProject({ name: "Old", width: 1080, height: 1350, slideCount: 1, mode: "independent" });
    const strip = (el: Record<string, unknown>) => {
      const { blendMode, shadow, mask, adjustments, filter, borderColor, borderWidth, transform, strokeColor, strokeWidth, background, ...rest } = el;
      void [blendMode, shadow, mask, adjustments, filter, borderColor, borderWidth, transform, background];
      // v1 shapes had their own strokeWidth, which must survive.
      return el.type === "shape" ? { ...rest, strokeWidth } : (void strokeColor, rest);
    };
    const asset = { id: "a", name: "a.png", mime: "image/png", width: 10, height: 10, size: 1 };
    const els = [createText("heading", place), createImage(asset, place), createShape("rect", place)].map((e) => strip(e as never));
    const { brandKitId, ...rest } = now;
    void brandKitId;
    const v1 = { ...rest, schemaVersion: 1, slides: [{ ...now.slides[0], elements: els }] };
    const migrated = parseProject(JSON.parse(JSON.stringify(v1)));
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.brandKitId).toBeNull();
    const [t, i, s] = migrated.slides[0].elements;
    expect(t).toMatchObject({ type: "text", blendMode: "normal", shadow: null, transform: "none", strokeWidth: 0, background: null });
    expect(i).toMatchObject({ type: "image", mask: "rect", filter: null, adjustments: NEUTRAL_ADJUSTMENTS });
    expect(s).toMatchObject({ type: "shape", blendMode: "normal", strokeWidth: 0 });
  });

  it("accepts gradients and rejects malformed ones", () => {
    let p = createProject({ name: "G", width: 1080, height: 1080, slideCount: 1, mode: "independent" });
    p = ops.setBackground(p, p.slides[0].id, { type: "linear", angle: 135, stops: [{ offset: 0, color: "#ff0000" }, { offset: 1, color: "#0000ff" }] });
    expect(projectSchema.safeParse(p).success).toBe(true);
    const bad = ops.setBackground(p, p.slides[0].id, { type: "radial", stops: [{ offset: 0, color: "#ff0000" }] });
    expect(projectSchema.safeParse(bad).success).toBe(false);
  });

  it("linear gradient points follow the CSS angle convention", () => {
    const down = linearGradientPoints(180, 100, 200);
    expect(down.start.y).toBeCloseTo(0);
    expect(down.end.y).toBeCloseTo(200);
    expect(down.start.x).toBeCloseTo(50);
    const right = linearGradientPoints(90, 100, 200);
    expect(right.start.x).toBeCloseTo(0);
    expect(right.end.x).toBeCloseTo(100);
    const diag = linearGradientPoints(45, 100, 100);
    expect(diag.end.x).toBeGreaterThan(99);
    expect(diag.end.y).toBeLessThan(1);
  });

  it("counts empty photo placeholders and ignores them as assets", () => {
    const t = listBuiltInTemplates().find((x) => x.id === "quiet-minimal")!;
    expect(ops.countPlaceholders(t.doc)).toBe(3);
    expect(ops.usedAssetIds(t.doc).size).toBe(0);
  });
});

describe("templates", () => {
  const templates = listBuiltInTemplates();

  it("every built-in template is a valid, editable document", () => {
    expect(templates.length).toBeGreaterThanOrEqual(10);
    expect(new Set(templates.map((t) => t.id)).size).toBe(templates.length);
    for (const t of templates) {
      const result = projectSchema.safeParse(t.doc);
      expect(result.success, `${t.id}: ${result.success ? "" : JSON.stringify(result.error.issues.slice(0, 2))}`).toBe(true);
      const els = t.doc.mode === "seamless" ? t.doc.panorama.elements : t.doc.slides.flatMap((s) => s.elements);
      expect(els.some((e) => e.type === "text")).toBe(true);
      for (const e of els) {
        if (e.type === "text") expect(getFont(e.fontFamily), `${t.id} uses unknown font ${e.fontFamily}`).toBeDefined();
        if (e.type === "sticker") expect(getSticker(e.stickerId), `${t.id} uses unknown sticker ${e.stickerId}`).toBeDefined();
      }
    }
  });

  it("using a template gives a new project with fresh ids and the same content", () => {
    const t = templates[0];
    const a = instantiateTemplate(t, "Mine");
    const b = instantiateTemplate(t, "Other");
    expect(a.name).toBe("Mine");
    expect(a.id).not.toBe(b.id);
    expect(a.slides[0].id).not.toBe(t.doc.slides[0].id);
    expect(a.slides[0].elements[0].id).not.toBe(b.slides[0].elements[0].id);
    expect(a.slides.map((s) => s.elements.length)).toEqual(t.doc.slides.map((s) => s.elements.length));
    expect(projectSchema.safeParse(a).success).toBe(true);
  });

  it("seamless templates really cross slide boundaries", () => {
    const pano = templates.find((t) => t.id === "travel-panorama")!;
    expect(pano.doc.mode).toBe("seamless");
    expect(pano.doc.panorama.elements.some((e) => e.x < pano.doc.width && e.x + e.width > pano.doc.width)).toBe(true);
  });
});

describe("fonts", () => {
  it("recognises font containers by signature", () => {
    const tag = (s: string) => new TextEncoder().encode(s);
    expect(sniffFontFormat(new Uint8Array([0, 1, 0, 0, 0]))).toBe("ttf");
    expect(sniffFontFormat(tag("OTTO"))).toBe("otf");
    expect(sniffFontFormat(tag("wOFF"))).toBe("woff");
    expect(sniffFontFormat(tag("wOF2"))).toBe("woff2");
    expect(sniffFontFormat(tag("ttcf"))).toBe("collection");
    expect(sniffFontFormat(tag("<svg"))).toBeNull();
    expect(sniffFontFormat(tag("PK"))).toBeNull();
  });

  it("guesses family, weight and style from file names", () => {
    expect(guessFontMeta("AcmeSans-BoldItalic.ttf")).toEqual({ family: "Acme Sans", weight: 700, italic: true });
    expect(guessFontMeta("Neue_Grotesk-SemiBold.otf")).toEqual({ family: "Neue Grotesk", weight: 600, italic: false });
    expect(guessFontMeta("mono-ExtraLight.woff2")).toEqual({ family: "mono", weight: 200, italic: false });
    expect(guessFontMeta("Brush Script.ttf")).toEqual({ family: "Brush Script", weight: 400, italic: false });
    expect(guessFontMeta("-Regular.ttf").family).toBe("Custom font");
  });

  it("custom fonts join the catalog and resolve weights without faking them", () => {
    expect(BUILT_IN_FONTS.length).toBeGreaterThanOrEqual(28);
    setCustomFontDefs([{ family: "Acme Sans", label: "Acme", category: "Custom", weights: [300, 700], italics: false, custom: true }]);
    expect(getFont("Acme Sans")?.label).toBe("Acme");
    expect(resolveWeight("Acme Sans", 400)).toBe(300);
    expect(resolveWeight("Acme Sans", 600)).toBe(700);
    expect(resolveItalic("Acme Sans", true)).toBe(false);
    expect(resolveWeight("Bebas Neue", 700)).toBe(400);
    setCustomFontDefs([]);
    expect(getFont("Acme Sans")).toBeUndefined();
  });

  it("applies letter case at render time without changing the stored text", () => {
    expect(displayText({ text: "hello wORLD", transform: "uppercase" })).toBe("HELLO WORLD");
    expect(displayText({ text: "hello wORLD", transform: "lowercase" })).toBe("hello world");
    expect(displayText({ text: "hello big world\nnew line", transform: "capitalize" })).toBe("Hello Big World\nNew Line");
    expect(displayText({ text: "Keep Me", transform: "none" })).toBe("Keep Me");
  });
});

describe("stickers", () => {
  it("have unique ids, positive boxes and path data", () => {
    expect(new Set(STICKERS.map((s) => s.id)).size).toBe(STICKERS.length);
    for (const s of STICKERS) {
      expect(s.width > 0 && s.height > 0).toBe(true);
      expect(s.data.startsWith("M")).toBe(true);
    }
  });
});
