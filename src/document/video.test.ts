import { describe, expect, it } from "vitest";
import { sniffImageType } from "@/persistence/assets";
import { computePeaks } from "@/persistence/audio";
import { sniffAudioType, sniffVideoType } from "@/persistence/videoSniff";
import { createImage, createProject, createVideo } from "./factory";
import { slideFileNameWithExt } from "@/export/naming";
import { videoBitrate, videoOutputSize } from "@/export/videoSupport";
import { getExportFrames, getSurfaces } from "./geometry";
import { DocumentError, parseProject } from "./migrations";
import * as ops from "./operations";
import { isAudioAsset, isVideoAsset, projectSchema, SCHEMA_VERSION, type AssetRef, type Project } from "./schema";
import { audioTimeAt, clampTrim, clipActive, clipReach, MAX_VIDEO_SLIDE_SECONDS, playbackScope, createAudioTrack, trackActive, trackEnd, trackGainAt, trackGainPoints, clipDuration, clipEnd, clipEnded, formatSeconds, frameClips, frameDuration, MIN_CLIP_SECONDS, moveClip, splitClip, surfaceDuration, trimClipEnd, trimClipStart, videoTimeAt } from "./timing";

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

describe("schema: video", () => {
  it("has a current version", () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(4);
  });

  it("creates a valid video element that plays the whole clip", () => {
    const { project, video } = withVideo();
    expect(projectSchema.safeParse(project).success).toBe(true);
    expect(video).toMatchObject({ type: "video", assetId: "v1", start: 0, trimStart: 0, trimEnd: 8, volume: 1, muted: false, playbackRate: 1, loop: false, posterTime: 0, mask: "rect" });
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
    expect(broken({ start: -1 })).not.toHaveLength(0);
    expect(broken({ start: undefined })).not.toHaveLength(0);
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
    expect(upgraded.schemaVersion).toBe(SCHEMA_VERSION);
    expect({ ...upgraded, schemaVersion: 2 }).toEqual(v2());
    expect(source.schemaVersion).toBe(2); // the stored object itself is not mutated
    expect(upgraded.slides[0].duration).toBeUndefined();
    expect(upgraded.assets[0].duration).toBeUndefined();
  });

  it("still upgrades version 0 and version 1 documents all the way", () => {
    const v0 = { id: "x", name: "Ancient", width: 1080, height: 1080, slides: [{ id: "s", name: "Slide 1", background: { type: "solid", color: "#ffffff" }, elements: [] }], createdAt: "a", updatedAt: "b" };
    expect(parseProject(v0).schemaVersion).toBe(SCHEMA_VERSION);
    expect(parseProject({ ...v0, schemaVersion: 1, mode: "independent", panorama: { background: { type: "transparent" }, elements: [] }, assets: [] }).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("refuses documents from a newer app", () => {
    expect(() => parseProject({ ...v2(), schemaVersion: SCHEMA_VERSION + 1 })).toThrow(/newer version/);
  });
});

describe("migration 3 -> 4", () => {
  it("gives every video clip a start time of 0, on slides and in the panorama", () => {
    const { project, video } = withVideo();
    const { project: pano } = withVideo("seamless");
    for (const current of [project, pano]) {
      const v3 = JSON.parse(JSON.stringify(current));
      v3.schemaVersion = 3;
      for (const c of [...v3.slides, v3.panorama]) for (const el of c.elements) delete el.start;
      expect(JSON.stringify(v3)).not.toContain('"start"');
      expect(parseProject(v3)).toEqual(current);
    }
    expect(video.start).toBe(0);
  });

  it("is refused by the schema without the migration (the field is required)", () => {
    const { project } = withVideo();
    const raw = JSON.parse(JSON.stringify(project));
    delete raw.slides[0].elements[0].start;
    expect(projectSchema.safeParse(raw).success).toBe(false);
  });
});

describe("timeline operations", () => {
  it("splits a video element in place, as one new layer directly above", () => {
    const { project, surfaceId, video } = withVideo();
    const withPhoto = ops.addElements(ops.addAssetRef(project, photo), surfaceId, [createImage(photo, place)]);
    const { project: next, newId } = ops.splitVideo(withPhoto, surfaceId, video.id, 3, "second");
    const els = ops.getElements(next, surfaceId);
    expect(newId).toBe("second");
    expect(els.map((e) => e.type)).toEqual(["video", "video", "image"]);
    expect(els[0]).toMatchObject({ id: video.id, start: 0, trimStart: 0, trimEnd: 3 });
    expect(els[1]).toMatchObject({ id: "second", start: 3, trimStart: 3, trimEnd: 8, x: video.x, width: video.width, assetId: "v1" });
    expect(surfaceDuration(els)).toBe(8);
    expect(projectSchema.safeParse(next).success).toBe(true);
    expect(ops.getElements(withPhoto, surfaceId)).toHaveLength(2); // the input is untouched
  });

  it("does nothing when the time is outside the clip or the layer is not a video", () => {
    const { project, surfaceId, video } = withVideo();
    expect(ops.splitVideo(project, surfaceId, video.id, 0)).toEqual({ project, newId: null });
    expect(ops.splitVideo(project, surfaceId, video.id, 8).project).toBe(project);
    expect(ops.splitVideo(project, surfaceId, "nope", 3).project).toBe(project);
  });

  it("sets and clears a manual slide duration", () => {
    const { project, surfaceId } = withVideo();
    const timed = ops.setSlideDuration(project, surfaceId, 12);
    expect(timed.slides[0].duration).toBe(12);
    expect(timed.slides[1]).toBe(project.slides[1]);
    expect(getSurfaces(timed)[0].duration).toBe(12);
    expect(ops.setSlideDuration(timed, surfaceId, 12)).toBe(timed);
    const auto = ops.setSlideDuration(timed, surfaceId, undefined);
    expect("duration" in auto.slides[0]).toBe(false);
    expect(ops.setSlideDuration(project, surfaceId, 99_999).slides[0].duration).toBe(60);
    expect(projectSchema.safeParse(ops.setSlideDuration(project, surfaceId, 0)).success).toBe(true);
  });
});

describe("the 60 second limit of a video slide", () => {
  const long: AssetRef = { ...clip, id: "v9", duration: 300 }; // a five minute source

  it("starts a long video as its first 60 seconds", () => {
    const el = createVideo(long, place);
    expect(el.trimEnd).toBe(60);
    expect(clipDuration(el)).toBe(MAX_VIDEO_SLIDE_SECONDS);
    expect(createVideo(clip, place).trimEnd).toBe(8);
  });

  it("never lets a trim or a move push a clip past 60 seconds", () => {
    const el = createVideo(long, place);
    expect(trimClipEnd(el, 200, 300)).toEqual({ trimEnd: 60 });
    expect(trimClipEnd({ ...el, start: 20, trimEnd: 30 }, 200, 300)).toEqual({ trimEnd: 40 }); // 20 + 40 = 60
    expect(trimClipEnd({ ...el, playbackRate: 2 }, 200, 300)).toEqual({ trimEnd: 120 }); // 120 s of source in 60 s
    expect(moveClip({ ...el, trimEnd: 10 }, 999)).toEqual({ start: 50 });
    expect(moveClip(el, 5)).toEqual({ start: 0 });
  });

  it("cuts off whatever still runs over", () => {
    const slow = { ...createVideo(long, place), playbackRate: 0.5 }; // 120 s on the slide
    expect(surfaceDuration([slow])).toBe(60);
    expect(surfaceDuration([slow], 90)).toBe(60);
    expect(surfaceDuration([slow], 12)).toBe(12);
  });

  it("knows how far a trimmed clip can be stretched back out", () => {
    const el = { start: 4, trimStart: 2, trimEnd: 5, playbackRate: 1, loop: false }; // on the slide 4..7, source is 8 s
    expect(clipReach(el, 8)).toEqual({ from: 2, to: 10 });
    expect(clipReach({ ...el, playbackRate: 2 }, 8)).toEqual({ from: 3, to: 7 });
    expect(clipReach({ ...el, start: 1 }, 8)).toEqual({ from: 0, to: 7 });
    expect(clipReach(el, 300).to).toBe(60);
  });
});

describe("video timing", () => {
  const base = { start: 0, trimStart: 2, trimEnd: 6, playbackRate: 1, loop: false };

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

  it("starts a clip later on the slide and shows it only while it plays", () => {
    const late = { ...base, start: 3 };
    expect(clipEnd(late)).toBe(7);
    expect(videoTimeAt(late, 1)).toBe(2); // not started yet: first frame
    expect(videoTimeAt(late, 4)).toBe(3);
    expect(clipActive(late, 2.99)).toBe(false);
    expect(clipActive(late, 3)).toBe(true);
    expect(clipActive(late, 6.99)).toBe(true);
    expect(clipActive(late, 7)).toBe(false);
    expect(clipEnded(late, 7)).toBe(true);
    expect(clipActive({ ...late, loop: true }, 100)).toBe(true);
    expect(videoTimeAt({ ...late, loop: true }, 8)).toBe(3);
    const a = createVideo(clip, place);
    expect(surfaceDuration([{ ...a, start: 2.5 }])).toBe(10.5);
  });

  it("trims from the left edge without moving the right edge", () => {
    const el = { ...base, start: 1 }; // on the slide from 1 to 5
    expect(trimClipStart(el, 2)).toEqual({ start: 2, trimStart: 3 });
    expect(clipEnd({ ...el, ...trimClipStart(el, 2) })).toBe(5);
    // Cannot reveal more than the source has (2 s before trimStart), nor pass slide time 0.
    expect(trimClipStart(el, -10)).toEqual({ start: 0, trimStart: 1 });
    expect(trimClipStart({ ...el, start: 5 }, 0)).toEqual({ start: 3, trimStart: 0 });
    const squeezed = trimClipStart(el, 99);
    expect(squeezed.start).toBeCloseTo(5 - MIN_CLIP_SECONDS);
    // Speed is respected: at 2x one slide second is two source seconds.
    expect(trimClipStart({ ...el, playbackRate: 2 }, 1.5)).toEqual({ start: 1.5, trimStart: 3 });
  });

  it("trims from the right edge inside the source", () => {
    const el = { ...base, start: 1 };
    expect(trimClipEnd(el, 4, 8)).toEqual({ trimEnd: 5 });
    expect(trimClipEnd(el, 99, 8)).toEqual({ trimEnd: 8 });
    expect(trimClipEnd(el, 0, 8).trimEnd).toBeCloseTo(2 + MIN_CLIP_SECONDS);
    expect(moveClip(el, -3, 20)).toEqual({ start: 0 });
    expect(moveClip(el, 30, 20)).toEqual({ start: 20 });
  });

  it("splits a clip into two that follow each other", () => {
    const el = { ...base, start: 1, loop: true };
    const cut = splitClip(el, 2.5)!;
    expect(cut).toEqual({ first: { trimEnd: 3.5, loop: false }, second: { start: 2.5, trimStart: 3.5 } });
    const first = { ...el, ...cut.first };
    const second = { ...el, ...cut.second };
    expect(clipEnd(first)).toBe(second.start);
    expect(videoTimeAt(first, 2.4)).toBeCloseTo(videoTimeAt(el, 2.4));
    expect(videoTimeAt(second, 2.5)).toBe(3.5);
    expect(clipEnd({ ...second, loop: false })).toBe(5);
    expect(splitClip(el, 1)).toBeNull();
    expect(splitClip(el, 5)).toBeNull();
    expect(splitClip(el, 0.5)).toBeNull();
    expect(splitClip({ ...el, playbackRate: 2 }, 2)).toEqual({ first: { trimEnd: 4, loop: false }, second: { start: 2, trimStart: 4 } });
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

describe("video export planning", () => {
  it("knows which export frames contain video and how long they play", () => {
    const { project, video, surfaceId } = withVideo();
    const frames = getExportFrames(project);
    expect(frameClips(project, frames[0]).map((c) => c.id)).toEqual([video.id]);
    expect(frameDuration(project, frames[0])).toBe(8);
    expect(frameClips(project, frames[1])).toEqual([]);
    expect(frameDuration(project, frames[1])).toBe(0);
    expect(frameDuration(ops.updateElements(project, surfaceId, [video.id], { visible: false }), frames[0])).toBe(0);
    expect(frameDuration(ops.setSlideDuration(project, surfaceId, 3), frames[0])).toBe(3);
  });

  it("in a panorama only the slides a clip reaches into are video slides", () => {
    const { project, video } = withVideo("seamless"); // 864 px wide, centered on slide 1
    const frames = getExportFrames(project);
    expect(frames.map((f) => frameDuration(project, f))).toEqual([8, 0]);
    const across = ops.updateElements(project, frames[0].surfaceId, [video.id], { x: 700 }); // 700..1564 crosses into slide 2
    expect(getExportFrames(across).map((f) => frameDuration(across, f))).toEqual([8, 8]);
    const onSecond = ops.updateElements(project, frames[0].surfaceId, [video.id], { x: 1100 });
    expect(getExportFrames(onSecond).map((f) => frameDuration(onSecond, f))).toEqual([0, 8]);
  });

  it("sizes the output with even sides and never upscales", () => {
    expect(videoOutputSize(1080, 1350, 1080)).toEqual({ width: 1080, height: 1350, scale: 1 });
    expect(videoOutputSize(1080, 1350, 720)).toMatchObject({ width: 720, height: 900 });
    expect(videoOutputSize(1080, 1920, 720)).toMatchObject({ width: 720, height: 1280 });
    expect(videoOutputSize(1080, 1080, 1080)).toMatchObject({ width: 1080, height: 1080 });
    expect(videoOutputSize(600, 750, 1080)).toEqual({ width: 600, height: 750, scale: 1 });
    const odd = videoOutputSize(1081, 1351, 720);
    expect(odd.width % 2).toBe(0);
    expect(odd.height % 2).toBe(0);
  });

  it("scales the bitrate with size and quality", () => {
    const full = videoOutputSize(1080, 1350, 1080);
    const small = videoOutputSize(1080, 1350, 720);
    expect(videoBitrate(full, "standard")).toBeGreaterThan(4_000_000);
    expect(videoBitrate(full, "standard")).toBeLessThan(6_000_000);
    expect(videoBitrate(full, "high")).toBeGreaterThan(videoBitrate(full, "standard"));
    expect(videoBitrate(full, "small")).toBeLessThan(videoBitrate(full, "standard"));
    expect(videoBitrate(small, "standard")).toBeLessThan(videoBitrate(full, "standard"));
  });

  it("names mixed exports so they sort in slide order", () => {
    expect([0, 1, 2].map((i) => slideFileNameWithExt("My Trip!", i, 3, i === 1 ? "mp4" : "jpg"))).toEqual(["my-trip-01.jpg", "my-trip-02.mp4", "my-trip-03.jpg"]);
    expect(slideFileNameWithExt("x", 99, 120, "mp4")).toBe("x-100.mp4");
  });
});

describe("background music", () => {
  const song: AssetRef = { id: "a1", name: "song.mp3", mime: "audio/mpeg", width: 0, height: 0, size: 100, duration: 30 };
  const track = { ...createAudioTrack(song), volume: 0.8 };

  it("is part of schema version 5 and survives a round trip", () => {
    expect(SCHEMA_VERSION).toBe(7);
    const { project, surfaceId } = withVideo();
    const withMusic = ops.setSlideAudio(ops.addAssetRef(project, song), surfaceId, { ...track, fadeIn: 1, fadeOut: 2, loop: true });
    expect(parseProject(JSON.parse(JSON.stringify(withMusic)))).toEqual(withMusic);
    expect(getSurfaces(withMusic)[0].audio?.assetId).toBe("a1");
    expect(isAudioAsset(song)).toBe(true);
    expect(isVideoAsset(song)).toBe(false);
    expect([...ops.usedAssetIds(withMusic)].sort()).toEqual(["a1", "v1"]);
    const removed = ops.setSlideAudio(withMusic, surfaceId, undefined);
    expect("audio" in removed.slides[0]).toBe(false);
    expect(ops.usedAssetIds(removed)).toEqual(new Set(["v1"]));
    expect(ops.setSlideAudio(removed, surfaceId, undefined)).toBe(removed);
  });

  it("rejects invalid tracks", () => {
    const { project, surfaceId } = withVideo();
    const bad = (patch: Record<string, unknown>) => issuesOf(JSON.parse(JSON.stringify(ops.setSlideAudio(project, surfaceId, { ...track, ...patch } as never))));
    expect(bad({})).toHaveLength(0);
    expect(bad({ volume: 2 })).not.toHaveLength(0);
    expect(bad({ fadeIn: -1 })).not.toHaveLength(0);
    expect(bad({ fadeOut: 99 })).not.toHaveLength(0);
    expect(bad({ trimStart: 5, trimEnd: 5 })).not.toHaveLength(0);
    expect(bad({ assetId: "" })).not.toHaveLength(0);
  });

  it("migrates version 4 documents without touching them", () => {
    const { project } = withVideo();
    const v4 = { ...JSON.parse(JSON.stringify(project)), schemaVersion: 4 };
    expect(parseProject(v4)).toEqual(project);
  });

  it("plays from its start until its trimmed part or the slide ends", () => {
    const t = { ...track, start: 2, trimStart: 10, trimEnd: 14 }; // 4 s of music, from slide time 2
    expect(trackEnd(t, 20)).toBe(6);
    expect(trackEnd(t, 5)).toBe(5);
    expect(trackEnd({ ...t, loop: true }, 20)).toBe(20);
    expect(trackActive(t, 1.9, 20)).toBe(false);
    expect(trackActive(t, 2, 20)).toBe(true);
    expect(trackActive(t, 6, 20)).toBe(false);
    expect(audioTimeAt(t, 3)).toBe(11);
    expect(audioTimeAt({ ...t, loop: true }, 7)).toBe(11);
  });

  it("fades in and out along one curve", () => {
    const t = { ...track, start: 1, trimStart: 0, trimEnd: 10, volume: 0.5, fadeIn: 2, fadeOut: 4 }; // audible 1..11
    expect(trackGainAt(t, 0.5, 20)).toBe(0);
    expect(trackGainAt(t, 1, 20)).toBe(0);
    expect(trackGainAt(t, 2, 20)).toBeCloseTo(0.25);
    expect(trackGainAt(t, 3, 20)).toBeCloseTo(0.5);
    expect(trackGainAt(t, 6, 20)).toBeCloseTo(0.5);
    expect(trackGainAt(t, 9, 20)).toBeCloseTo(0.25);
    expect(trackGainAt(t, 11, 20)).toBe(0);
    expect(trackGainPoints(t, 20)).toEqual([
      { time: 1, gain: 0 },
      { time: 3, gain: 0.5 },
      { time: 7, gain: 0.5 },
      { time: 11, gain: 0 },
    ]);
    // The slide ends first: the fade out moves with it.
    expect(trackGainAt(t, 6, 8)).toBeCloseTo(0.25);
    // No fades: full volume from the first moment.
    expect(trackGainPoints({ ...t, fadeIn: 0, fadeOut: 0 }, 20)[0]).toEqual({ time: 1, gain: 0.5 });
    // Fades longer than the music share its length instead of overlapping.
    const short = { ...t, trimEnd: 3 }; // 3 s audible, 6 s of fades asked
    expect(trackGainAt(short, 2, 20)).toBeCloseTo(0.5);
    expect(Math.max(...[1, 1.5, 2, 2.5, 3, 3.5].map((x) => trackGainAt(short, x, 20)))).toBeLessThanOrEqual(0.5);
  });

  it("recognises music files by content and keeps them apart from video", () => {
    const bytes = (...parts: Array<string | number[]>) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
    expect(sniffAudioType(bytes("ID3", [4, 0, 0, 0, 0, 0, 35, 0x54, 0x53]))).toBe("audio/mpeg");
    expect(sniffAudioType(bytes([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("audio/mpeg");
    expect(sniffAudioType(bytes([0, 0, 0, 0x20], "ftypM4A ", [0, 0, 0, 0]))).toBe("audio/mp4");
    expect(sniffAudioType(bytes("RIFF", [0x24, 0x08, 0, 0], "WAVEfmt "))).toBe("audio/wav");
    expect(sniffAudioType(bytes([0, 0, 0, 0x20], "ftypisom", [0, 0, 2, 0]))).toBeNull();
    expect(sniffAudioType(bytes("this is text, not music"))).toBeNull();
    expect(sniffAudioType(bytes("RIFF", [0, 0, 0, 0], "AVI LIST"))).toBeNull();
    expect(sniffVideoType(bytes([0, 0, 0, 0x20], "ftypM4A ", [0, 0, 0, 0], "M4A mp42isom"))).toBeNull();
  });

  it("reduces samples to waveform bars", () => {
    const data = new Float32Array(8000);
    for (let i = 4000; i < 8000; i++) data[i] = i % 2 ? 0.5 : -0.5;
    const peaks = computePeaks([data], 4);
    expect(peaks).toEqual([0, 0, 0.5, 0.5]);
    expect(computePeaks([], 4)).toEqual([]);
    expect(computePeaks([new Float32Array(16).fill(3)], 2)).toEqual([1, 1]);
  });
});

describe("what one press on play covers", () => {
  it("is every clip of an independent slide", () => {
    const { project, surfaceId, video } = withVideo();
    const scope = playbackScope(project, surfaceId, 0, []);
    expect(scope).toMatchObject({ slideIndex: null, duration: 8 });
    expect(scope.clips.map((c) => c.id)).toEqual([video.id]);
  });

  it("is one slide of a seamless panorama: the selected video's slide, otherwise the slide in focus", () => {
    const { project, surfaceId, video } = withVideo("seamless"); // 8 s clip centered on slide 1 (0..1080)
    const second = { ...createVideo({ ...clip, id: "v2", duration: 3 }, place), id: "second", x: 1080 + 100 }; // on slide 2
    const pano = ops.addElements(ops.addAssetRef(project, { ...clip, id: "v2", duration: 3 }), surfaceId, [second]);
    // Nothing selected: the slide in focus decides.
    expect(playbackScope(pano, surfaceId, 0, []).clips.map((c) => c.id)).toEqual([video.id]);
    expect(playbackScope(pano, surfaceId, 0, [])).toMatchObject({ slideIndex: 0, duration: 8 });
    expect(playbackScope(pano, surfaceId, 1, [])).toMatchObject({ slideIndex: 1, duration: 3 });
    // A selected video brings its own slide, wherever the focus is.
    expect(playbackScope(pano, surfaceId, 0, ["second"])).toMatchObject({ slideIndex: 1, duration: 3 });
    expect(playbackScope(pano, surfaceId, 1, [video.id]).clips.map((c) => c.id)).toEqual([video.id]);
    // Two videos on the same slide play together.
    const together = ops.updateElements(pano, surfaceId, ["second"], { x: 200 });
    expect(playbackScope(together, surfaceId, 0, [video.id]).clips.map((c) => c.id).sort()).toEqual(["second", video.id].sort());
    expect(playbackScope(together, surfaceId, 1, []).clips).toEqual([]);
    // A clip that crosses a slide boundary plays with both slides.
    const crossing = ops.updateElements(pano, surfaceId, [video.id], { x: 700 });
    expect(playbackScope(crossing, surfaceId, 1, []).clips.map((c) => c.id).sort()).toEqual(["second", video.id].sort());
  });
});
