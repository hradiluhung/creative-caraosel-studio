/**
 * Phase 4: advanced features. D1 project version history, D2 asset library, D3 layouts.
 * Same setup as tests/e2e.mjs (production build on BASE_URL, CHROME_PATH, FIXTURES with photo-a.jpg).
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL || "http://localhost:3210";
const FIXTURES = process.env.FIXTURES || "/tmp/fixtures";
const SHOTS = process.env.SHOTS || "/tmp/shots";
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";

const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => m.type() === "error" && pageErrors.push(`${m.text()} @ ${m.location()?.url ?? ""}`));

const L = (label) => `[aria-label="${label}"]`;
const click = async (selector) => (await page.waitForSelector(selector, { visible: true })).click();
const clickText = async (text, tag = "button") => (await page.waitForSelector(`${tag} ::-p-text(${text})`, { visible: true })).click();
const saved = async () => {
  await sleep(150);
  await page.waitForSelector('[data-testid="save-status"][data-status="saved"]', { timeout: 15000 });
};
const projectId = () => new URL(page.url()).searchParams.get("id");
const idb = (fn, ...args) =>
  // Evaluated as a string through the DevTools protocol, which the page's Content Security Policy does not restrict.
  page.evaluate(`(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open("creative-carousel-studio"); r.onerror = () => rej(r.error); r.onsuccess = () => res(r.result); });
    try { return await (${fn.toString()})(db, ...${JSON.stringify(args)}); } finally { db.close(); }
  })()`);
const get = (db, store, key) => new Promise((res) => { const r = db.transaction(store).objectStore(store).get(key); r.onsuccess = () => res(r.result); });
const readDoc = () => idb((db, id) => new Promise((res) => { const r = db.transaction("projectDocs").objectStore("projectDocs").get(id); r.onsuccess = () => res(r.result); }), projectId());
const storedVersions = () =>
  idb((db, id) => new Promise((res) => {
    const r = db.transaction("projectVersions").objectStore("projectVersions").index("projectId").getAll(id);
    r.onsuccess = () => res(r.result.map((v) => ({ kind: v.kind, name: v.name ?? null, elements: v.doc.slides[0].elements.length, thumb: v.thumbnail?.size ?? 0, at: v.createdAt })).sort((a, b) => a.at.localeCompare(b.at)));
  }), projectId());
void get;
const rows = () => page.$$eval('[data-testid="version-row"]', (ns) => ns.map((n) => ({ kind: n.dataset.kind, text: n.querySelector("p").textContent, kept: n.textContent.includes("kept"), hasThumb: !!n.querySelector("img") })));
const elementCount = async () => (await readDoc()).slides[0].elements.length;
const until = async (probe, timeout = 6000) => {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await probe();
    if (last.done) return last;
    await sleep(80);
  }
  return last;
};

try {
  // ---------- D1: version history ----------
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await clickText("New project");
  await page.type("#np-name", "History Test");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickText("Create project")]);
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  let list;
  let stored = (await until(async () => ((v) => ({ done: v.length >= 1, v }))(await storedVersions()))).v;
  ok("opening a project saves an automatic version of that state", stored.length === 1 && stored[0].kind === "auto" && stored[0].elements === 0 && stored[0].thumb > 100, JSON.stringify(stored));

  await page.click('[data-category="text"]');
  await clickText("Add a heading");
  await saved();
  await click(L("Version history"));
  await page.waitForSelector('[data-testid="version-history"]');
  list = (await until(async () => ((r) => ({ done: r.length === 1 && r[0].hasThumb, r }))(await rows()))).r;
  ok("the history lists it with a picture", list.length === 1 && list[0].text === "Automatic version" && list[0].hasThumb, JSON.stringify(list));
  await page.type(L("Version name"), "With heading");
  await clickText("Save version");
  await page.waitForSelector('[role="status"] ::-p-text(Version saved)');
  list = await rows();
  ok("a named version is saved on top and marked as kept", list.length === 2 && list[0].text === "With heading" && list[0].kept && list[0].kind === "manual" && !list[1].kept, JSON.stringify(list));
  stored = await storedVersions();
  ok("it holds the document as it was (one element)", stored.at(-1).name === "With heading" && stored.at(-1).elements === 1);
  await clickText("Close");

  await page.click('[data-category="text"]');
  await clickText("Add a subheading").catch(() => clickText("Add a heading"));
  await saved();
  ok("editing continues after saving a version", (await elementCount()) === 2);

  // Restore the first (empty) version.
  await click(L("Version history"));
  await page.waitForSelector('[data-testid="version-row"]');
  const restoreButtons = await page.$$('[data-testid="version-row"] button ::-p-text(Restore)');
  await restoreButtons.at(-1).click();
  await page.waitForSelector('[role="status"] ::-p-text(Restored)');
  list = await rows();
  ok("restoring first saves the state it replaces", list.length === 3 && list[0].kind === "before-restore" && list[0].text === "Before restore", JSON.stringify(list));
  await clickText("Close");
  await saved();
  ok("the restored document is the old state (empty slide), same project", (await elementCount()) === 0 && (await readDoc()).name === "History Test" && (await readDoc()).id === projectId());
  stored = await storedVersions();
  ok("the replaced state (two elements) is kept as a version", stored.at(-1).kind === "before-restore" && stored.at(-1).elements === 2, JSON.stringify(stored.at(-1)));

  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await saved();
  ok("a restore is one undo step", (await elementCount()) === 2);

  // Restore the named one, rename and delete.
  await click(L("Version history"));
  await click(`[data-testid="version-row"] button[aria-label^="Restore With heading"]`);
  await page.waitForSelector('[role="status"] ::-p-text(Restored)');
  await clickText("Close");
  await saved();
  ok("restoring the named version brings back exactly that state", (await elementCount()) === 1);

  await click(L("Version history"));
  await page.waitForSelector('[data-testid="version-row"]');
  const before = (await rows()).length;
  const autoRow = (await page.$$('[data-testid="version-row"][data-kind="auto"]')).at(-1);
  await (await autoRow.$(L("Rename version"))).click();
  await page.type(L("New version name"), "Blank start");
  await page.keyboard.press("Enter");
  await until(async () => ({ done: (await rows()).some((r) => r.text === "Blank start") }));
  ok("renaming a version keeps it", (await rows()).some((r) => r.text === "Blank start" && r.kept));
  const beforeRestoreRow = await page.$('[data-testid="version-row"][data-kind="before-restore"]');
  await (await beforeRestoreRow.$(L("Delete version"))).click();
  await until(async () => ({ done: (await rows()).length === before - 1 }));
  ok("a version can be deleted", (await rows()).length === before - 1);
  await clickText("Close");

  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await sleep(800);
  await click(L("Version history"));
  await page.waitForSelector('[data-testid="version-row"]');
  list = await rows();
  ok("history survives a reload, and reopening an unchanged project adds nothing", list.length === before - 1 && list.some((r) => r.text === "With heading") && list.some((r) => r.text === "Blank start"), JSON.stringify(list.map((r) => r.text)));
  await page.screenshot({ path: `${SHOTS}/p4-01-history.png` });
  await clickText("Close");

  // Deleting the project removes its history.
  const id = projectId();
  await page.goto(BASE, { waitUntil: "networkidle0" });
  const left = await idb((db, pid) => new Promise((res) => { const r = db.transaction("projectVersions").objectStore("projectVersions").index("projectId").count(pid); r.onsuccess = () => res(r.result); }), id);
  ok("versions are stored per project in their own store", left >= 3, String(left));

  // ---------- D2: asset library ----------
  const cards = () => page.$$eval('[data-testid="asset-card"]', (ns) => ns.map((n) => ({ kind: n.dataset.kind, text: n.textContent, fav: n.parentElement.querySelector('[data-testid="card-favorite"]')?.getAttribute("aria-pressed") === "true", img: !!n.querySelector("img") })));
  const assetIds = () => idb((db) => new Promise((res) => { const r = db.transaction("assets").objectStore("assets").getAll(); r.onsuccess = () => res(r.result.map((a) => ({ id: a.id, name: a.name, favorite: a.favorite ?? false, collections: a.collections ?? [] }))); }));
  const openAssets = async () => {
    await page.goto(BASE, { waitUntil: "networkidle0" });
    await clickText("Assets");
    await page.waitForSelector('[data-testid="storage-overview"]');
  };
  const newProject = async (name) => {
    await page.goto(BASE, { waitUntil: "networkidle0" });
    await clickText("New project");
    await page.type("#np-name", name);
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickText("Create project")]);
    await page.waitForSelector('[data-testid="canvas-host"] canvas');
  };

  await newProject("Lib A");
  await (await page.$('[data-testid="image-input"]')).uploadFile(`${FIXTURES}/photo-a.jpg`);
  await until(async () => ({ done: (await elementCount()) === 1 }));
  await saved();
  await openAssets();
  let grid = (await until(async () => ((c) => ({ done: c.length === 1 && c[0].img, c }))(await cards()))).c;
  ok("a photo imported in a project shows up in the Assets tab", grid.length === 1 && grid[0].kind === "image" && grid[0].text.includes("photo-a.jpg") && !grid[0].text.includes("unused"), JSON.stringify(grid));
  ok("the storage overview counts it", (await page.$eval('[data-testid="storage-overview"]', (n) => n.textContent)).includes("1 file,"));

  await click('[data-testid="asset-card"]');
  await page.waitForSelector('[data-testid="asset-usage"]');
  ok("the details say where the file is used", (await page.$eval('[data-testid="asset-usage"]', (n) => n.textContent)).includes("Project: Lib A"));
  await clickText("Add to favorites");
  await page.type("#asset-collections", "Trip, trip , Clients");
  await clickText("Save");
  grid = (await until(async () => ((c) => ({ done: c[0]?.fav, c }))(await cards()))).c;
  let storedAssets = await assetIds();
  ok("favorite and collections are stored with the asset", grid[0].fav && storedAssets[0].favorite === true && JSON.stringify(storedAssets[0].collections) === '["Trip","Clients"]', JSON.stringify(storedAssets));

  // Removing a favorite: from the details (applies at once, no Save) and from the star on the card.
  await click('[data-testid="asset-card"]');
  await page.waitForSelector('[data-testid="favorite-toggle"]');
  ok("the details name the action that removes a favorite", (await page.$eval('[data-testid="favorite-toggle"]', (n) => n.textContent.trim())) === "Remove from favorites");
  await click('[data-testid="favorite-toggle"]');
  await until(async () => ({ done: (await assetIds())[0].favorite === false }));
  await clickText("Close");
  grid = (await until(async () => ((c) => ({ done: c[0] && !c[0].fav, c }))(await cards()))).c;
  ok("a favorite can be removed from the details without pressing Save", (await assetIds())[0].favorite === false && !grid[0].fav && JSON.stringify((await assetIds())[0].collections) === '["Trip","Clients"]');
  await click('[data-testid="card-favorite"]');
  await until(async () => ({ done: (await assetIds())[0].favorite === true && (await cards())[0].fav }));
  await click('[data-testid="card-favorite"]');
  await until(async () => ({ done: (await assetIds())[0].favorite === false && !(await cards())[0].fav }));
  ok("the star on a card removes the favorite with one click", (await assetIds())[0].favorite === false && !(await page.$('[role="dialog"]')));
  await click('[data-testid="card-favorite"]');
  await until(async () => ({ done: (await cards())[0].fav }));
  ok("and adds it back", (await assetIds())[0].favorite === true);

  await (await page.$('[data-testid="library-input"]')).uploadFile(`${FIXTURES}/photo-b.png`);
  grid = (await until(async () => ((c) => ({ done: c.length === 2, c }))(await cards()))).c;
  ok("files can be added straight to the library, marked unused", grid.length === 2 && grid.some((c) => c.text.includes("photo-b.png") && c.text.includes("unused")), JSON.stringify(grid.map((c) => c.text)));
  await clickText("Favorites");
  ok("the favorites filter keeps only favorites", (await cards()).length === 1 && (await cards())[0].text.includes("photo-a.jpg"));
  await clickText("Favorites");
  await clickText("Unused");
  ok("the unused filter keeps only files nothing references", (await cards()).length === 1 && (await cards())[0].text.includes("photo-b.png"));
  await clickText("Unused");
  await page.select('select[aria-label="Collection"]', "Clients");
  ok("the collection filter works", (await cards()).length === 1 && (await cards())[0].text.includes("photo-a.jpg"));
  await page.select('select[aria-label="Collection"]', "");
  await page.type(L("Search assets"), "photo-b");
  ok("search matches the file name", (await cards()).length === 1 && (await cards())[0].text.includes("photo-b.png"));
  await page.type(L("Search assets"), "zzz");
  ok("no match is said plainly", (await cards()).length === 0 && (await page.$eval("main", (n) => n.textContent)).includes("No file matches these filters."));
  await page.screenshot({ path: `${SHOTS}/p4-02-assets.png` });

  // Reuse in another project.
  await newProject("Lib B");
  await page.click('[data-category="images"]');
  await clickText("From library");
  await page.waitForSelector('[data-testid="library-pick"]');
  ok("the editor picker offers stored photos from other projects", (await page.$$('[data-testid="library-pick"]')).length === 2);
  await page.screenshot({ path: `${SHOTS}/p4-03-picker.png` });
  await click(`[data-testid="library-pick"][aria-label^="Add photo-a.jpg"]`);
  await until(async () => ({ done: (await elementCount()) === 1 }));
  await saved();
  const libDoc = await readDoc();
  const aId = storedAssets.find((a) => a.name === "photo-a.jpg").id;
  ok("picking one places it and references the same stored file (no copy)", libDoc.assets.length === 1 && libDoc.assets[0].id === aId && libDoc.slides[0].elements[0].assetId === aId && (await assetIds()).length === 2, JSON.stringify(libDoc.assets));
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await saved();
  ok("adding from the library is one undo step", (await elementCount()) === 0);
  await page.keyboard.down("Control");
  await page.keyboard.press("y");
  await page.keyboard.up("Control");
  await saved();

  // Delete with a usage warning.
  await openAssets();
  await until(async () => ({ done: (await cards()).length === 2 }));
  await click('[data-testid="asset-card"] ::-p-text(photo-a.jpg)');
  await page.waitForSelector('[data-testid="asset-usage"]');
  const usageText = await page.$eval('[data-testid="asset-usage"]', (n) => n.textContent);
  ok("usage lists both projects", usageText.includes("Project: Lib A") && usageText.includes("Project: Lib B"), usageText);
  await clickText("Delete");
  const warning = await page.$eval('[role="dialog"] [role="alert"]', (n) => n.textContent);
  ok("deleting a used file warns first with where it is used", warning.includes("still used in 2 projects") && (await assetIds()).length === 2, warning);
  await click('[data-testid="confirm-delete-asset"]');
  await until(async () => ({ done: (await cards()).length === 1 }));
  storedAssets = await assetIds();
  ok("after confirming, the file is gone from storage", storedAssets.length === 1 && storedAssets[0].name === "photo-b.png");

  // Bulk select (D2b).
  await (await page.$('[data-testid="library-input"]')).uploadFile(`${FIXTURES}/color.png`);
  await until(async () => ({ done: (await cards()).length === 2 }));
  await clickText("Select");
  await click('[data-testid="asset-card"]');
  ok("in select mode a click selects instead of opening the details", (await page.$eval('[data-testid="bulk-count"]', (n) => n.textContent)) === "1 selected" && !(await page.$('[role="dialog"]')));
  await clickText("Select all shown (2)");
  ok("select all takes every file that is shown", (await page.$eval('[data-testid="bulk-count"]', (n) => n.textContent)) === "2 selected");
  await click('[data-testid="bulk-bar"] button ::-p-text(Favorite)');
  await until(async () => ({ done: (await assetIds()).every((a) => a.favorite) }));
  await click('[data-testid="bulk-bar"] button ::-p-text(Unfavorite)');
  await until(async () => ({ done: (await assetIds()).every((a) => !a.favorite) }));
  ok("bulk Unfavorite clears the favorite on all selected files", (await assetIds()).every((a) => a.favorite === false));
  await click('[data-testid="bulk-bar"] button ::-p-text(Favorite)');
  await until(async () => ({ done: (await assetIds()).every((a) => a.favorite) }));
  await page.type(L("Collection to add to"), "Bulk set");
  await clickText("Add to collection");
  await until(async () => ({ done: (await assetIds()).every((a) => a.collections.includes("Bulk set")) }));
  storedAssets = await assetIds();
  ok("favorite and collection are applied to all selected files", storedAssets.length === 2 && storedAssets.every((a) => a.favorite && a.collections.includes("Bulk set")), JSON.stringify(storedAssets));
  ok("the selection survives the change", (await page.$eval('[data-testid="bulk-count"]', (n) => n.textContent)) === "2 selected");
  await page.evaluate(() => [...document.querySelectorAll('[data-testid="bulk-bar"] button')].find((b) => b.textContent.trim() === "Delete").click());
  await page.waitForSelector('[data-testid="bulk-delete-summary"]');
  const bulkText = await page.$eval('[role="dialog"]', (n) => n.textContent);
  ok("bulk delete asks once and says the files are unused", bulkText.includes("Delete 2 files?") && bulkText.includes("None of them is used") && (await assetIds()).length === 2, bulkText);
  await page.screenshot({ path: `${SHOTS}/p4-03b-bulk.png` });
  await click('[data-testid="confirm-bulk-delete"]');
  await until(async () => ({ done: (await assetIds()).length === 0 && (await cards()).length === 0 && !(await page.$('[data-testid="bulk-count"]')) }));
  ok("after confirming, all selected files are gone and select mode ends", (await cards()).length === 0 && !(await page.$('[data-testid="bulk-count"]')));

  // ---------- D3: advanced layouts ----------
  const boxesOf = async () => (await readDoc()).slides[0].elements.map((e) => ({ type: e.type, assetId: e.assetId, x: e.x, y: e.y, w: e.width, h: e.height, r: e.rotation }));
  const hint = () => page.$eval('[data-testid="layout-hint"]', (n) => n.textContent);
  await newProject("Layouts");
  ok("all seven layouts are offered", (await page.$$('[data-testid="layout-options"] button')).length === 7 && (await hint()).startsWith("Adds empty photo frames"));
  await page.click('[data-category="layouts"]');
  await click('[data-layout="grid"]');
  await until(async () => ({ done: (await elementCount()) === 4 }));
  await saved();
  let frames = await boxesOf();
  const within = (b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= 1080 && b.y + b.h <= 1350;
  ok("a layout adds that many empty photo frames inside the slide", frames.length === 4 && frames.every((b) => b.type === "image" && b.assetId === null && within(b)), JSON.stringify(frames));
  ok("grid frames keep the chosen gap", frames[1].x - (frames[0].x + frames[0].w) === 16 && frames[2].y - (frames[0].y + frames[0].h) === 16);
  await page.screenshot({ path: `${SHOTS}/p4-04-layout-grid.png` });
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await saved();
  ok("adding a layout is one undo step", (await elementCount()) === 0);

  await (await page.$('[data-testid="image-input"]')).uploadFile(`${FIXTURES}/photo-a.jpg`, `${FIXTURES}/photo-b.png`, `${FIXTURES}/color.png`);
  await until(async () => ({ done: (await elementCount()) === 3 }));
  await saved();
  const beforeArrange = await boxesOf();
  ok("with photos selected the section offers to rearrange them", (await hint()) === "Rearranges the 3 selected photos on this slide.", await hint());
  await page.click('[data-category="layouts"]');
  await click('[data-layout="magazine"]');
  await until(async () => ({ done: JSON.stringify(await boxesOf()) !== JSON.stringify(beforeArrange) }));
  await saved();
  frames = await boxesOf();
  const sortedFrames = [...frames].sort((a, b) => a.y - b.y || a.x - b.x);
  ok("rearranging keeps the same photos and adds nothing", frames.length === 3 && frames.map((f) => f.assetId).join() === beforeArrange.map((f) => f.assetId).join() && frames.every((f) => f.assetId));
  ok("magazine: a full-width hero with the others in a row below", sortedFrames[0].w === 950 && sortedFrames[1].y === sortedFrames[2].y && sortedFrames[1].y > sortedFrames[0].y + sortedFrames[0].h && sortedFrames.every(within), JSON.stringify(sortedFrames));
  await page.screenshot({ path: `${SHOTS}/p4-05-layout-magazine.png` });
  await page.click('[data-category="layouts"]');
  await click('[data-layout="scrapbook"]');
  await until(async () => ({ done: (await boxesOf()).some((b) => b.r !== 0) }));
  await saved();
  ok("scrapbook tilts the frames", (await boxesOf()).some((b) => b.r !== 0) && (await elementCount()) === 3);
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await saved();
  ok("rearranging is one undo step", JSON.stringify(await boxesOf()) === JSON.stringify(frames));

  ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (e) {
  console.error("ABORTED:", e.message?.split("\n")[0]);
  await page.screenshot({ path: `${SHOTS}/p4-failure.png` }).catch(() => {});
  results.push({ name: "run completed", pass: false });
  if (pageErrors.length) console.error("page errors:", pageErrors.slice(0, 5));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
