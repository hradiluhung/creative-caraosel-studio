/**
 * Phase 4, D5: image tools (free crop, rotate in frame, frame shapes, duotone, colour overlay)
 * and D4: template creator. Same setup as tests/e2e.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL || "http://localhost:3210";
const FIXTURES = process.env.FIXTURES || "/tmp/fixtures";
const SHOTS = process.env.SHOTS || "/tmp/shots";
const DL = process.env.DOWNLOADS || "/tmp/dl4";
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";

const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(DL, { recursive: true });
for (const f of fs.readdirSync(DL)) fs.rmSync(path.join(DL, f));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => m.type() === "error" && pageErrors.push(`${m.text()} @ ${m.location()?.url ?? ""}`));
const cdp = await page.createCDPSession();
await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL });

const L = (label) => `[aria-label="${label}"]`;
const click = async (selector) => (await page.waitForSelector(selector, { visible: true })).click();
const clickText = async (text, tag = "button") => (await page.waitForSelector(`${tag} ::-p-text(${text})`, { visible: true })).click();
const saved = async () => {
  await sleep(150);
  await page.waitForSelector('[data-testid="save-status"][data-status="saved"]', { timeout: 15000 });
};
const setField = async (label, value) => {
  const f = await page.waitForSelector(L(label), { visible: true });
  await f.click();
  await f.type(String(value));
  await page.keyboard.press("Enter");
};
const idb = (fn, ...args) =>
  // Evaluated as a string through the DevTools protocol, which the page's Content Security Policy does not restrict.
  page.evaluate(`(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open("creative-carousel-studio"); r.onerror = () => rej(r.error); r.onsuccess = () => res(r.result); });
    try { return await (${fn.toString()})(db, ...${JSON.stringify(args)}); } finally { db.close(); }
  })()`);
const projectId = () => new URL(page.url()).searchParams.get("id");
const readDoc = (id) =>
  page.evaluate(
    (pid) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("creative-carousel-studio");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const get = req.result.transaction("projectDocs").objectStore("projectDocs").get(pid);
          get.onsuccess = () => (req.result.close(), resolve(get.result));
        };
      }),
    id,
  );
const active = async () => {
  const doc = await readDoc(projectId());
  return doc.mode === "seamless" ? doc.panorama : doc.slides[0];
};
const exportPng = async (name) => {
  await clickText("Export");
  await clickText("PNG");
  await clickText("Current");
  await clickText("Export 1 slide");
  await page.waitForSelector('[data-testid="export-done"]', { timeout: 60000 });
  const file = path.join(DL, name);
  for (let i = 0; i < 100 && !fs.existsSync(file); i++) await sleep(150);
  const buf = fs.readFileSync(file);
  fs.rmSync(file);
  await clickText("Continue editing");
  await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext("2d").drawImage(bmp, 0, 0);
    globalThis.__img = c;
  }, buf.toString("base64"));
  return buf;
};
const pixel = (x, y) => page.evaluate((px, py) => Array.from(globalThis.__img.getContext("2d").getImageData(px, py, 1, 1).data), Math.round(x), Math.round(y));
const near = (a, b, tol = 8) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const newProject = async (name) => {
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await clickText("New project");
  await page.type("#np-name", name);
  await setField("Number of slides", 1);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickText("Create project")]);
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
};

try {
  // ---------- D5: image tools ----------
  await newProject("Image Tools");
  await (await page.$('[data-testid="image-input"]')).uploadFile(`${FIXTURES}/color.png`); // 800x600, left half red, right half blue
  await saved();
  await setField("X position", 140);
  await setField("Y position", 275);
  await setField("Width", 800);
  await setField("Height", 800);
  await saved();
  const image = async () => (await active()).elements[0];
  const isRed = (p) => p[0] > 180 && p[2] < 90;
  const isBlue = (p) => p[2] > 180 && p[0] < 90;
  const slide = async (label, key) => {
    await page.focus(L(label));
    await page.keyboard.press(key);
    await sleep(120);
    await saved();
  };
  const FILE = "image-tools-01.png";

  await exportPng(FILE);
  ok("centre crop by default: red left, blue right", isRed(await pixel(340, 675)) && isBlue(await pixel(640, 675)) && (await image()).crop === undefined);

  await slide("Move left / right", "Home");
  let el = await image();
  ok("panning is stored on the element, the photo itself is untouched", el.crop?.x === -1 && el.crop.zoom === 1 && el.width === 800 && el.assetId, JSON.stringify(el.crop));
  await exportPng(FILE);
  ok("panned to the left end: the red half now reaches past the middle", isRed(await pixel(640, 675)) && isBlue(await pixel(800, 675)), `${await pixel(640, 675)}`);

  await slide("Zoom", "End");
  el = await image();
  await exportPng(FILE);
  ok("zoomed in at the left end: only red is left in the frame", el.crop.zoom === 5 && isRed(await pixel(160, 300)) && isRed(await pixel(920, 1050)), `${await pixel(920, 1050)}`);

  await clickText("Reset crop");
  await saved();
  await exportPng(FILE);
  ok("reset crop returns to the centre crop", (await image()).crop === undefined && isBlue(await pixel(640, 675)));

  await clickText("Rotate photo 90°");
  await saved();
  el = await image();
  await exportPng(FILE);
  ok("rotating inside the frame turns the photo, not the frame", el.crop.turns === 1 && el.rotation === 0 && el.width === 800 && isRed(await pixel(540, 475)) && isRed(await pixel(300, 475)) && isBlue(await pixel(540, 875)), `${await pixel(540, 475)} | ${await pixel(540, 875)}`);
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await saved();
  ok("rotating the photo is one undo step", (await image()).crop === undefined);

  await click(L("Frame shape 16:9"));
  await saved();
  el = await image();
  ok("a frame shape preset keeps width and centre", el.width === 800 && el.height === 450 && el.y === 450 && el.x === 140, JSON.stringify([el.x, el.y, el.width, el.height]));
  await click(L("Frame shape As photo"));
  await saved();
  el = await image();
  ok("'As photo' matches the photo's own shape", el.width === 800 && el.height === 600);
  await click(L("Frame shape 1:1"));
  await saved();

  // Duotone: preview and export agree, and match the expected ramp.
  await page.evaluate(() => [...document.querySelectorAll("label")].find((l) => l.textContent.trim() === "Duotone").querySelector("input").click());
  await saved();
  el = await image();
  ok("duotone is stored as editable settings", el.duotone?.amount === 100 && el.duotone.shadow === "#1b1f5e" && el.adjustments.grayscale === 0);
  await sleep(500);
  const shot = await page.screenshot({ encoding: "base64" });
  const host = await (await page.$('[data-testid="canvas-host"]')).boundingBox();
  const fit = Math.min((host.width - 112) / 1080, (host.height - 112) / 1350);
  const live = await page.evaluate(
    async (b64, x, y) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext("2d").drawImage(bmp, 0, 0);
      return Array.from(c.getContext("2d").getImageData(Math.round(x), Math.round(y), 1, 1).data);
    },
    shot,
    host.x + (host.width - 1080 * fit) / 2 + 340 * fit,
    host.y + (host.height - 1350 * fit) / 2 + 675 * fit,
  );
  await exportPng(FILE);
  const duoRed = await pixel(340, 675);
  const duoBlue = await pixel(740, 675);
  ok("duotone export: red and blue land on the two-colour ramp by brightness", near(duoRed, [75, 70, 110, 255], 6) && near(duoBlue, [43, 44, 99, 255], 6), `${duoRed} | ${duoBlue}`);
  ok("duotone preview matches the export", near(live.slice(0, 3), duoRed.slice(0, 3), 6), `${live} vs ${duoRed}`);
  await page.screenshot({ path: `${SHOTS}/p4-06-duotone.png` });
  await slide("Duotone strength", "Home");
  await exportPng(FILE);
  ok("duotone strength 0 shows the original colours", isRed(await pixel(340, 675)) && isBlue(await pixel(740, 675)));
  await page.evaluate(() => [...document.querySelectorAll("label")].find((l) => l.textContent.trim() === "Duotone").querySelector("input").click());
  await saved();

  await page.evaluate(() => [...document.querySelectorAll("label")].find((l) => l.textContent.trim() === "Color overlay").querySelector("input").click());
  await saved();
  el = await image();
  await exportPng(FILE);
  const overBlue = await pixel(740, 675);
  ok("colour overlay blends its colour by opacity", el.duotone === undefined && el.overlay?.opacity === 35 && near(overBlue, [80, 20, 214, 255], 6), `${overBlue}`);
  ok("outside the frame nothing is tinted", near(await pixel(60, 60), [255, 255, 255, 255], 2));
  await page.evaluate(() => [...document.querySelectorAll("label")].find((l) => l.textContent.trim() === "Color overlay").querySelector("input").click());
  await saved();

  await clickText("Turn into empty frame");
  await saved();
  el = await image();
  ok("a photo can be turned into an empty frame that keeps its box", el.assetId === null && el.width === 800 && el.height === 800 && el.type === "image");
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await saved();
  ok("and undo brings the photo back", (await image()).assetId !== null);

  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  ok("the project reopens after these edits", (await image()).width === 800);

  // ---------- D4: template creator ----------
  const templates = () => idb((db) => new Promise((res) => { const r = db.transaction("templates").objectStore("templates").getAll(); r.onsuccess = () => res(r.result.map((t) => ({ id: t.id, name: t.name, category: t.category, description: t.description ?? "", thumb: t.thumbnail?.size ?? 0, slides: t.doc.slides.length, images: t.doc.slides[0].elements.filter((e) => e.type === "image").map((e) => e.assetId), assets: t.doc.assets.length }))); }));
  const cards = () => page.$$eval('[data-testid="template-card"]', (ns) => ns.map((n) => ({ source: n.dataset.source, name: n.querySelector("h3").textContent, meta: n.querySelector("p").textContent })));
  const openTemplates = async () => {
    await page.goto(`${BASE}/?tab=templates`, { waitUntil: "networkidle0" });
    await page.waitForSelector(L("Category"));
  };
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await click(L("Actions for Image Tools"));
  await clickText("Save as template");
  await page.waitForSelector('[role="status"] ::-p-text(saved to Templates)');
  let stored = await templates();
  const tplId = stored[0].id;
  ok("a project is saved as a template with its photo", stored.length === 1 && stored[0].images.length === 1 && stored[0].images[0] !== null);

  await openTemplates();
  ok("the dashboard link opens the Templates tab directly", (await cards()).length > 1);
  await click(L("Preview template Image Tools"));
  await clickText("Edit template");
  await page.waitForNavigation({ waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  ok("a user template opens in the editor in template mode", page.url().includes(`template=${tplId}`) && !!(await page.$('[data-testid="template-badge"]')) && !(await page.$(L("Version history"))));

  // Rename through the top bar, edit the content, set details.
  await page.focus(L("Template name"));
  await page.$eval(L("Template name"), (n) => n.select());
  await page.keyboard.type("Trip recap");
  await page.keyboard.press("Enter");
  await page.click('[data-category="text"]');
  await clickText("Add a heading");
  await saved();
  await click(L("Template settings"));
  await page.waitForSelector('[data-testid="template-frames"]');
  ok("template settings count the photo frames", (await page.$eval('[data-testid="template-frames"]', (n) => n.textContent)).startsWith("0 empty frames waiting for photos, 1 frame with a photo"));
  await page.select(L("Template category"), "Travel");
  await page.type("#template-description", "Recap of a trip in a few slides");
  await clickText("Turn all photos into empty frames");
  await page.waitForFunction(() => document.querySelector('[data-testid="template-frames"]').textContent.startsWith("1 empty frame "));
  await clickText("Save details");
  await saved();
  stored = await templates();
  ok("edits are saved to the template itself: name, content, category, description", stored.length === 1 && stored[0].name === "Trip recap" && stored[0].category === "Travel" && stored[0].description === "Recap of a trip in a few slides", JSON.stringify(stored[0]));
  ok("the photo became an empty frame and its file is no longer referenced", stored[0].images.length === 1 && stored[0].images[0] === null && stored[0].assets === 0);
  ok("the template got a fresh cover", stored[0].thumb > 0);
  const projectCount = () => idb((db) => new Promise((res) => { const r = db.transaction("projectMeta").objectStore("projectMeta").getAll(); r.onsuccess = () => res(r.result.length); }));
  const projectsBefore = await projectCount();
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await saved();
  stored = await templates();
  ok("emptying the frames is one undo step", stored[0].images[0] !== null && stored[0].assets === 1);
  ok("editing a template never creates a project", projectsBefore === 1 && (await projectCount()) === 1);
  await page.screenshot({ path: `${SHOTS}/p4-07-template-mode.png` });

  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="template-badge"]');
  ok("the template reopens with its saved name", (await page.$eval(L("Template name"), (n) => n.value)) === "Trip recap");

  // Library: category filter, search by description, duplicate, export, import.
  await click(L("Back to templates"));
  await page.waitForSelector(L("Category"));
  await page.select(L("Category"), "Travel");
  let list = await cards();
  ok("the template is filed under its new category", list.some((c) => c.source === "user" && c.name === "Trip recap"), JSON.stringify(list));
  await page.select(L("Category"), "");
  await page.type(L("Search templates"), "recap of a trip");
  list = await cards();
  ok("search finds a template by its description", list.length === 1 && list[0].name === "Trip recap");
  await click(L("Preview template Trip recap"));
  await page.waitForSelector('[role="group"][aria-label="Template actions"]');
  ok("the preview shows the description", (await page.$eval('[role="dialog"]', (n) => n.textContent)).includes("Recap of a trip in a few slides"));
  await clickText("Export file");
  const exported = path.join(DL, "Trip-recap.cctemplate");
  for (let i = 0; i < 100 && !fs.existsSync(exported); i++) await sleep(150);
  ok("a template is exported as one file", fs.existsSync(exported) && fs.statSync(exported).size > 1000, exported);
  await clickText("Duplicate");
  await page.waitForSelector('[data-testid="template-notice"]');
  stored = await templates();
  ok("duplicating makes a second editable template", stored.length === 2 && stored.some((t) => t.name === "Trip recap copy"));

  await (await page.$('[data-testid="template-file-input"]')).uploadFile(exported);
  await page.waitForFunction(() => document.querySelector('[data-testid="template-notice"]')?.textContent.includes("was imported"));
  stored = await templates();
  const imported = stored.filter((t) => t.name === "Trip recap");
  ok("the exported file imports as a new template with the same content", stored.length === 3 && imported.length === 2 && imported.every((t) => t.category === "Travel" && t.images[0] !== null && t.assets === 1), JSON.stringify(imported));

  const bogus = path.join(DL, "bogus.cctemplate");
  fs.writeFileSync(bogus, "this is not a template");
  await (await page.$('[data-testid="template-file-input"]')).uploadFile(bogus);
  await page.waitForSelector('[data-testid="template-notice"][role="alert"]');
  ok("a file that is not a template is refused with a clear message", (await page.$eval('[data-testid="template-notice"]', (n) => n.textContent)) === "This is not a template file." && (await templates()).length === 3);

  // A built-in template becomes an own, editable one.
  await page.evaluate(() => (document.querySelector('[aria-label="Search templates"]').value = ""));
  await openTemplates();
  const firstBuiltIn = (await cards()).find((c) => c.source === "builtin").name;
  await click(L(`Preview template ${firstBuiltIn}`));
  await clickText("Make my own copy");
  await page.waitForSelector('[data-testid="template-notice"]');
  stored = await templates();
  ok("a built-in template can be copied into My templates", stored.length === 4 && stored.some((t) => t.name === `${firstBuiltIn} copy` && t.category === "My templates"));

  // Use the edited template: the project is independent of it.
  await click(L("Preview template Trip recap copy"));
  await clickText("Use this template");
  await page.waitForNavigation({ waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  const made = await active();
  ok("a project made from the template has its content and is a normal project", page.url().includes("id=") && !(await page.$('[data-testid="template-badge"]')) && made.elements.some((e) => e.type === "text") && made.elements.some((e) => e.type === "image"));

  ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (e) {
  console.error("ABORTED:", e.message?.split("\n")[0]);
  await page.screenshot({ path: `${SHOTS}/failure.png` }).catch(() => {});
  results.push({ name: "run completed", pass: false });
  if (pageErrors.length) console.error("page errors:", pageErrors.slice(0, 5));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
