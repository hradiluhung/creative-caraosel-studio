/**
 * End-to-end workflow check against a production build.
 *   npm run build && npm run start -- -p 3210   (in another terminal)
 *   CHROME_PATH=/path/to/chrome node tests/e2e.mjs
 * Needs sample images: FIXTURES dir with photo-a.jpg, photo-b.png and fake.jpg (not an image).
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import JSZip from "jszip";

const BASE = process.env.BASE_URL || "http://localhost:3210";
const FIXTURES = process.env.FIXTURES || "/tmp/fixtures";
const SHOTS = process.env.SHOTS || "/tmp/shots";
const DL = process.env.DOWNLOADS || "/tmp/dl";
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";

const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
});
const context = browser.defaultBrowserContext();
const page = await context.newPage();
await page.setViewport({ width: 1440, height: 900 });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => m.type() === "error" && pageErrors.push(`${m.text()} @ ${m.location()?.url ?? ""}`));
const cdp = await page.createCDPSession();
await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL, eventsEnabled: true });
for (const f of fs.readdirSync(DL)) fs.rmSync(path.join(DL, f));

const click = async (selector) => (await page.waitForSelector(selector, { visible: true })).click();
const byLabel = (label) => `[aria-label="${label}"]`;
const clickText = async (text, tag = "button") => {
  const el = await page.waitForSelector(`${tag} ::-p-text(${text})`, { visible: true });
  await el.click();
};
const saved = () => page.waitForSelector('[data-testid="save-status"][data-status="saved"]', { timeout: 15000 });
const readDoc = (id) =>
  page.evaluate(
    (pid) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("creative-carousel-studio");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const get = req.result.transaction("projectDocs").objectStore("projectDocs").get(pid);
          get.onsuccess = () => (req.result.close(), resolve(get.result));
          get.onerror = () => reject(get.error);
        };
      }),
    id,
  );
const projectId = () => new URL(page.url()).searchParams.get("id");
/** Screen position of a document point, replicating fitToViewport for a freshly fitted surface. */
const view = async (surfaceW, surfaceH, padding = 56) => {
  const host = await page.$('[data-testid="canvas-host"]');
  const b = await host.boundingBox();
  const scale = Math.min((b.width - padding * 2) / surfaceW, (b.height - padding * 2) / surfaceH);
  const ox = b.x + (b.width - surfaceW * scale) / 2;
  const oy = b.y + (b.height - surfaceH * scale) / 2;
  return { scale, toScreen: (x, y) => ({ x: ox + x * scale, y: oy + y * scale }) };
};
const waitDownload = async (name, timeout = 20000) => {
  const file = path.join(DL, name);
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fs.existsSync(file) && !fs.existsSync(file + ".crdownload")) return fs.readFileSync(file);
    await sleep(150);
  }
  throw new Error(`download ${name} did not arrive`);
};
const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });
const decode = (buf, mime) =>
  page.evaluate(
    async (b64, type) => {
      const blob = await (await fetch(`data:${type};base64,${b64}`)).blob();
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext("2d").drawImage(bmp, 0, 0);
      globalThis.__img = c;
      return { width: bmp.width, height: bmp.height };
    },
    buf.toString("base64"),
    mime,
  );
const pixel = (x, y) => page.evaluate((px, py) => Array.from(globalThis.__img.getContext("2d").getImageData(px, py, 1, 1).data), x, y);
const near = (a, b, tol = 6) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

try {
  // ---------- 1. Dashboard and project creation (10 slides) ----------
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await clickText("New project");
  await page.type("#np-name", "Bali Trip");
  const slidesField = await page.waitForSelector(byLabel("Number of slides"));
  await slidesField.click();
  await slidesField.type("10");
  await page.keyboard.press("Tab");
  await page.screenshot({ path: `${SHOTS}/01-new-project.png` });
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickText("Create project")]);
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  const id = projectId();
  ok("create project with 10 slides", (await page.$$('ol[aria-label="Slides"] > li')).length === 10);

  // ---------- 2. Text, shapes, images ----------
  await page.click('[data-category="text"]');
  await clickText("Add a heading");
  await page.click('[data-category="shapes"]');
  await click(byLabel("Add star"));
  const upload = await page.$('[data-testid="image-input"]');
  await upload.uploadFile(`${FIXTURES}/photo-a.jpg`, `${FIXTURES}/photo-b.png`, `${FIXTURES}/fake.jpg`);
  await page.waitForSelector('[role="alert"] ::-p-text(not a supported image)');
  ok("non-image file disguised as .jpg is rejected", true);
  await saved();
  let doc = await readDoc(id);
  ok("text, shape and two images are on slide 1", doc.slides[0].elements.map((e) => e.type).join() === "text,shape,image,image");
  ok("assets are referenced, not embedded", doc.assets.length === 2 && !JSON.stringify(doc).includes("base64"));

  // ---------- 3. Typography ----------
  const textId = doc.slides[0].elements[0].id;
  await page.click('ul[aria-label="Layers"] li:last-child');
  await click(byLabel("Font family"));
  await click(byLabel("Use Bebas Neue"));
  const size = await page.waitForSelector(byLabel("Font size"));
  await size.click();
  await size.type("120");
  await page.keyboard.press("Enter");
  await saved();
  doc = await readDoc(id);
  let text = doc.slides[0].elements.find((e) => e.id === textId);
  ok("typography edits are stored", text.fontFamily === "Bebas Neue" && text.fontSize === 120);
  ok("canvas font is really loaded", await page.evaluate(() => document.fonts.check('400 40px "Bebas Neue"')));

  // ---------- 4. Layer reorder + undo / redo ----------
  await click(byLabel("Bring forward"));
  await saved();
  doc = await readDoc(id);
  ok("layer moved forward", doc.slides[0].elements[1].id === textId);
  await click(byLabel("Undo"));
  await saved();
  doc = await readDoc(id);
  ok("undo restores layer order", doc.slides[0].elements[0].id === textId);
  await click(byLabel("Redo"));
  await saved();
  doc = await readDoc(id);
  ok("redo reapplies it", doc.slides[0].elements[1].id === textId);

  // ---------- 5. Drag on canvas, keyboard nudge ----------
  await page.click('ul[aria-label="Layers"] li:nth-child(1)'); // top-most layer: photo-b
  doc = await readDoc(id);
  const top = doc.slides[0].elements.at(-1);
  let v = await view(1080, 1350);
  const from = v.toScreen(top.x + top.width / 2, top.y + top.height / 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 30, { steps: 6 });
  await page.mouse.up();
  await saved();
  doc = await readDoc(id);
  const movedEl = doc.slides[0].elements.at(-1);
  const dx = movedEl.x - top.x;
  const dy = movedEl.y - top.y;
  ok("dragging on the canvas moves the element by the matching document distance", Math.abs(dx - 40 / v.scale) < 12 && Math.abs(dy - 30 / v.scale) < 12, `dx=${dx} dy=${dy} expected≈${(40 / v.scale).toFixed(0)},${(30 / v.scale).toFixed(0)}`);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.down("Shift");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.up("Shift");
  await saved();
  doc = await readDoc(id);
  ok("arrow keys nudge", doc.slides[0].elements.at(-1).x === movedEl.x + 1 && doc.slides[0].elements.at(-1).y === movedEl.y + 10);

  // ---------- 6. Inline text editing by double click ----------
  for (const n of [1, 2, 4]) await page.click(`ul[aria-label="Layers"] li:nth-child(${n}) [aria-label="Hide layer"]`);
  await saved();
  doc = await readDoc(id);
  text = doc.slides[0].elements.find((e) => e.id === textId);
  const tp = v.toScreen(text.x + text.width / 2, text.y + text.height / 2);
  await page.mouse.click(tp.x, tp.y);
  await page.mouse.click(tp.x, tp.y);
  await page.waitForSelector('textarea[aria-label="Edit text"]');
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.type("SEMINYAK SUNSET");
  await page.screenshot({ path: `${SHOTS}/02-text-editing.png` });
  await page.mouse.click(v.toScreen(20, 20).x, v.toScreen(20, 20).y);
  await saved();
  doc = await readDoc(id);
  text = doc.slides[0].elements.find((e) => e.id === textId);
  ok("double click edits text in place", text.text === "SEMINYAK SUNSET" && text.name === "SEMINYAK SUNSET");
  for (const n of [1, 2, 4]) await page.click(`ul[aria-label="Layers"] li:nth-child(${n}) [aria-label="Show layer"]`);

  // ---------- 7. Background, slides ----------
  await page.keyboard.press("Escape");
  const hex = await page.waitForSelector(byLabel("Background color hex"));
  await hex.click();
  await hex.type("#F4E9D8");
  await page.keyboard.press("Tab");
  await saved();
  doc = await readDoc(id);
  ok("background color stored", doc.slides[0].background.color === "#f4e9d8");
  const firstSlide = doc.slides[0].id;
  await click(byLabel("Move slide right"));
  await saved();
  doc = await readDoc(id);
  ok("slide reordered", doc.slides[1].id === firstSlide);
  await click(byLabel("Duplicate slide"));
  await saved();
  doc = await readDoc(id);
  ok("slide duplicated with new element ids", doc.slides.length === 11 && doc.slides[2].elements.length === 4 && doc.slides[2].elements[0].id !== doc.slides[1].elements[0].id);
  await click(byLabel("Delete slide"));
  await saved();
  doc = await readDoc(id);
  ok("slide deleted", doc.slides.length === 10);
  await sleep(600);
  await page.screenshot({ path: `${SHOTS}/03-editor-desktop.png` });

  // ---------- 8. Save and reopen ----------
  const before = JSON.stringify(doc);
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await sleep(800);
  ok("project reopens identically after reload", JSON.stringify(await readDoc(id)) === before);
  ok("reloaded editor shows the slides", (await page.$$('ol[aria-label="Slides"] > li')).length === 10);

  // ---------- 9. Export all slides (PNG, ZIP) ----------
  await clickText("Export");
  await clickText("PNG");
  await clickText("Export 10 slides");
  await page.waitForSelector('[data-testid="export-done"]', { timeout: 60000 });
  const zipBuf = await waitDownload("bali-trip-slides.zip");
  const zip = await JSZip.loadAsync(zipBuf);
  const names = Object.keys(zip.files);
  ok("ZIP holds 10 files named in slide order", names.length === 10 && names[0] === "bali-trip-01.png" && names[9] === "bali-trip-10.png", names.join(","));
  const sizes = await Promise.all(names.map(async (n) => pngSize(await zip.files[n].async("nodebuffer"))));
  ok("every exported PNG is exactly 1080x1350", sizes.every((s) => s.width === 1080 && s.height === 1350));
  const slide2 = await zip.files["bali-trip-02.png"].async("nodebuffer");
  fs.writeFileSync(`${SHOTS}/export-slide-02.png`, slide2);
  await decode(slide2, "image/png");
  ok("exported background color is exact", near(await pixel(5, 5), [0xf4, 0xe9, 0xd8, 255], 1));
  await clickText("Done");

  // ---------- 10. Export a single JPG ----------
  await clickText("Export");
  await clickText("Current");
  await clickText("Export 1 slide");
  await page.waitForSelector('[data-testid="export-done"]');
  const jpg = await waitDownload("bali-trip-01.jpg");
  ok("single slide exports as JPG 1080x1350", (await decode(jpg, "image/jpeg")).width === 1080 && jpg[0] === 0xff && jpg[1] === 0xd8);
  await clickText("Done");

  // ---------- 11. Seamless panorama: slices must line up ----------
  await page.goto(BASE, { waitUntil: "networkidle0" });
  ok("dashboard lists the project with a cover", !!(await page.waitForSelector('article img[src^="blob:"]')));
  await page.screenshot({ path: `${SHOTS}/04-dashboard.png` });
  await clickText("New project");
  await page.type("#np-name", "Pano");
  await clickText("Seamless panorama");
  const sf = await page.waitForSelector(byLabel("Number of slides"));
  await sf.click();
  await sf.type("6");
  await page.keyboard.press("Tab");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickText("Create project")]);
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  const pid = projectId();
  await page.click('[data-category="shapes"]');
  await click(byLabel("Add rectangle"));
  const setField = async (label, value) => {
    const f = await page.waitForSelector(byLabel(label));
    await f.click();
    await f.type(String(value));
    await page.keyboard.press("Enter");
  };
  // A red bar from x=900 to x=2400 crosses the 1|2 and 2|3 boundaries.
  await setField("X position", 900);
  await setField("Y position", 500);
  await setField("Width", 1500);
  await setField("Height", 200);
  await setField("Fill color hex", "#E00000");
  await saved();
  const pano = await readDoc(pid);
  ok("panorama element stored in panorama coordinates", pano.mode === "seamless" && pano.panorama.elements[0].x === 900 && pano.panorama.elements[0].width === 1500);
  await click(byLabel("Fit canvas to screen"));
  await sleep(500);
  await page.screenshot({ path: `${SHOTS}/05-seamless.png` });
  await clickText("Export");
  await clickText("PNG");
  await clickText("Export 6 slides");
  await page.waitForSelector('[data-testid="export-done"]', { timeout: 60000 });
  const pz = await JSZip.loadAsync(await waitDownload("pano-slides.zip"));
  const RED = [0xe0, 0, 0, 255];
  const WHITE = [255, 255, 255, 255];
  const slice = async (n) => decode(await pz.files[`pano-0${n}.png`].async("nodebuffer"), "image/png");
  await slice(1);
  const s1 = [await pixel(898, 600), await pixel(901, 600), await pixel(1079, 600), await pixel(1079, 498), await pixel(1079, 501), await pixel(1079, 699), await pixel(1079, 701)];
  await slice(2);
  const s2 = [await pixel(0, 600), await pixel(1079, 600), await pixel(0, 498), await pixel(0, 501), await pixel(0, 699), await pixel(0, 701)];
  await slice(3);
  const s3 = [await pixel(0, 600), await pixel(238, 600), await pixel(241, 600)];
  ok("slide 1: bar starts at x=900 and runs to the right edge", near(s1[0], WHITE) && near(s1[1], RED) && near(s1[2], RED));
  ok("slide 2: bar spans the full width", near(s2[0], RED) && near(s2[1], RED));
  ok("slide 3: bar ends at x=240 (2400 - 2160)", near(s3[0], RED) && near(s3[1], RED) && near(s3[2], WHITE));
  ok("bar edges meet at identical rows on both sides of the 1|2 boundary", near(s1[3], WHITE) && near(s1[4], RED) && near(s1[5], RED) && near(s1[6], WHITE) && near(s2[2], WHITE) && near(s2[3], RED) && near(s2[4], RED) && near(s2[5], WHITE));
  await clickText("Done");

  // ---------- 12. Preview vs export parity ----------
  // Sample the live editor canvas at the same document point the export was checked at.
  v = await view(6480, 1350);
  const shot = await page.screenshot({ encoding: "binary" });
  await decode(Buffer.from(shot), "image/png");
  const inBar = v.toScreen(1500, 600);
  const leftOfBar = v.toScreen(880, 600);
  ok("editor preview shows the bar at the same document position as the export", near(await pixel(Math.round(inBar.x), Math.round(inBar.y)), RED, 10) && near(await pixel(Math.round(leftOfBar.x), Math.round(leftOfBar.y)), WHITE, 10));

  // ---------- 13. Offline: service worker serves the shell, IndexedDB the project ----------
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 15000 });
  await sleep(1500);
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("article", { timeout: 15000 });
  ok("dashboard loads offline", (await page.$$("article")).length === 2);
  await page.goto(`${BASE}/editor?id=${id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="canvas-host"] canvas', { timeout: 15000 });
  await sleep(1200);
  ok("stored project opens offline", (await page.$$('ol[aria-label="Slides"] > li')).length === 10);
  ok("fonts are available offline", await page.evaluate(() => document.fonts.load('400 40px "Bebas Neue"').then((f) => f.length > 0)));
  await page.screenshot({ path: `${SHOTS}/06-offline-editor.png` });
  await page.setOfflineMode(false);

  // ---------- 14. Phone layout with touch ----------
  await page.emulate({
    viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  await page.goto(`${BASE}/editor?id=${id}`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await sleep(800);
  ok("phone layout shows the bottom toolbar", !!(await page.$('nav[aria-label="Editor tools"]')));
  await page.screenshot({ path: `${SHOTS}/07-mobile-editor.png` });
  const before14 = (await readDoc(id)).slides[0].elements.length;
  await (await page.waitForSelector('nav[aria-label="Editor tools"] button ::-p-text(Add)')).tap();
  await (await page.waitForSelector("button ::-p-text(Add a subheading)")).tap();
  await saved();
  ok("adding text from the mobile sheet works", (await readDoc(id)).slides[0].elements.length === before14 + 1);
  await (await page.waitForSelector("button ::-p-text(Done)")).tap();
  await (await page.waitForSelector('nav[aria-label="Editor tools"] button ::-p-text(Edit)')).tap();
  await page.waitForSelector(byLabel("Font family"));
  await sleep(400);
  await page.screenshot({ path: `${SHOTS}/08-mobile-edit-sheet.png` });
  // Touch drag on the canvas
  await (await page.waitForSelector("button ::-p-text(Done)")).tap();
  await sleep(300);
  let mdoc = await readDoc(id);
  const mel = mdoc.slides[0].elements.at(-1);
  const mv = await view(1080, 1350, 20);
  const mp = mv.toScreen(mel.x + mel.width / 2, mel.y + mel.height / 2);
  await page.touchscreen.touchStart(mp.x, mp.y);
  for (let i = 1; i <= 6; i++) await page.touchscreen.touchMove(mp.x, mp.y + i * 10);
  await page.touchscreen.touchEnd();
  await saved();
  mdoc = await readDoc(id);
  const mdy = mdoc.slides[0].elements.at(-1).y - mel.y;
  ok("touch drag moves the element", Math.abs(mdy - 60 / mv.scale) < 15, `dy=${mdy} expected≈${(60 / mv.scale).toFixed(0)}`);

  ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (e) {
  console.error("ABORTED:", e);
  await page.screenshot({ path: `${SHOTS}/failure.png` }).catch(() => {});
  results.push({ name: "run completed", pass: false });
  if (pageErrors.length) console.error("page errors:", pageErrors.slice(0, 5));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
