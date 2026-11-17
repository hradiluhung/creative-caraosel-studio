/**
 * Smart guides: snapping while moving and resizing, against slide lines and other objects.
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
const idb = (fn, ...args) => page.evaluate(
  (source, a) =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open("creative-carousel-studio");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => Promise.resolve(new Function("db", "args", `return (${source})(db, ...args)`)(req.result, a)).then((v) => (req.result.close(), resolve(v)), reject);
    }),
  fn.toString(),
  args,
);
const readDoc = () => idb((db, id) => new Promise((res) => { const r = db.transaction("projectDocs").objectStore("projectDocs").get(id); r.onsuccess = () => res(r.result); }), projectId());
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

const W = 1080, H = 1350;
const view = async () => {
  const b = await (await page.$('[data-testid="canvas-host"]')).boundingBox();
  const scale = Math.min((b.width - 112) / W, (b.height - 112) / H);
  const ox = b.x + (b.width - W * scale) / 2;
  const oy = b.y + (b.height - H * scale) / 2;
  return { scale, at: (x, y) => ({ x: ox + x * scale, y: oy + y * scale }) };
};
const els = async () => (await readDoc()).slides[0].elements;
const guides = () => page.$eval('[data-testid="canvas-host"]', (n) => n.dataset.guides ?? "");
/** Drag from one document point to another. Returns the guides shown just before releasing. */
const drag = async (from, to, { ctrl = false } = {}) => {
  const v = await view();
  const a = v.at(from.x, from.y);
  const b = v.at(to.x, to.y);
  if (ctrl) await page.keyboard.down("Control");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await sleep(60);
  const shown = await guides();
  await page.mouse.up();
  if (ctrl) await page.keyboard.up("Control");
  await saved();
  return shown;
};
const centre = (e) => ({ x: e.x + e.width / 2, y: e.y + e.height / 2 });
const selectOnly = async (e) => {
  const v = await view();
  const far = v.at(W - 6, H - 6);
  await page.mouse.click(far.x, far.y);
  const c = v.at(e.x + e.width / 2, e.y + e.height / 2);
  await page.mouse.click(c.x, c.y);
  await sleep(80);
};

try {
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await clickText("New project");
  await page.type("#np-name", "Snap Test");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickText("Create project")]);
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  const { scale } = await view();
  const px = (screenPx) => screenPx / scale; // screen pixels as document units

  // ---------- Moving ----------
  await click(L("Add rectangle"));
  await until(async () => ({ done: (await elementCount()) === 1 }));
  await saved();
  let [a] = await els();
  // Without snapping first, to a known messy spot.
  await drag(centre(a), { x: 301.3 + a.width / 2, y: 207.7 + a.height / 2 }, { ctrl: true });
  [a] = await els();
  ok("holding Ctrl moves freely", Math.abs(a.x - 301) <= 2 && Math.abs(a.y - 208) <= 2, `${a.x},${a.y}`);
  ok("no guide is left on screen after a drag", (await guides()) === "");

  let shown = await drag(centre(a), { x: px(4) + a.width / 2, y: centre(a).y });
  [a] = await els();
  ok("move: the left edge snaps to the slide's left edge", a.x === 0, `x=${a.x}`);
  ok("move: a guide is shown on that line while dragging", shown.split(" ").includes("x:0"), shown);

  shown = await drag(centre(a), { x: W / 2 + px(3), y: H / 2 - px(4) });
  [a] = await els();
  ok("move: the centre snaps to the slide centre on both axes", a.x + a.width / 2 === W / 2 && a.y + a.height / 2 === H / 2, `${a.x},${a.y}`);
  ok("move: both centre guides are shown", shown.includes("x:540") && shown.includes("y:675"), shown);

  shown = await drag(centre(a), { x: W - a.width / 2 - px(4), y: H - a.height / 2 + px(3) });
  [a] = await els();
  ok("move: right and bottom edges snap to the slide", a.x + a.width === W && a.y + a.height === H, `${a.x + a.width},${a.y + a.height}`);

  const away = await drag(centre(a), { x: 400.4, y: 380.2 });
  [a] = await els();
  ok("move: nothing snaps when no line is near", away === "" && a.x !== 0 && a.x + a.width / 2 !== W / 2, `${away} ${a.x}`);

  // A second object, moved next to the first.
  await click(L("Add rectangle"));
  await until(async () => ({ done: (await elementCount()) === 2 }));
  await saved();
  let b = (await els())[1];
  await drag(centre(b), { x: 800.3, y: 1000.6 }, { ctrl: true });
  [a, b] = await els();
  shown = await drag(centre(b), { x: a.x + a.width + b.width / 2 + px(4), y: a.y + b.height / 2 - px(3) });
  [a, b] = await els();
  ok("move: left edge snaps to another object's right edge, top to its top", b.x === a.x + a.width && b.y === a.y, `b=${b.x},${b.y} a=${a.x + a.width},${a.y}`);
  ok("move: guides are shown for the other object's lines", shown.includes(`x:${Math.round(a.x + a.width)}`) && shown.includes(`y:${Math.round(a.y)}`), shown);
  await page.screenshot({ path: `${SHOTS}/snap-01-move.png` });

  // ---------- Resizing ----------
  // The case from the report: drag the bottom edge of the second object to the bottom of the first.
  await drag(centre(b), { x: 800.3, y: 900.6 }, { ctrl: true });
  [a, b] = await els();
  await selectOnly(b);
  // First make it clearly different (top edge up, free), then bring the bottom to A's bottom.
  await drag({ x: b.x + b.width / 2, y: b.y }, { x: b.x + b.width / 2, y: a.y + 37.3 }, { ctrl: true });
  [a, b] = await els();
  await drag({ x: b.x + b.width / 2, y: b.y + b.height }, { x: b.x + b.width / 2, y: a.y + a.height + 61.7 }, { ctrl: true });
  [a, b] = await els();
  ok("resize with Ctrl held does not snap", b.y + b.height !== a.y + a.height, `${b.y + b.height} vs ${a.y + a.height}`);
  const bTop = b.y, bX = b.x, bW = b.width;
  {
    const v = await view();
    const from = v.at(b.x + b.width / 2, b.y + b.height);
    const to = v.at(b.x + b.width / 2, a.y + a.height + px(4));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await sleep(60);
    shown = await guides();
    await page.screenshot({ path: `${SHOTS}/snap-02-resize-guide.png` });
    await page.mouse.up();
    await saved();
  }
  [a, b] = await els();
  ok("resize: the bottom edge snaps to the bottom edge of another object", b.y + b.height === a.y + a.height, `${b.y + b.height} vs ${a.y + a.height}`);
  ok("resize: only the dragged edge moved", b.y === bTop && b.x === bX && b.width === bW, JSON.stringify(b));
  ok("resize: a guide is shown on the other object's bottom line", shown.split(" ").includes(`y:${Math.round(a.y + a.height)}`), shown);
  ok("resize: the guide is gone after releasing", (await guides()) === "");

  shown = await drag({ x: b.x + b.width, y: b.y + b.height / 2 }, { x: W - px(4), y: b.y + b.height / 2 });
  [a, b] = await els();
  ok("resize: the right edge snaps to the slide's right edge", b.x + b.width === W && b.x === bX && shown.includes("x:1080"), `${b.x + b.width} ${shown}`);

  shown = await drag({ x: b.x, y: b.y + b.height / 2 }, { x: a.x + a.width + px(3), y: b.y + b.height / 2 });
  [a, b] = await els();
  ok("resize: the left edge snaps to another object's right edge, the right edge stays", b.x === a.x + a.width && b.x + b.width === W, `${b.x} vs ${a.x + a.width}`);

  shown = await drag({ x: b.x + b.width / 2, y: b.y }, { x: b.x + b.width / 2, y: a.y - px(4) });
  [a, b] = await els();
  ok("resize: the top edge snaps to another object's top edge", b.y === a.y && b.y + b.height === a.y + a.height, `${b.y} vs ${a.y}`);

  // Free corner resize (shapes): both edges snap, here to the slide centre lines.
  await selectOnly(a);
  await drag(centre(a), { x: 200.4, y: 150.3 }, { ctrl: true });
  [a, b] = await els();
  shown = await drag({ x: a.x + a.width, y: a.y + a.height }, { x: W / 2 - px(3), y: H / 2 + px(4) });
  [a, b] = await els();
  ok("resize: a corner of a shape snaps on both axes", a.x + a.width === W / 2 && a.y + a.height === H / 2 && shown.includes("x:540") && shown.includes("y:675"), `${a.x + a.width},${a.y + a.height} ${shown}`);

  // Proportional corner resize (photos keep their shape).
  await (await page.$('[data-testid="image-input"]')).uploadFile(`${FIXTURES}/photo-a.jpg`);
  await until(async () => ({ done: (await elementCount()) === 3 }));
  await saved();
  let img = (await els())[2];
  await drag(centre(img), { x: 500.7, y: 700.2 }, { ctrl: true });
  img = (await els())[2];
  const ratio = img.width / img.height;
  // Follow the diagonal towards the slide bottom; stop 4 screen px short of it.
  const dy = H - px(4) - (img.y + img.height);
  shown = await drag({ x: img.x + img.width, y: img.y + img.height }, { x: img.x + img.width + dy * ratio, y: img.y + img.height + dy });
  const img2 = (await els())[2];
  ok("resize: a photo's corner snaps its bottom edge to the slide bottom", Math.abs(img2.y + img2.height - H) <= 1 && shown.includes("y:1350"), `${img2.y + img2.height} ${shown}`);
  ok("resize: the photo keeps its shape and its top-left corner", Math.abs(img2.width / img2.height - ratio) < 0.01 && Math.abs(img2.x - img.x) <= 1 && Math.abs(img2.y - img.y) <= 1, `${img2.width / img2.height} vs ${ratio}`);

  // ---------- Several objects at once ----------
  await page.keyboard.press("Delete");
  await until(async () => ({ done: (await elementCount()) === 2 }));
  await saved();
  [a, b] = await els();
  await selectOnly(a);
  {
    const v = await view();
    const c = v.at(b.x + b.width / 2, b.y + b.height / 2);
    await page.keyboard.down("Shift");
    await page.mouse.click(c.x, c.y);
    await page.keyboard.up("Shift");
    await sleep(80);
  }
  const left = Math.min(a.x, b.x);
  const gap = b.x - a.x;
  shown = await drag(centre(a), { x: centre(a).x - left + px(4), y: centre(a).y + 33.3 });
  [a, b] = await els();
  {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x + a.width, b.x + b.width);
    const onLine = minX === 0 || maxX === W || (minX + maxX) / 2 === W / 2;
    ok("move: a multi-selection snaps by the box around it and keeps its arrangement", onLine && b.x - a.x === gap && /x:(0|540|1080)/.test(shown), `a=${a.x} b=${b.x} gap=${gap} box=${minX}..${maxX} ${shown}`);
  }

  const afterMulti = [a.x, b.x].join();
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await saved();
  [a, b] = await els();
  ok("moving a multi-selection is one undo step", a.x === left && b.x === left + gap, `${a.x},${b.x} after undo, was ${afterMulti}`);

  ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
} catch (e) {
  console.log("ABORTED:", e.message);
  console.log("page errors:", pageErrors);
  results.push({ name: "aborted", pass: false });
} finally {
  await browser.close();
}
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
