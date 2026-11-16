import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createImage, createProject, createShape } from "@/document/factory";
import { DocumentError } from "@/document/migrations";
import * as ops from "@/document/operations";
import { sniffImageType } from "./assets";
import {
  closeDb,
  deleteProject,
  duplicateStoredProject,
  getAssetBlob,
  listProjects,
  loadProject,
  putAsset,
  renameStoredProject,
  saveProject,
} from "./db";

const place = { centerX: 540, centerY: 540, maxWidth: 1080, maxHeight: 1080 };
const make = (name: string, date: string) =>
  createProject({ name, width: 1080, height: 1080, slideCount: 2, mode: "independent" }, new Date(date));
const asset = (id: string) => ({ id, name: `${id}.png`, mime: "image/png", width: 10, height: 10, size: 3 });
const stored = (id: string) => ({ ...asset(id), blob: new Blob(["abc"], { type: "image/png" }), createdAt: "2026-01-01" });

beforeEach(async () => {
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("creative-carousel-studio");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
});

describe("project persistence", () => {
  it("saves and reloads an identical document", async () => {
    let p = make("One", "2026-01-01");
    p = ops.addElements(p, p.slides[0].id, [createShape("star", place)]);
    await saveProject(p, null);
    expect(await loadProject(p.id)).toEqual(p);
    expect(await loadProject("missing")).toBeNull();
  });

  it("survives closing and reopening the database", async () => {
    const p = make("Persistent", "2026-01-01");
    await saveProject(p, null);
    await closeDb();
    expect((await loadProject(p.id))?.name).toBe("Persistent");
  });

  it("lists most recently modified first and keeps the cover when none is passed", async () => {
    const older = make("Older", "2026-01-01");
    const newer = make("Newer", "2026-02-01");
    await saveProject(older, new Blob(["cover"]));
    await saveProject(newer, null);
    await saveProject({ ...older, name: "Older renamed" });
    const list = await listProjects();
    expect(list.map((m) => m.name)).toEqual(["Newer", "Older renamed"]);
    expect(list[1].thumbnail).not.toBeNull();
    expect(list[0]).toMatchObject({ slideCount: 2, width: 1080, mode: "independent" });
  });

  it("renames and duplicates", async () => {
    const p = make("Original", "2026-01-01");
    await saveProject(p, null);
    await renameStoredProject(p.id, "  Renamed ");
    expect((await loadProject(p.id))?.name).toBe("Renamed");
    const copy = await duplicateStoredProject(p.id);
    expect(copy?.name).toBe("Renamed copy");
    expect(copy?.id).not.toBe(p.id);
    expect(await listProjects()).toHaveLength(2);
  });

  it("deleting a project removes only assets nobody else uses", async () => {
    await putAsset(stored("shared"));
    await putAsset(stored("solo"));
    let a = make("A", "2026-01-01");
    a = ops.addAssetRef(ops.addAssetRef(a, asset("shared")), asset("solo"));
    a = ops.addElements(a, a.slides[0].id, [createImage(asset("shared"), place)]);
    const b = ops.addAssetRef(make("B", "2026-01-02"), asset("shared"));
    await saveProject(a, null);
    await saveProject(b, null);
    await deleteProject(a.id);
    expect(await loadProject(a.id)).toBeNull();
    expect((await listProjects()).map((m) => m.id)).toEqual([b.id]);
    expect(await getAssetBlob("shared")).toBeDefined();
    expect(await getAssetBlob("solo")).toBeUndefined();
  });

  it("refuses to load corrupted stored data", async () => {
    const p = make("Broken", "2026-01-01");
    await saveProject({ ...p, width: -1 } as never, null);
    await expect(loadProject(p.id)).rejects.toBeInstanceOf(DocumentError);
  });
});

describe("file signature sniffing", () => {
  it("recognises real image headers and rejects everything else", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    const webp = new TextEncoder().encode("RIFFxxxxWEBPVP8 ");
    expect(sniffImageType(webp)).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});
