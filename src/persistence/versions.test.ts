import "fake-indexeddb/auto";
import { openDB } from "idb";
import { beforeEach, describe, expect, it } from "vitest";
import { createImage, createProject, createShape } from "@/document/factory";
import { AUTO_VERSION_INTERVAL_MS, isKeptVersion, MAX_UNNAMED_VERSIONS, restoredProject, shouldAutoVersion, versionLabel, versionsToPrune, type VersionInfo } from "@/document/history";
import * as ops from "@/document/operations";
import { SCHEMA_VERSION } from "@/document/schema";
import { closeDb, deleteProject, deleteVersion, getAssetBlob, listProjects, listVersions, loadProject, loadVersion, putAsset, renameVersion, saveProject, saveVersion } from "./db";

const place = { centerX: 540, centerY: 540, maxWidth: 1080, maxHeight: 1080 };
const make = (name: string) => createProject({ name, width: 1080, height: 1080, slideCount: 2, mode: "independent" }, new Date("2026-01-01"));
const asset = (id: string) => ({ id, name: `${id}.png`, mime: "image/png", width: 10, height: 10, size: 3 });
const stored = (id: string) => ({ ...asset(id), blob: new Blob(["abc"], { type: "image/png" }), createdAt: "2026-01-01" });
const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 12, minutes));
const wipe = () =>
  new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("creative-carousel-studio");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

beforeEach(async () => {
  await closeDb();
  await wipe();
});

describe("version history rules", () => {
  const v = (id: string, minute: number, extra: Partial<VersionInfo> = {}): VersionInfo => ({ id, createdAt: at(minute).toISOString(), kind: "auto", ...extra });

  it("keeps named versions and the newest unnamed ones", () => {
    const list = [v("a", 1), v("b", 2, { name: "Keep me" }), v("c", 3), v("d", 4, { kind: "before-restore" }), v("e", 5, { kind: "manual" })];
    expect(versionsToPrune(list, 2)).toEqual(["c", "a"]);
    expect(versionsToPrune(list, 10)).toEqual([]);
    expect(versionsToPrune(list, 0)).toEqual(["e", "d", "c", "a"]);
    expect(isKeptVersion(v("x", 1, { name: "  " }))).toBe(false);
    expect(MAX_UNNAMED_VERSIONS).toBe(20);
  });

  it("makes an automatic version only when something changed and the last one is old enough", () => {
    const doc = { updatedAt: at(30).toISOString() };
    expect(shouldAutoVersion(doc, undefined, at(30))).toBe(true);
    expect(shouldAutoVersion(doc, at(31).toISOString(), at(50))).toBe(false); // nothing changed since
    expect(shouldAutoVersion(doc, at(25).toISOString(), at(30))).toBe(false); // changed, but 5 minutes ago
    expect(shouldAutoVersion(doc, at(20).toISOString(), at(30))).toBe(true);
    expect(AUTO_VERSION_INTERVAL_MS).toBe(600_000);
  });

  it("restores content under the current project's identity", () => {
    const old = { ...make("Old name"), id: "old-id" };
    const current = { ...ops.addElements(make("Current name"), make("x").slides[0].id, []), id: "current-id", createdAt: "2026-05-05T00:00:00.000Z" };
    const restored = restoredProject(current, old);
    expect(restored).toMatchObject({ id: "current-id", name: "Current name", createdAt: current.createdAt });
    expect(restored.slides).toBe(old.slides);
    expect(versionLabel({ kind: "auto" })).toBe("Automatic version");
    expect(versionLabel({ kind: "before-restore" })).toBe("Before restore");
    expect(versionLabel({ kind: "manual", name: " Final " })).toBe("Final");
  });
});

describe("stored versions", () => {
  it("saves, lists newest first without documents, and loads one back", async () => {
    let p = make("One");
    await saveProject(p, null);
    await saveVersion(p, "auto", { now: at(0), id: "first" });
    p = ops.addElements(p, p.slides[0].id, [createShape("rect", place)]);
    await saveVersion(p, "manual", { name: "With a box", now: at(5), id: "second", thumbnail: new Blob(["png"], { type: "image/png" }) });
    const list = await listVersions(p.id);
    expect(list.map((v) => [v.id, v.kind, v.name, v.slideCount])).toEqual([
      ["second", "manual", "With a box", 2],
      ["first", "auto", undefined, 2],
    ]);
    expect("doc" in list[0]).toBe(false);
    expect(list[0].thumbnail?.size).toBe(3);
    expect((await loadVersion("first"))?.slides[0].elements).toHaveLength(0);
    expect((await loadVersion("second"))?.slides[0].elements).toHaveLength(1);
    expect(await loadVersion("nope")).toBeNull();
    expect(await listVersions("another-project")).toEqual([]);
  });

  it("prunes old unnamed versions but never a named one", async () => {
    const p = make("Busy");
    await saveVersion(p, "manual", { name: "Milestone", now: at(0), id: "named" });
    for (let i = 1; i <= MAX_UNNAMED_VERSIONS + 5; i++) await saveVersion(p, "auto", { now: at(i), id: `auto-${i}` });
    const list = await listVersions(p.id);
    expect(list).toHaveLength(MAX_UNNAMED_VERSIONS + 1);
    expect(list[0].id).toBe(`auto-${MAX_UNNAMED_VERSIONS + 5}`);
    expect(list.at(-1)?.id).toBe("named");
    expect(list.some((v) => v.id === "auto-5")).toBe(false);
    expect(list.some((v) => v.id === "auto-6")).toBe(true);
  });

  it("renames (which keeps a version) and deletes", async () => {
    const p = make("Named");
    await saveVersion(p, "auto", { now: at(0), id: "v" });
    await renameVersion("v", "  Approved by client  ");
    expect((await listVersions(p.id))[0].name).toBe("Approved by client");
    await renameVersion("v", "");
    expect("name" in (await listVersions(p.id))[0]).toBe(false);
    await deleteVersion("v");
    expect(await listVersions(p.id)).toEqual([]);
  });

  it("opens a version saved under an older schema", async () => {
    const p = make("Old schema");
    const legacy = { ...JSON.parse(JSON.stringify(p)), schemaVersion: 2 };
    for (const s of legacy.slides) delete s.duration;
    await saveVersion(legacy, "auto", { now: at(0), id: "legacy" });
    const opened = await loadVersion("legacy");
    expect(opened?.schemaVersion).toBe(SCHEMA_VERSION);
    expect(opened?.name).toBe("Old schema");
  });

  it("keeps an asset alive that only a version still uses, and frees it with the project", async () => {
    await putAsset(stored("photo"));
    await putAsset(stored("shared"));
    let p = ops.addAssetRef(ops.addAssetRef(make("History"), asset("photo")), asset("shared"));
    p = ops.addElements(p, p.slides[0].id, [createImage(asset("photo"), place)]);
    await saveVersion(p, "auto", { now: at(0), id: "with-photo" });
    // The photo is removed from the current document; only the version still knows it.
    const current = { ...p, assets: p.assets.filter((a) => a.id !== "photo"), slides: p.slides.map((s) => ({ ...s, elements: [] })) };
    await saveProject(current, null);
    // Another project uses the shared asset and has a version that uses it too.
    const other = ops.addAssetRef(make("Other"), asset("shared"));
    await saveProject(other, null);
    await saveVersion(other, "auto", { now: at(1), id: "other-v" });

    await deleteProject(current.id);
    expect(await listVersions(current.id)).toEqual([]);
    expect(await getAssetBlob("photo")).toBeUndefined(); // freed together with its last reference
    expect(await getAssetBlob("shared")).toBeDefined();

    // Deleting the other project's current document reference is not enough while its version exists... it goes with the project.
    await deleteProject(other.id);
    expect(await getAssetBlob("shared")).toBeUndefined();
    expect(await listVersions(other.id)).toEqual([]);
  });

  it("does not let one project's deletion free an asset another project's version needs", async () => {
    await putAsset(stored("pic"));
    const a = ops.addAssetRef(make("A"), asset("pic"));
    await saveProject(a, null);
    const b = make("B");
    await saveProject(b, null);
    await saveVersion(ops.addAssetRef(b, asset("pic")), "manual", { name: "had the picture", now: at(0), id: "b-old" });
    await deleteProject(a.id);
    expect(await getAssetBlob("pic")).toBeDefined();
  });
});

describe("database upgrade to version 3", () => {
  it("adds the history store to an existing version 2 database without touching its data", async () => {
    const p = make("From before");
    const v2 = await openDB("creative-carousel-studio", 2, {
      upgrade(database) {
        database.createObjectStore("projectMeta", { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
        database.createObjectStore("projectDocs");
        database.createObjectStore("assets", { keyPath: "id" });
        database.createObjectStore("fonts", { keyPath: "id" });
        database.createObjectStore("templates", { keyPath: "id" });
        database.createObjectStore("brandKits", { keyPath: "id" });
      },
    });
    await v2.put("projectDocs", p, p.id);
    await v2.put("projectMeta", { id: p.id, name: p.name, mode: p.mode, width: 1080, height: 1080, slideCount: 2, createdAt: p.createdAt, updatedAt: p.updatedAt, thumbnail: null });
    await v2.put("assets", stored("old-asset"));
    v2.close();

    expect((await listProjects()).map((m) => m.name)).toEqual(["From before"]);
    expect((await loadProject(p.id))?.id).toBe(p.id);
    expect(await getAssetBlob("old-asset")).toBeDefined();
    expect(await listVersions(p.id)).toEqual([]);
    await saveVersion(p, "auto", { now: at(0) });
    expect(await listVersions(p.id)).toHaveLength(1);
  });
});
