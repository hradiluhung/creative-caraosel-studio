import { describe, expect, it } from "vitest";
import { createPlaceholder, createProject, createVideo, imageInFrame, videoInFrame } from "./factory";
import { frameCrop, getSurfaces } from "./geometry";
import { parseProject } from "./migrations";
import * as ops from "./operations";
import { originalSize } from "./sizing";
import { projectSchema, SCHEMA_VERSION, type AssetRef, type ImageElement } from "./schema";

const place = { centerX: 540, centerY: 675, maxWidth: 1080, maxHeight: 1350 };
const clip: AssetRef = { id: "v1", name: "beach.mp4", mime: "video/mp4", width: 1920, height: 1080, size: 5_000_000, duration: 80 };
const photo: AssetRef = { id: "p1", name: "pic.jpg", mime: "image/jpeg", width: 4000, height: 3000, size: 10 };

function withFrame() {
  const project = createProject({ name: "Frames", width: 1080, height: 1350, slideCount: 1, mode: "independent" });
  const surfaceId = getSurfaces(project)[0].id;
  const frame: ImageElement = {
    ...createPlaceholder({ x: 100, y: 200, width: 400, height: 500 }, "Photo 2"),
    rotation: -4,
    mask: "arch",
    cornerRadius: 12,
    borderWidth: 6,
    borderColor: "#fafafa",
    shadow: { color: "#000000", blur: 10, offsetX: 0, offsetY: 4, opacity: 0.3 },
    groupId: "g1",
  };
  const other = createPlaceholder({ x: 600, y: 200, width: 300, height: 300 });
  return { project: ops.addElements(project, surfaceId, [frame, other]), surfaceId, frame, other };
}

describe("video crop (schema 8)", () => {
  it("is a schema 8 field with the same shape as a photo crop", () => {
    expect(SCHEMA_VERSION).toBe(8);
    const project = createProject({ name: "x", width: 1080, height: 1350, slideCount: 1, mode: "independent" });
    const surfaceId = getSurfaces(project)[0].id;
    const video = { ...createVideo(clip, place), crop: { x: 0.5, y: -1, zoom: 2, turns: 1 as const } };
    const doc = ops.addElements(ops.addAssetRef(project, clip), surfaceId, [video]);
    expect(projectSchema.safeParse(doc).success).toBe(true);
    expect(parseProject(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    const bad = ops.updateElements(doc, surfaceId, [video.id], { crop: { x: 2, y: 0, zoom: 1, turns: 0 } } as never);
    expect(projectSchema.safeParse(bad).success).toBe(false);
  });

  it("opens schema 7 documents unchanged", () => {
    const { project } = withFrame();
    const v7 = { ...JSON.parse(JSON.stringify(project)), schemaVersion: 7 };
    expect(parseProject(v7)).toEqual(project);
  });

  it("uses the same geometry as photos: a video frame crop is frameCrop of the video size", () => {
    // 1920x1080 into a square frame, zoomed 2x, panned fully right.
    const c = frameCrop(1920, 1080, 500, 500, { x: 1, y: 0, zoom: 2, turns: 0 });
    expect(c.width).toBe(540);
    expect(c.height).toBe(540);
    expect(c.x).toBe(1920 - 540);
    expect(c.y).toBe(270);
  });

  it("a quarter turn swaps the original size of a video", () => {
    const video = { ...createVideo(clip, place), crop: { x: 0, y: 0, zoom: 1, turns: 1 as const } };
    const o = originalSize(video, { width: 1080, height: 1350 }, { asset: clip });
    expect(o && o.width / (o.height ?? 1)).toBeCloseTo(1080 / 1920, 2);
  });
});

describe("frames take photos and videos", () => {
  it("puts a video into an empty frame, keeping box, stacking, group and frame look", () => {
    const { project, surfaceId, frame } = withFrame();
    const video = videoInFrame(frame, clip);
    const next = ops.replaceElement(ops.addAssetRef(project, clip), surfaceId, frame.id, video);
    expect(projectSchema.safeParse(next).success).toBe(true);
    const els = getSurfaces(next)[0].elements;
    expect(els[0].id).toBe(frame.id); // same place in the stacking order, same id (selection survives)
    expect(els[0]).toMatchObject({
      type: "video",
      assetId: "v1",
      x: 100,
      y: 200,
      width: 400,
      height: 500,
      rotation: -4,
      mask: "arch",
      cornerRadius: 12,
      borderWidth: 6,
      groupId: "g1",
      start: 0,
      trimStart: 0,
      volume: 1,
      muted: false,
      name: "beach",
    });
    expect(els[0]).not.toHaveProperty("adjustments");
    expect(els[0]).not.toHaveProperty("crop");
    // A long clip is cut to the 60 s a video slide may last.
    expect((els[0] as { trimEnd: number }).trimEnd).toBe(60);
  });

  it("replacing a video keeps its timing and sound settings, and a photo frame can take a photo back", () => {
    const { frame } = withFrame();
    const video = { ...videoInFrame(frame, clip), start: 2, muted: true, loop: true, crop: { x: 1, y: 0, zoom: 2, turns: 0 as const } };
    const again = videoInFrame(video, { ...clip, id: "v2", duration: 5 });
    expect(again).toMatchObject({ start: 2, muted: true, loop: true, trimEnd: 5, name: video.name });
    expect(again.crop).toBeUndefined(); // a new picture starts centred
    const back = imageInFrame(again, photo);
    expect(back).toMatchObject({ type: "image", assetId: "p1", mask: "arch", groupId: "g1", filter: null, name: "pic" });
    expect(back).not.toHaveProperty("trimEnd");
  });

  it("emptying a video frame gives a placeholder; a photo frame keeps its filter when the photo changes", () => {
    const { frame } = withFrame();
    const empty = imageInFrame(videoInFrame(frame, clip), null);
    expect(empty.assetId).toBeNull();
    const filtered: ImageElement = { ...frame, assetId: "p0", filter: "Film", adjustments: { ...frame.adjustments, contrast: 20 }, crop: { x: 1, y: 1, zoom: 3, turns: 0 } };
    const swapped = imageInFrame(filtered, photo);
    expect(swapped).toMatchObject({ assetId: "p1", filter: "Film", name: "Photo 2" });
    expect(swapped.adjustments.contrast).toBe(20);
    expect(swapped.crop).toBeUndefined();
  });

  it("replaceElement leaves other elements and unknown ids alone", () => {
    const { project, surfaceId, frame, other } = withFrame();
    const next = ops.replaceElement(project, surfaceId, "nope", imageInFrame(frame, photo));
    expect(next).toBe(project);
    const done = ops.replaceElement(project, surfaceId, frame.id, imageInFrame(frame, photo));
    expect(getSurfaces(done)[0].elements[1]).toBe(other);
  });
});
