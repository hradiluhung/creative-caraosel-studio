import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createProject } from "@/document/factory";
import * as ops from "@/document/operations";
import { closeDb, deleteAsset, getAssetBlob, getAssetPreview, listLibrary, putAsset, putBrandKit, saveProject, saveVersion, updateAssetLibraryInfo } from "./db";
import {
  allCollections,
  assetKind,
  DEFAULT_LIBRARY_FILTER,
  filterLibrary,
  formatBytes,
  normalizeCollections,
  parseCollections,
  summarizeStorage,
  usageSummary,
  type LibraryItem,
} from "./libraryModel";

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

const none = { projects: [], templates: [], brandKits: [], versions: 0 };
const item = (id: string, extra: Partial<LibraryItem> = {}): LibraryItem => ({
  id,
  name: `${id}.jpg`,
  mime: "image/jpeg",
  width: 100,
  height: 50,
  size: 1000,
  kind: "image",
  createdAt: "2026-01-01",
  favorite: false,
  collections: [],
  storedBytes: 1000,
  usage: none,
  ...extra,
});

describe("asset library model", () => {
  it("tells images, videos and audio apart", () => {
    expect(assetKind({ mime: "image/png" })).toBe("image");
    expect(assetKind({ mime: "video/mp4" })).toBe("video");
    expect(assetKind({ mime: "audio/mpeg" })).toBe("audio");
  });

  it("cleans collection names", () => {
    expect(parseCollections(" Bali ,  bali, , Client   A ,")).toEqual(["Bali", "Client A"]);
    expect(normalizeCollections(["x".repeat(80)])[0]).toHaveLength(40);
    expect(normalizeCollections(Array.from({ length: 30 }, (_, i) => `c${i}`))).toHaveLength(12);
    expect(allCollections([item("a", { collections: ["Zoo", "bali"] }), item("b", { collections: ["Bali", "Art"] })])).toEqual(["Art", "bali", "Zoo"]);
  });

  it("filters by text, type, favorite, collection and use, and sorts", () => {
    const items = [
      item("beach", { createdAt: "2026-01-03", collections: ["Bali"], favorite: true, storedBytes: 10 }),
      item("clip", { kind: "video", mime: "video/mp4", createdAt: "2026-01-02", storedBytes: 900, usage: { ...none, projects: ["P"] } }),
      item("song", { kind: "audio", mime: "audio/mpeg", createdAt: "2026-01-01", storedBytes: 50 }),
    ];
    const ids = (patch: Partial<typeof DEFAULT_LIBRARY_FILTER>) => filterLibrary(items, { ...DEFAULT_LIBRARY_FILTER, ...patch }).map((i) => i.id);
    expect(ids({})).toEqual(["beach", "clip", "song"]);
    expect(ids({ sort: "oldest" })).toEqual(["song", "clip", "beach"]);
    expect(ids({ sort: "largest" })).toEqual(["clip", "song", "beach"]);
    expect(ids({ sort: "name" })).toEqual(["beach", "clip", "song"]);
    expect(ids({ query: " BEA " })).toEqual(["beach"]);
    expect(ids({ query: "bali" })).toEqual(["beach"]); // matches the collection name
    expect(ids({ kind: "video" })).toEqual(["clip"]);
    expect(ids({ favoritesOnly: true })).toEqual(["beach"]);
    expect(ids({ collection: "bali" })).toEqual(["beach"]);
    expect(ids({ unusedOnly: true })).toEqual(["beach", "song"]);
    expect(ids({ kind: "audio", favoritesOnly: true })).toEqual([]);
    expect(items.map((i) => i.id)).toEqual(["beach", "clip", "song"]); // input untouched
  });

  it("summarises storage and usage", () => {
    const s = summarizeStorage([item("a"), item("b", { kind: "video", storedBytes: 5000, usage: { ...none, versions: 2 } })]);
    expect(s).toMatchObject({ count: 2, bytes: 6000, unused: { count: 1, bytes: 1000 } });
    expect(s.byKind.video).toEqual({ count: 1, bytes: 5000 });
    expect(usageSummary(none)).toBeNull();
    expect(usageSummary({ projects: ["A", "B"], templates: ["T"], brandKits: [], versions: 1 })).toBe("2 projects, 1 template, 1 saved version");
    expect([formatBytes(900), formatBytes(2048), formatBytes(5 * 1024 * 1024), formatBytes(3 * 1024 ** 3)]).toEqual(["900 B", "2 KB", "5.0 MB", "3.00 GB"]);
  });
});

describe("asset library storage", () => {
  const ref = (id: string, mime = "image/png") => ({ id, name: `${id}.png`, mime, width: 10, height: 10, size: 3 });
  const store = (id: string, extra: object = {}) => putAsset({ ...ref(id), blob: new Blob(["abc"], { type: "image/png" }), createdAt: "2026-01-01", ...extra });
  const project = (name: string, assets: string[]) =>
    assets.reduce((p, id) => ops.addAssetRef(p, ref(id)), createProject({ name, width: 1080, height: 1080, slideCount: 1, mode: "independent" }, new Date("2026-01-01")));

  it("lists every asset with where it is used", async () => {
    await store("a");
    await store("b");
    await store("v", { mime: "video/mp4", poster: new Blob(["pp"]), proxy: new Blob(["xxxxx"]) });
    await store("lonely");
    const one = project("One", ["a", "b"]);
    await saveProject(one, null);
    await saveProject(project("Two", ["a"]), null);
    await saveVersion(project("One", ["a", "v"]), "manual", { name: "keep", thumbnail: null });
    await putBrandKit({ id: "k", name: "Kit", colors: [], headingFont: "Inter", bodyFont: "Inter", logos: [ref("b")], updatedAt: "2026-01-01" });

    const byId = new Map((await listLibrary()).map((i) => [i.id, i]));
    expect(byId.size).toBe(4);
    expect(byId.get("a")!.usage).toEqual({ projects: ["One", "Two"], templates: [], brandKits: [], versions: 1 });
    expect(byId.get("b")!.usage).toEqual({ projects: ["One"], templates: [], brandKits: ["Kit"], versions: 0 });
    expect(byId.get("v")).toMatchObject({ kind: "video", storedBytes: 3 + 2 + 5, usage: { projects: [], versions: 1 } });
    expect(byId.get("lonely")!.usage).toEqual(none);
    expect(byId.get("a")).not.toHaveProperty("blob");
  });

  it("stores favorites and collections without touching the file", async () => {
    await store("a", { poster: new Blob(["pp"]) });
    await updateAssetLibraryInfo("a", { favorite: true });
    await updateAssetLibraryInfo("a", { collections: [" Bali ", "bali", ""] });
    await updateAssetLibraryInfo("gone", { favorite: true }); // no error, nothing created
    const all = await listLibrary();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ favorite: true, collections: ["Bali"] });
    expect((await getAssetBlob("a"))!.size).toBe(3);
    expect((await getAssetPreview("a"))!.size).toBe(2);
  });

  it("previews images with the file itself and audio with nothing", async () => {
    await store("img");
    await store("song", { mime: "audio/mpeg" });
    expect((await getAssetPreview("img"))!.size).toBe(3);
    expect(await getAssetPreview("song")).toBeUndefined();
    expect(await getAssetPreview("nope")).toBeUndefined();
  });

  it("deletes one asset and leaves the others", async () => {
    await store("a");
    await store("b");
    await deleteAsset("a");
    expect((await listLibrary()).map((i) => i.id)).toEqual(["b"]);
    expect(await getAssetBlob("a")).toBeUndefined();
  });
});
