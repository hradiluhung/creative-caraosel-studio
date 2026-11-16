import { describe, expect, it } from "vitest";
import { sniffImageType } from "@/persistence/assets";
import { sniffVideoType } from "@/persistence/videoSniff";
import { createImage, createProject, createVideo } from "./factory";
import { getSurfaces } from "./geometry";
import { DocumentError, parseProject } from "./migrations";
import * as ops from "./operations";
import { isVideoAsset, projectSchema, SCHEMA_VERSION, type AssetRef, type Project } from "./schema";
import { clampTrim, clipDuration, clipEnded, formatSeconds, surfaceDuration, videoTimeAt } from "./timing";

const place = { centerX: 540, centerY: 675, maxWidth: 1080, maxHeight: 1350 };
const clip: AssetRef = { id: "v1", name: "beach.mp4", mime: "video/mp4", width: 1920, height: 1080, size: 5_000_000, duration: 8 };
const photo: AssetRef = { id: "p1", name: "pic.jpg", mime: "image/jpeg", width: 4000, height: 3000, size: 10 };

function withVideo(mode: "independent" | "seamless" = "independent") {
  const project = createProject({ name: "Reel", width: 1080, height: 1350, slideCount: 2, mode });
  const surfaceId = getSurfaces(project)[0].id;
  const video = createVideo(clip, place);
  return { project: ops.addElements(ops.addAssetRef(project, clip), surfaceId, [video]), surfaceId, video };
}
const issuesOf = (doc: unknown) => {
  try {
    parseProject(doc);
    return [];
  } catch (e) {
    return (e as DocumentError).issues;
  }
};

describe("schema version 3: video", () => {
  it("is the current version", () => {
    expect(SCHEMA_VERSION).toBe(3);
  });

  it("creates a valid video element that plays the whole clip", () => {
    const { project, video } = withVideo();
    expect(projectSchema.safeParse(project).success).toBe(true);
    expect(video).toMatchObject({ type: "video", assetId: "v1", trimStart: 0, trimEnd: 8, volume: 1, muted: false, playbackRate: 1, loop: false, posterTime: 0, mask: "rect" });
    // 16:9 clip fitted into 80% of a portrait slide, centered.
    expect(video.width).toBe(864);
    expect(video.height).toBe(486);
    expect(video.x + video.width / 2).toBe(540);
  });

  it("survives a JSON round trip, also in a seamless panorama and with a manual slide duration", () => {
    const { project } = withVideo("seamless");
    const timed: Project = { ...project, slides: project.slides.map((s, i) => (i === 0 ? { ...s, duration: 12.5 } : s)) };
    const back = parseProject(JSON.parse(JSON.stringify(timed)));
    expect(back).toEqual(timed);
    expect(back.slides[0].duration).toBe(12.5);
    expect(back.slides[1].duration).toBeUndefined();
    expect(back.assets[0].duration).toBe(8);
  });

  it("rejects invalid video values", () => {
    const { project, surfaceId, video } = withVideo();
    const broken = (patch: Record<string, unknown>) =>
      issuesOf(JSON.parse(JSON.stringify(ops.updateElements(project, surfaceId, [video.id], patch as never))));
    expect(broken({ trimStart: 5, trimEnd: 5 }).join()).toContain("trimEnd must be after trimStart");
    expect(broken({ trimStart: -1 })).not.toHaveLength(0);
    expect(broken({ volume: 1.5 })).not.toHaveLength(0);
    expect(broken({ playbackRate: 0 })).not.toHaveLength(0);
    expect(broken({ playbackRate: 9 })).not.toHaveLength(0);
    expect(broken({ posterTime: -0.1 })).not.toHaveLength(0);
    expect(broken({ mask: "blob" })).not.toHaveLength(0);
    expect(broken({ assetId: "" })).not.toHaveLength(0);
    expect(broken({ loop: "yes" })).not.toHaveLength(0);
    expect(broken({})).toHaveLength(0);
  });

  it("rejects an invalid slide or asset duration", () => {
    const { project } = withVideo();
    const raw = () => JSON.parse(JSON.stringify(project));
    const badSlide = raw();
    badSlide.slides[0].duration = 0;
    expect(issuesOf(badSlide)).not.toHaveLength(0);
    const tooLong = raw();
    tooLong.slides[0].duration = 100_000;
    expect(issuesOf(tooLong)).not.toHaveLength(0);
    const badAsset = raw();
    badAsset.assets[0].duration = -3;
    expect(issuesOf(badAsset)).not.toHaveLength(0);
  });

  it("counts videos as used assets and as export content", () => {
    const { project, surfaceId, video } = withVideo();
    const withPhoto = ops.addElements(ops.addAssetRef(project, photo), surfaceId, [createImage(photo, place)]);
    expect([...ops.usedAssetIds(withPhoto)].sort()).toEqual(["p1", "v1"]);
    expect(ops.countVideos(withPhoto)).toBe(1);
    expect(ops.countVideos(ops.updateElements(withPhoto, surfaceId, [video.id], { visible: false }))).toBe(0);
    expect(ops.usedAssetIds(ops.removeElements(withPhoto, surfaceId, [video.id]))).toEqual(new Set(["p1"]));
    expect(isVideoAsset(clip)).toBe(true);
    expect(isVideoAsset(photo)).toBe(false);
  });

  it("exposes the slide duration on its surface", () => {
    const { project } = withVideo();
    const timed = { ...project, slides: project.slides.map((s) => ({ ...s, duration: 4 })) };
    expect(getSurfaces(timed)[0].duration).toBe(4);
    expect(getSurfaces(project)[0].duration).toBeUndefined();
  });
});

describe("migration 2 -> 3", () => {
  // A real Phase 2 document shape, written by schema version 2.
  const v2 = () => ({
    schemaVersion: 2,
    id: "proj",
    name: "Old project",
    mode: "independent",
    width: 1080,
    height: 1350,
    slides: [
      {
        id: "s1",
        name: "Slide 1",
        background: { type: "linear", angle: 180, stops: [{ offset: 0, color: "#ff9a8b" }, { offset: 1, color: "#ff6a88" }] },
        elements: [
          {
            id: "e1", name: "Photo", type: "image", assetId: "p1", x: 10, y: 20, width: 300, height: 200, rotation: 0, opacity: 1,
            visible: true, locked: false, blendMode: "normal", shadow: null, flipX: false, flipY: false, cornerRadius: 0, mask: "ellipse",
            adjustments: { brightness: 0, exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0, fade: 0, grayscale: 100, sharpness: 0, blur: 0, vignette: 0, grain: 0 },
            filter: "Mono", borderColor: "#ffffff", borderWidth: 0,
          },
        ],
      },
    ],
    panorama: { background: { type: "solid", color: "#ffffff" }, elements: [] },
    assets: [{ id: "p1", name: "pic.jpg", mime: "image/jpeg", width: 4000, height: 3000, size: 10 }],
    brandKitId: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
  });

  it("opens a version 2 document unchanged apart from the version", () => {
    const source = v2();
    const upgraded = parseProject(source);
    expect(upgraded.schemaVersion).toBe(3);
    expect({ ...upgraded, schemaVersion: 2 }).toEqual(v2());
    expect(source.schemaVersion).toBe(2); // the stored object itself is not mutated
    expect(upgraded.slides[0].duration).toBeUndefined();
    expect(upgraded.assets[0].duration).toBeUndefined();
  });

  it("still upgrades version 0 and version 1 documents all the way", () => {
    const v0 = { id: "x", name: "Ancient", width: 1080, height: 1080, slides: [{ id: "s", name: "Slide 1", background: { type: "solid", color: "#ffffff" }, elements: [] }], createdAt: "a", updatedAt: "b" };
    expect(parseProject(v0).schemaVersion).toBe(3);
    expect(parseProject({ ...v0, schemaVersion: 1, mode: "independent", panorama: { background: { type: "transparent" }, elements: [] }, assets: [] }).schemaVersion).toBe(3);
  });

  it("refuses documents from a newer app", () => {
    expect(() => parseProject({ ...v2(), schemaVersion: 4 })).toThrow(/newer version/);
  });
});

describe("video timing", () => {
  const base = { trimStart: 2, trimEnd: 6, playbackRate: 1, loop: false };

  it("maps slide time to source time inside the trimmed range", () => {
    expect(clipDuration(base)).toBe(4);
    expect(videoTimeAt(base, 0)).toBe(2);
    expect(videoTimeAt(base, 1.5)).toBe(3.5);
    expect(videoTimeAt(base, -3)).toBe(2);
  });

  it("holds the last frame after the end, or wraps when looping", () => {
    expect(videoTimeAt(base, 4)).toBe(6);
    expect(videoTimeAt(base, 99)).toBe(6);
    expect(clipEnded(base, 3.99)).toBe(false);
    expect(clipEnded(base, 4)).toBe(true);
    const loop = { ...base, loop: true };
    expect(videoTimeAt(loop, 4)).toBe(2);
    expect(videoTimeAt(loop, 9)).toBe(3);
    expect(clipEnded(loop, 99)).toBe(false);
  });

  it("applies the playback rate", () => {
    const fast = { ...base, playbackRate: 2 };
    expect(clipDuration(fast)).toBe(2);
    expect(videoTimeAt(fast, 1)).toBe(4);
    expect(videoTimeAt(fast, 2)).toBe(6);
    const slow = { ...base, playbackRate: 0.5 };
    expect(clipDuration(slow)).toBe(8);
    expect(videoTimeAt(slow, 2)).toBe(3);
  });

  it("derives the slide duration from the longest visible clip unless it is set manually", () => {
    const a = createVideo(clip, place);
    const b = { ...createVideo({ ...clip, id: "v2", duration: 20 }, place), trimStart: 5, trimEnd: 15, playbackRate: 2 };
    const still = createImage(photo, place);
    expect(surfaceDuration([still])).toBe(0);
    expect(surfaceDuration([a, still])).toBe(8);
    expect(surfaceDuration([a, b])).toBe(8);
    expect(surfaceDuration([a, { ...b, playbackRate: 1 }])).toBe(10);
    expect(surfaceDuration([{ ...a, visible: false }])).toBe(0);
    expect(surfaceDuration([a], 3)).toBe(3);
  });

  it("clamps trim values to the source and keeps them apart", () => {
    expect(clampTrim(1, 5, 8)).toEqual({ trimStart: 1, trimEnd: 5 });
    expect(clampTrim(-2, 50, 8)).toEqual({ trimStart: 0, trimEnd: 8 });
    const collapsed = clampTrim(4, 4, 8);
    expect(collapsed.trimEnd).toBeGreaterThan(collapsed.trimStart);
    const atEnd = clampTrim(8, 8, 8);
    expect(atEnd.trimEnd).toBe(8);
    expect(atEnd.trimStart).toBeLessThan(8);
  });

  it("formats clock labels", () => {
    expect(formatSeconds(0)).toBe("0:00.0");
    expect(formatSeconds(2.04)).toBe("0:02.0");
    expect(formatSeconds(75.56)).toBe("1:15.5");
  });
});

describe("video signature sniffing", () => {
  const bytes = (...parts: Array<string | number[]>) =>
    new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
  const ebml = [0x1a, 0x45, 0xdf, 0xa3];

  it("recognises MP4, MOV and WebM by content", () => {
    expect(sniffVideoType(bytes([0, 0, 0, 0x20], "ftypisom", [0, 0, 2, 0], "isomiso2avc1mp41"))).toBe("video/mp4");
    expect(sniffVideoType(bytes([0, 0, 0, 0x1c], "ftypmp42"))).toBe("video/mp4");
    expect(sniffVideoType(bytes([0, 0, 0, 0x14], "ftypqt  ", [0, 0, 2, 0], "qt  "))).toBe("video/quicktime");
    expect(sniffVideoType(bytes([0, 0, 0, 8], "wide", [0, 0, 0, 0], "mdat"))).toBe("video/quicktime");
    expect(sniffVideoType(bytes(ebml, [0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84], "webm", [0x42, 0x87, 0x81, 0x02]))).toBe("video/webm");
  });

  it("rejects look-alikes and other files", () => {
    // Matroska shares the EBML header with WebM but is not accepted.
    expect(sniffVideoType(bytes(ebml, [0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x88], "matroska"))).toBeNull();
    expect(sniffVideoType(bytes("definitely not a video file, just text"))).toBeNull();
    expect(sniffVideoType(bytes([0xff, 0xd8, 0xff, 0xe0], "JFIF and more bytes"))).toBeNull();
    expect(sniffVideoType(bytes("RIFF", [0, 0, 0, 0], "AVI LIST"))).toBeNull();
    expect(sniffVideoType(new Uint8Array(0))).toBeNull();
    expect(sniffVideoType(bytes([0, 0, 0, 0x20], "fty"))).toBeNull();
  });

  it("never mistakes a video for an image or the other way round", () => {
    const mp4 = bytes([0, 0, 0, 0x20], "ftypisom", [0, 0, 2, 0]);
    const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "more bytes here!");
    expect(sniffImageType(mp4)).toBeNull();
    expect(sniffVideoType(png)).toBeNull();
  });
});
