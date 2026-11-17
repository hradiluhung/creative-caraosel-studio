/**
 * Phase 2 workflow check (fonts, gradients, filters, masks, stickers, templates, brand kits).
 * Same setup as tests/e2e.mjs. Extra fixtures: TestBrand-Bold.ttf (any real TTF),
 * Broken-Regular.ttf (random bytes) and color.png (left half red, right half blue).
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL || "http://localhost:3210";
const FIXTURES = process.env.FIXTURES || "/tmp/fixtures";
const SHOTS = process.env.SHOTS || "/tmp/shots";
const DL = process.env.DOWNLOADS || "/tmp/dl2";
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
  // ---------- Gradient background ----------
  await newProject("Phase Two");
  await clickText("Linear");
  await click(L("Gradient #0f2027 to #203a43 to #2c5364"));
  await saved();
  let slide = await active();
  ok("linear gradient stored with three stops", slide.background.type === "linear" && slide.background.stops.length === 3);
  await exportPng("phase-two-01.png");
  const top = await pixel(540, 3);
  const bottom = await pixel(540, 1346);
  ok("exported gradient runs top to bottom between the chosen colors", near(top, [0x0f, 0x20, 0x27, 255], 6) && near(bottom, [0x2c, 0x53, 0x64, 255], 6), `${top} → ${bottom}`);

  // ---------- Image: mask, border, filter ----------
  await clickText("Solid");
  await (await page.$('[data-testid="image-input"]')).uploadFile(`${FIXTURES}/color.png`);
  await saved();
  await setField("X position", 140);
  await setField("Y position", 275);
  await setField("Width", 800);
  await setField("Height", 800);
  await saved();
  await exportPng("phase-two-01.png");
  const redSide = await pixel(340, 675);
  const blueSide = await pixel(740, 675);
  ok("photo renders with its real colors", redSide[0] > 180 && redSide[2] < 90 && blueSide[2] > 180 && blueSide[0] < 90, `${redSide} | ${blueSide}`);
  await clickText("Black & white");
  await page.select(L("Mask shape"), "ellipse");
  await saved();
  slide = await active();
  let img = slide.elements[0];
  ok("filter is stored as editable adjustments, not baked pixels", img.filter === "Black & white" && img.adjustments.grayscale === 100 && img.mask === "ellipse");
  await exportPng("phase-two-01.png");
  const gray = await pixel(340, 675);
  const corner = await pixel(150, 285);
  const bg = slide.background.color;
  ok("black & white filter reaches the export", Math.abs(gray[0] - gray[1]) <= 2 && Math.abs(gray[1] - gray[2]) <= 2 && gray[0] > 20, `${gray}`);
  ok("ellipse mask cuts the corners of the frame", near(corner, [parseInt(bg.slice(1, 3), 16), parseInt(bg.slice(3, 5), 16), parseInt(bg.slice(5, 7), 16), 255], 3), `${corner}`);
  await clickText("Original");
  await saved();
  ok("Original restores neutral adjustments", (await active()).elements[0].adjustments.grayscale === 0);
  await clickText("Adjust manually");
  await page.screenshot({ path: `${SHOTS}/p2-image-panel.png` });

  // ---------- Adjustment slider: quick preview now, sharp result from a Web Worker ----------
  await page.select(L("Mask shape"), "rect");
  await (await page.waitForSelector(`input[type="range"]${L("Saturation")}`)).focus();
  for (let i = 0; i < 100; i++) await page.keyboard.press("ArrowLeft");
  await saved();
  ok("slider value is stored", (await active()).elements[0].adjustments.saturation === -100);
  await sleep(1200);
  ok("full-resolution pass ran in a dedicated worker", page.workers().length >= 1);
  // The editor canvas must end up showing the worker result (gray), not the original colors.
  const shot = await page.screenshot({ encoding: "base64" });
  const host = await (await page.$('[data-testid="canvas-host"]')).boundingBox();
  const fitScale = Math.min((host.width - 112) / 1080, (host.height - 112) / 1350);
  const sx = host.x + (host.width - 1080 * fitScale) / 2 + 340 * fitScale;
  const sy = host.y + (host.height - 1350 * fitScale) / 2 + 675 * fitScale;
  const live = await page.evaluate(
    async (b64, x, y) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext("2d").drawImage(bmp, 0, 0);
      return Array.from(c.getContext("2d").getImageData(Math.round(x), Math.round(y), 1, 1).data);
    },
    shot,
    sx,
    sy,
  );
  ok("editor preview shows the desaturated photo", Math.abs(live[0] - live[1]) <= 3 && Math.abs(live[1] - live[2]) <= 3, `${live}`);
  await exportPng("phase-two-01.png");
  const exported = await pixel(340, 675);
  ok("export matches the adjusted preview", Math.abs(exported[0] - live[0]) <= 4 && Math.abs(exported[0] - exported[2]) <= 2, `${exported} vs ${live}`);
  await clickText("Original");
  await saved();

  // ---------- Stickers, overlays, text effects ----------
  await page.click('[data-category="stickers"]');
  await click(L("Add sticker Sparkle"));
  await page.click('[data-category="overlays"]');
  await click(L("Add overlay Film grain"));
  await page.click('[data-category="text"]');
  await clickText("Add a heading");
  await click('[aria-label="Letter case"] [aria-label="Uppercase"]');
  await clickText("Outline", "label");
  await clickText("Drop shadow", "label");
  await saved();
  slide = await active();
  const types = slide.elements.map((e) => e.type).join();
  const text = slide.elements.at(-1);
  ok("sticker, overlay and text were added", types === "image,sticker,overlay,text", types);
  ok("overlay starts locked so it does not block the canvas", slide.elements[2].locked === true && slide.elements[2].blendMode === "overlay");
  ok("text effects are stored", text.transform === "uppercase" && text.strokeWidth > 0 && text.shadow && text.text === "Add a heading");

  // ---------- Custom font upload ----------
  await click(L("Font family"));
  const fontInput = await page.waitForSelector('[data-testid="font-input"]');
  await fontInput.uploadFile(`${FIXTURES}/TestBrand-Bold.ttf`, `${FIXTURES}/Broken-Regular.ttf`);
  await page.waitForSelector('[role="alert"] ::-p-text(Broken-Regular.ttf)');
  ok("corrupted font file is rejected with a message", true);
  await page.screenshot({ path: `${SHOTS}/p2-font-picker.png` });
  await click(L("Use Test Brand"));
  await saved();
  ok("uploaded font is applied to the text", (await active()).elements.at(-1).fontFamily === "Test Brand");
  ok("uploaded font is usable by the canvas", await page.evaluate(() => document.fonts.check('700 40px "Test Brand"')));
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await sleep(600);
  ok("uploaded font is still registered after restarting the app", await page.evaluate(() => document.fonts.check('700 40px "Test Brand"')));
  await sleep(500);
  await page.screenshot({ path: `${SHOTS}/p2-editor.png` });

  // ---------- Brand kit ----------
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await clickText("Brand kits");
  await clickText("New brand kit");
  await page.type("#bk-name", "Kala");
  await setField("Brand color 1 hex", "#C8553D");
  await page.select(L("Heading font"), "Test Brand");
  await (await page.$('[data-testid="logo-input"]')).uploadFile(`${FIXTURES}/color.png`);
  await page.waitForSelector(L("Remove logo color.png"));
  await clickText("Save brand kit");
  await page.waitForSelector(L("Edit brand kit Kala"));
  ok("brand kit saved with a custom font and a logo", true);

  // ---------- Templates ----------
  await clickText("Templates");
  await page.waitForSelector(L("Preview template Quiet Minimal"));
  await page.waitForSelector('article img[src^="blob:"]', { timeout: 30000 });
  await sleep(2500);
  await page.screenshot({ path: `${SHOTS}/p2-templates.png` });
  ok("template library lists at least 10 templates", (await page.$$('section[aria-label="Templates"] article')).length >= 10);
  await page.select(L("Category"), "Travel");
  ok("category filter narrows the list", (await page.$$('section[aria-label="Templates"] article')).length === 1);
  await page.select(L("Category"), "Photo Journal");
  ok("the Photo Journal category has 8 templates", (await page.$$('section[aria-label="Templates"] article')).length === 8);
  await page.select(L("Category"), "");
  await click(L("Preview template Quiet Minimal"));
  await page.waitForSelector('[aria-label="Slides in this template"] img', { timeout: 30000 });
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickText("Use this template")]);
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  let doc = await readDoc(projectId());
  ok("template becomes a normal editable project", doc.slides.length === 5 && doc.slides[0].elements.filter((e) => e.type === "text").length === 4);

  // edit template text and fill a photo placeholder
  await click('ol[aria-label="Slides"] > li:nth-child(2) button');
  await sleep(300);
  await page.click('ul[aria-label="Layers"] li:last-child'); // bottom layer = photo frame
  await page.waitForSelector("button ::-p-text(Choose photo)");
  await (await page.$('[data-testid="replace-input"]')).uploadFile(`${FIXTURES}/photo-a.jpg`);
  await page.waitForSelector("button ::-p-text(Replace photo)");
  await saved();
  doc = await readDoc(projectId());
  ok("photo placeholder was filled and keeps its frame", !!doc.slides[1].elements[0].assetId && doc.slides[1].elements[0].width === 900 && doc.assets.length === 1);

  // attach the brand kit
  await page.keyboard.press("Escape");
  await page.click('[data-category="brand"]');
  await page.select(L("Brand kit"), await page.$eval(`${L("Brand kit")} option:nth-child(2)`, (o) => o.value));
  await clickText("Brand heading");
  await saved();
  doc = await readDoc(projectId());
  const brandText = doc.slides[1].elements.at(-1);
  ok("brand heading uses the kit's font and primary color", !!doc.brandKitId && brandText.fontFamily === "Test Brand" && brandText.fill === "#c8553d");
  ok("brand colors are offered as swatches", !!(await page.$(L("Brand color #c8553d"))));
  await sleep(600);
  await page.screenshot({ path: `${SHOTS}/p2-template-editor.png` });

  // export warns about remaining placeholders and leaves them out
  await clickText("Export");
  ok("export dialog warns about empty photo frames", !!(await page.waitForSelector('[data-testid="placeholder-warning"]')));
  await clickText("Close");

  // save as template
  await saved();
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await click(L("Actions for Quiet Minimal"));
  await clickText("Save as template");
  await page.waitForSelector('[role="status"] ::-p-text(saved to Templates)');
  await clickText("Templates");
  await page.waitForSelector(L("Category"));
  await page.select(L("Category"), "My templates");
  ok("a project can be saved as a reusable template", (await page.$$('section[aria-label="Templates"] article')).length === 1);

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
