import "fake-indexeddb/auto";
import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";
import { createImage, createPlaceholder, createProject, createText } from "@/document/factory";
import * as ops from "@/document/operations";
import { projectSchema, type Project } from "@/document/schema";
import { closeDb, getAssetBlob, getAssetPoster, listLibrary, listStoredTemplates, putAsset, putStoredTemplate } from "@/persistence/db";
import { duplicateTemplate, listAllTemplates, listBuiltInTemplates, loadUserTemplate, saveTemplateDoc, updateTemplateDetails } from "./index";
import { packTemplate, templateFileName, TemplateFileError, unpackTemplate, usedAssets } from "./file";
import { cleanTemplateCategory, cleanTemplateDescription, cleanTemplateName, countFrames, DEFAULT_TEMPLATE_FILTER, filterTemplates, MY_TEMPLATES, stripPhotos, TEMPLATE_CATEGORIES } from "./model";
import { exportTemplateFile, importTemplateFile } from "./transfer";

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

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9, 9, 9, 9, 9]);
const place = { centerX: 540, centerY: 675, maxWidth: 600, maxHeight: 600 } as never;
const used = { id: "asset-used", name: "used.png", mime: "image/png", width: 40, height: 30, size: PNG.length };
const unused = { id: "asset-unused", name: "unused.jpg", mime: "image/jpeg", width: 40, height: 30, size: JPG.length };

function sample(): { doc: Project; imageId: string } {
  const base = createProject({ name: "Sample", width: 1080, height: 1350, slideCount: 2, mode: "independent" }, new Date("2026-01-01"));
  const img = createImage(used, place);
  const frame = createPlaceholder({ x: 10, y: 10, width: 300, height: 300 }, "Photo 1");
  const text = createText("heading", place);
  let doc = ops.addAssetRef(ops.addAssetRef(base, used), unused);
  doc = ops.addElements(doc, doc.slides[0].id, [img, frame]);
  doc = ops.addElements(doc, doc.slides[1].id, [text]);
  return { doc, imageId: img.id };
}
const storeAssets = async () => {
  await putAsset({ ...used, blob: new Blob([PNG], { type: "image/png" }), createdAt: "2026-01-01" });
  await putAsset({ ...unused, blob: new Blob([JPG], { type: "image/jpeg" }), createdAt: "2026-01-01" });
};
const reader = async (id: string) => {
  const blob = await getAssetBlob(id);
  return blob ? { blob, poster: await getAssetPoster(id) } : undefined;
};

describe("template rules", () => {
  it("cleans names, categories and descriptions", () => {
    expect(cleanTemplateName("  My   template ")).toBe("My template");
    expect(cleanTemplateName("   ")).toBe("Untitled template");
    expect(cleanTemplateName("x".repeat(200))).toHaveLength(80);
    expect(cleanTemplateCategory("  ")).toBe(MY_TEMPLATES);
    expect(cleanTemplateCategory(" Travel ")).toBe("Travel");
    expect(cleanTemplateDescription(` ${"d".repeat(400)} `)).toHaveLength(300);
    expect(TEMPLATE_CATEGORIES[0]).toBe(MY_TEMPLATES);
    expect(new Set(TEMPLATE_CATEGORIES).size).toBe(TEMPLATE_CATEGORIES.length);
  });

  it("filters by text, category, ratio, slide count, favorites and source; recents first", () => {
    const t = (id: string, extra: object = {}, slides = 3, w = 1080, h = 1350) => ({ id, name: id, category: "Travel", source: "builtin" as const, doc: { width: w, height: h, slides: Array.from({ length: slides }, () => ({})) as never }, ...extra });
    const all = [t("alpha"), t("beta", { category: "Food", description: "For recipe posts" }, 5), t("gamma", { source: "user" as const }, 8, 1080, 1080), t("delta", {}, 1)];
    const ids = (patch: object, fav: string[] = [], recent: string[] = []) => filterTemplates(all, { ...DEFAULT_TEMPLATE_FILTER, ...patch }, fav, recent).map((x) => x.id);
    expect(ids({})).toEqual(["alpha", "beta", "gamma", "delta"]);
    expect(ids({ query: "RECIPE" })).toEqual(["beta"]); // description
    expect(ids({ query: "food" })).toEqual(["beta"]); // category
    expect(ids({ category: "Travel" })).toEqual(["alpha", "gamma", "delta"]);
    expect(ids({ ratio: "1:1" })).toEqual(["gamma"]);
    expect(ids({ count: "1-3" })).toEqual(["alpha", "delta"]);
    expect(ids({ count: "4-6" })).toEqual(["beta"]);
    expect(ids({ count: "7+" })).toEqual(["gamma"]);
    expect(ids({ favoritesOnly: true }, ["delta", "beta"])).toEqual(["beta", "delta"]);
    expect(ids({ source: "user" })).toEqual(["gamma"]);
    expect(ids({}, [], ["delta", "beta"])).toEqual(["delta", "beta", "alpha", "gamma"]);
    expect(ids({ category: "Travel", count: "7+", ratio: "4:5" })).toEqual([]);
  });

  it("counts frames and empties them without touching anything else", () => {
    const { doc, imageId } = sample();
    expect(countFrames(doc)).toEqual({ empty: 1, filled: 1 });
    const stripped = stripPhotos(doc);
    expect(countFrames(stripped)).toEqual({ empty: 2, filled: 0 });
    expect(stripped.assets).toEqual([]);
    const before = doc.slides[0].elements.find((e) => e.id === imageId)!;
    const after = stripped.slides[0].elements.find((e) => e.id === imageId)!;
    expect(after).toEqual({ ...before, assetId: null, crop: undefined }); // geometry, mask, border and look are kept
    expect(stripped.slides[1]).toEqual(doc.slides[1]); // text untouched
    expect(projectSchema.safeParse(JSON.parse(JSON.stringify(stripped))).success).toBe(true);
    expect(countFrames(doc)).toEqual({ empty: 1, filled: 1 }); // input not mutated
  });
});

describe("template files", () => {
  it("round-trips a template with exactly the files it uses", async () => {
    await storeAssets();
    const { doc } = sample();
    expect(usedAssets(doc).map((a) => a.id)).toEqual(["asset-used"]);
    const file = await packTemplate({ name: " Trip  recap ", category: "Travel", description: "Five slides", doc, thumbnail: new Blob([JPG], { type: "image/jpeg" }) }, reader);
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(["assets/", "assets/asset-used", "template.json", "thumbnail"]);

    const back = await unpackTemplate(file);
    expect(back).toMatchObject({ name: "Trip recap", category: "Travel", description: "Five slides" });
    expect(back.doc.slides).toEqual(JSON.parse(JSON.stringify(doc.slides)));
    expect(back.doc.assets.map((a) => a.id)).toEqual(["asset-used"]);
    expect(back.assets).toHaveLength(1);
    expect(new Uint8Array(await back.assets[0].blob.arrayBuffer())).toEqual(PNG);
    expect(back.assets[0].blob.type).toBe("image/png");
    expect(back.thumbnail?.type).toBe("image/jpeg");
  });

  it("refuses to export a template whose file is missing on this device", async () => {
    const { doc } = sample();
    await expect(packTemplate({ name: "x", category: "y", doc, thumbnail: null }, reader)).rejects.toThrow(/missing on this device/);
  });

  it("rejects files that are not templates, are damaged, lie about their content or come from the future", async () => {
    await storeAssets();
    const { doc } = sample();
    const good = await packTemplate({ name: "x", category: "y", doc, thumbnail: null }, reader);
    const remake = async (change: (zip: JSZip, manifest: Record<string, unknown>) => void | Promise<void>) => {
      const zip = await JSZip.loadAsync(await good.arrayBuffer());
      const manifest = JSON.parse(await zip.file("template.json")!.async("string"));
      await change(zip, manifest);
      if (zip.file("template.json")) zip.file("template.json", JSON.stringify(manifest));
      return zip.generateAsync({ type: "blob" });
    };
    const fails = async (file: Blob, message: RegExp) => {
      await expect(unpackTemplate(file)).rejects.toThrow(message);
      await expect(unpackTemplate(file)).rejects.toBeInstanceOf(TemplateFileError);
    };
    await fails(new Blob(["hello"]), /not a template file/);
    await fails(await remake((zip) => void zip.remove("template.json")), /not a template file/);
    await fails(await remake((_z, m) => void (m.format = "something-else")), /not a template file/);
    await fails(await remake((_z, m) => void (m.version = 99)), /newer version/);
    await fails(await remake((_z, m) => void ((m.doc as { width: number }).width = -5)), /not valid/);
    await fails(await remake((zip) => void zip.remove("assets/asset-used")), /missing from this template file/);
    await fails(await remake((zip) => void zip.file("assets/asset-used", "<script>alert(1)</script>")), /not a supported/);
    await fails(await remake((_z, m) => void ((m.doc as Project).assets[0].mime = "video/mp4")), /not a supported|not what it claims/);
    // An id that tries to leave the assets folder
    await fails(
      await remake((zip, m) => {
        const d = m.doc as Project;
        d.assets[0].id = "../../evil";
        (d.slides[0].elements[0] as { assetId: string }).assetId = "../../evil";
        zip.file("assets/../../evil", PNG);
      }),
      /invalid file reference/,
    );
  });

  it("drops a thumbnail that is not a picture and ignores unknown extra files", async () => {
    await storeAssets();
    const { doc } = sample();
    const good = await packTemplate({ name: "x", category: "y", doc, thumbnail: null }, reader);
    const zip = await JSZip.loadAsync(await good.arrayBuffer());
    zip.file("thumbnail", "not a picture");
    zip.file("assets/stranger", PNG);
    zip.file("readme.txt", "hi");
    const back = await unpackTemplate(await zip.generateAsync({ type: "blob" }));
    expect(back.thumbnail).toBeNull();
    expect(back.assets.map((a) => a.ref.id)).toEqual(["asset-used"]);
  });

  it("names the download after the template", () => {
    expect(templateFileName("Trip recap 2026!")).toBe("Trip-recap-2026.cctemplate");
    expect(templateFileName("../..")).toBe("template.cctemplate");
    expect(templateFileName("Liburan ke Bali 🌴")).toBe("Liburan-ke-Bali.cctemplate");
  });
});

describe("user templates in storage", () => {
  const stored = async () => {
    await storeAssets();
    const { doc } = sample();
    await putStoredTemplate({ id: "t1", name: "Sample", category: MY_TEMPLATES, doc, thumbnail: null, createdAt: "2026-01-01" });
    return doc;
  };

  it("opens, saves the edited document and its details separately", async () => {
    const doc = await stored();
    const opened = await loadUserTemplate("t1");
    expect(opened).toMatchObject({ id: "t1", source: "user", category: MY_TEMPLATES });
    expect(await loadUserTemplate("nope")).toBeNull();

    await updateTemplateDetails("t1", { category: " Travel ", description: " Recap of a trip " });
    await saveTemplateDoc("t1", ops.renameProject(stripPhotos(doc), "Trip recap"), new Blob([JPG], { type: "image/jpeg" }));
    const [t] = await listStoredTemplates();
    expect(t).toMatchObject({ name: "Trip recap", category: "Travel", description: "Recap of a trip" }); // details survive a document save
    expect(t.thumbnail?.size).toBe(JPG.length);
    expect(countFrames(t.doc as Project)).toEqual({ empty: 2, filled: 0 });
    await saveTemplateDoc("t1", doc);
    expect((await listStoredTemplates())[0].thumbnail?.size).toBe(JPG.length); // a save without a cover keeps the old one
    await expect(saveTemplateDoc("deleted", doc)).rejects.toThrow(/deleted/);
  });

  it("duplicates user and built-in templates into editable copies with fresh ids", async () => {
    const doc = await stored();
    const original = (await loadUserTemplate("t1"))!;
    const copyId = await duplicateTemplate(original);
    const copy = (await loadUserTemplate(copyId))!;
    expect(copy.name).toBe("Sample copy");
    expect(copy.doc.slides[0].id).not.toBe(doc.slides[0].id);
    expect(copy.doc.slides[0].elements[0].id).not.toBe(doc.slides[0].elements[0].id);
    expect(copy.doc.assets.map((a) => a.id)).toEqual(doc.assets.map((a) => a.id)); // same stored files

    const builtin = listBuiltInTemplates()[0];
    const ownId = await duplicateTemplate(builtin);
    const own = (await loadUserTemplate(ownId))!;
    expect(own).toMatchObject({ source: "user", category: MY_TEMPLATES, name: `${builtin.name} copy` });
    expect(own.doc.slides).toHaveLength(builtin.doc.slides.length);
    expect((await listAllTemplates()).filter((t) => t.source === "user")).toHaveLength(3);
  });

  it("exports from one device and imports on another, files included", async () => {
    await stored();
    await updateTemplateDetails("t1", { category: "Travel", description: "Recap" });
    const file = await exportTemplateFile((await loadUserTemplate("t1"))!);

    await closeDb();
    await wipe(); // "another device"
    const { id, name } = await importTemplateFile(file);
    expect(name).toBe("Sample");
    const imported = (await loadUserTemplate(id))!;
    expect(imported).toMatchObject({ category: "Travel", description: "Recap", source: "user" });
    expect(countFrames(imported.doc)).toEqual({ empty: 1, filled: 1 });
    expect(new Uint8Array(await (await getAssetBlob("asset-used"))!.arrayBuffer())).toEqual(PNG);
    expect(await getAssetBlob("asset-unused")).toBeUndefined(); // not used by the template, not shipped
    const lib = await listLibrary();
    expect(lib).toHaveLength(1);
    expect(lib[0].usage.templates).toEqual(["Sample"]);

    // Importing again makes a second template but does not store the file twice.
    await importTemplateFile(file);
    expect(await listStoredTemplates()).toHaveLength(2);
    expect(await listLibrary()).toHaveLength(1);
  });

  it("keeps a file that is already on this device instead of overwriting it", async () => {
    await stored();
    const file = await exportTemplateFile((await loadUserTemplate("t1"))!);
    const local = new Uint8Array([...PNG, 42, 42]);
    await putAsset({ ...used, blob: new Blob([local], { type: "image/png" }), createdAt: "2026-01-01" });
    await importTemplateFile(file);
    expect((await getAssetBlob("asset-used"))!.size).toBe(local.length);
  });
});
