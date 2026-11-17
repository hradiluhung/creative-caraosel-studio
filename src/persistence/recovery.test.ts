import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createProject, createShape } from "@/document/factory";
import { DocumentError } from "@/document/migrations";
import * as ops from "@/document/operations";
import { closeDb, listProjects, listVersions, loadProject, recoverProjectFromVersion, saveProject, saveProjectNow, saveVersion } from "./db";
import { classifyStorageError, describeStorageError } from "./errors";

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

const named = (name: string, message = "x") => Object.assign(new Error(message), { name });
const base = () => createProject({ name: "Trip", width: 1080, height: 1350, slideCount: 2, mode: "independent" }, new Date("2026-01-01"));
const withShape = (p = base()) => ops.addElements(p, p.slides[0].id, [createShape("rect", { centerX: 500, centerY: 500, maxWidth: 300, maxHeight: 300 } as never)]);
const damage = (id: string) =>
  new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("creative-carousel-studio");
    req.onsuccess = () => {
      const tx = req.result.transaction("projectDocs", "readwrite");
      tx.objectStore("projectDocs").put({ schemaVersion: 6, broken: true }, id);
      tx.oncomplete = () => (req.result.close(), resolve());
      tx.onerror = () => reject(tx.error);
    };
  });

describe("storage error messages", () => {
  it("recognises a full disk in every wording browsers use", () => {
    expect(classifyStorageError(named("QuotaExceededError"))).toBe("full");
    expect(classifyStorageError(new Error("The quota has been exceeded."))).toBe("full");
    expect(classifyStorageError(new Error("Encountered full disk while opening backing store"))).toBe("unknown"); // not guessed from "full" alone
    expect(classifyStorageError(new Error("database or disk is full"))).toBe("full");
    expect(describeStorageError(named("QuotaExceededError"))).toMatch(/out of storage space/);
  });

  it("recognises unavailable storage, a blocked upgrade and newer data", () => {
    expect(classifyStorageError(named("SecurityError"))).toBe("unavailable");
    expect(classifyStorageError(named("InvalidStateError", "A mutation operation was attempted on a database that did not allow mutations."))).toBe("unavailable");
    expect(classifyStorageError(new Error("IndexedDB is not available"))).toBe("unavailable");
    expect(classifyStorageError(new Error("The request was blocked"))).toBe("blocked");
    expect(classifyStorageError(named("VersionError", "The requested version (2) is less than the existing version (3)."))).toBe("newer");
    expect(describeStorageError(named("SecurityError"))).toMatch(/Private browsing/);
  });

  it("keeps the message of errors it does not know and falls back for non-errors", () => {
    expect(describeStorageError(new Error("Photo is too large"))).toBe("Photo is too large");
    expect(describeStorageError(undefined, "Could not save")).toBe("Could not save");
    expect(describeStorageError({}, "Could not save")).toBe("Could not save");
    expect(describeStorageError("quota exceeded")).toMatch(/out of storage space/);
  });
});

describe("recovery", () => {
  it("writes the document at once when the page is closing", async () => {
    const first = base();
    await saveProject(first, null); // opens the connection, like any earlier save or load
    const edited = ops.renameProject(withShape(first), "Trip, edited");
    expect(saveProjectNow(edited)).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    const stored = await loadProject(first.id);
    expect(stored?.slides[0].elements).toHaveLength(1);
    expect((await listProjects())[0]).toMatchObject({ name: "Trip, edited", slideCount: 2 });
  });

  it("reports that nothing was written when no connection is open", async () => {
    expect(saveProjectNow(base())).toBe(false);
  });

  it("a damaged project fails loudly, stays in the list, and comes back from a saved version", async () => {
    const good = withShape();
    await saveProject(good, null);
    await saveVersion(good, "manual", { name: "Good", thumbnail: null });
    const later = ops.renameProject(good, "Trip v2");
    await saveProject(later, null);
    await damage(good.id);

    await expect(loadProject(good.id)).rejects.toBeInstanceOf(DocumentError);
    expect(await listProjects()).toHaveLength(1);
    const [version] = await listVersions(good.id);
    const back = await recoverProjectFromVersion(good.id, version.id, new Date("2026-03-01"));
    expect(back).toMatchObject({ id: good.id, name: "Trip", updatedAt: "2026-03-01T00:00:00.000Z" });
    const opened = await loadProject(good.id);
    expect(opened?.slides[0].elements).toHaveLength(1);
    expect((await listProjects())[0].name).toBe("Trip");
    expect(await listVersions(good.id)).toHaveLength(1); // versions are kept
  });

  it("never restores a version into another project, and reports a missing version", async () => {
    const a = withShape();
    const b = base();
    await saveProject(a, null);
    await saveProject(b, null);
    const v = await saveVersion(a, "manual", { name: "A", thumbnail: null });
    expect(await recoverProjectFromVersion(b.id, v.id)).toBeNull();
    expect(await recoverProjectFromVersion(a.id, "nope")).toBeNull();
    expect((await loadProject(b.id))?.slides[0].elements).toHaveLength(0);
  });
});
