/**
 * Phone editing: selecting several objects by tapping, and sliders under number fields on touch screens.
 * Same setup as tests/e2e.mjs (production build on BASE_URL, CHROME_PATH).
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL || "http://localhost:3210";
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
await page.emulate({
  viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
});
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => m.type() === "error" && pageErrors.push(`${m.text()} @ ${m.location()?.url ?? ""}`));

const L = (label) => `[aria-label="${label}"]`;
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
const readDoc = () => idb((db, id) => new Promise((res) => { const r = db.transaction("projectDocs").objectStore("projectDocs").get(id); r.onsuccess = () => res(r.result); }), projectId());

const view = async (surfaceW = 1080, surfaceH = 1350, padding = 20) => {
  const b = await (await page.$('[data-testid="canvas-host"]')).boundingBox();
  const scale = Math.min((b.width - padding * 2) / surfaceW, (b.height - padding * 2) / surfaceH);
  const ox = b.x + (b.width - surfaceW * scale) / 2;
  const oy = b.y + (b.height - surfaceH * scale) / 2;
  return { scale, toScreen: (x, y) => ({ x: ox + x * scale, y: oy + y * scale }) };
};
const tapEl = async (el) => {
  const v = await view();
  const p = v.toScreen(el.x + el.width / 2, el.y + el.height / 2);
  await page.touchscreen.tap(p.x, p.y);
  await sleep(150);
};
const tapText = async (text) => (await page.waitForSelector(`button ::-p-text(${text})`, { visible: true })).tap();
const tool = async (name) => (await page.waitForSelector(`nav[aria-label="Editor tools"] button ::-p-text(${name})`)).tap();
const selectionCount = () => page.$$eval('[aria-label="Layers"] [aria-current="true"]', (n) => n.length);
const els = async () => (await readDoc()).slides[0].elements;
/** Move a range input the way a finger does: several input events in a row. */
const slide = (label, values) =>
  page.$eval(
    L(label),
    async (input, vs) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      for (const v of vs) {
        setter.call(input, String(v));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
      }
    },
    values,
  );

try {
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await (await page.waitForSelector("button ::-p-text(New project)")).tap();
  await page.type("#np-name", "Phone Test");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), tapText("Create project")]);
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await sleep(600);

  ok("the status bar backing is in the editor and takes no space where there is no status bar", await page.$eval('[data-testid="status-bar-backing"]', (n) => getComputedStyle(n).position === "fixed" && n.getBoundingClientRect().height === 0));

  // Two shapes, apart from each other.
  for (const [x, y] of [[100, 150], [600, 900]]) {
    await tool("Add");
    await (await page.waitForSelector(L("Add rectangle"))).tap();
    await saved();
    await tapText("Done");
    await sleep(300);
    // Place it by the numbers so the taps below land on known spots.
    await tool("Edit");
    await page.waitForSelector(L("X position"));
    for (const [label, v] of [["X position", x], ["Y position", y]]) {
      await page.$eval(L(label), (n) => n.focus());
      await page.$eval(L(label), (n) => n.select());
      await page.keyboard.type(String(v));
      await page.keyboard.press("Enter");
    }
    await saved();
    await tapText("Done");
    await sleep(300);
  }
  let [a, b] = await els();
  ok("setup: two shapes apart", a.x === 100 && b.x === 600, JSON.stringify([a.x, a.y, b.x, b.y]));

  // ---------- Selecting several objects by tapping ----------
  await tapEl(a);
  await tapEl(b);
  const sel = () => page.evaluate(() => document.querySelector('[data-testid="multi-select"]')?.textContent);
  ok("without the toggle a tap replaces the selection", (await sel()) === "Select multiple");
  await (await page.waitForSelector('[data-testid="multi-select"]')).tap();
  ok("the toggle is shown on the canvas and switches on", await page.$eval('[data-testid="multi-select"]', (n) => n.getAttribute("aria-pressed") === "true"));
  await tapEl(a);
  ok("with it on, tapping another object adds it", (await sel()) === "Multi-select (2)", await sel());
  await page.screenshot({ path: `${SHOTS}/m-01-multiselect.png` });
  await tapEl(a);
  ok("tapping a selected object again takes it out", (await sel()) === "Multi-select (1)", await sel());
  await tapEl(a);
  ok("and back in", (await sel()) === "Multi-select (2)");

  // Both move together with one drag, as one undo step.
  const v = await view();
  const p = v.toScreen(b.x + b.width / 2, b.y + b.height / 2);
  await page.touchscreen.touchStart(p.x, p.y);
  for (let i = 1; i <= 6; i++) await page.touchscreen.touchMove(p.x, p.y - i * 8);
  await page.touchscreen.touchEnd();
  await saved();
  const [a2, b2] = await els();
  const dyA = a2.y - a.y;
  const dyB = b2.y - b.y;
  ok("dragging moves every selected object by the same amount", dyA < -10 && Math.abs(dyA - dyB) < 1, `dyA=${dyA} dyB=${dyB}`);

  // The layers list follows the same rule.
  await tool("Layers");
  await page.waitForSelector('[aria-label="Layers"]');
  ok("the layers list shows both as selected", (await selectionCount()) === 2);
  await (await page.$$('[aria-label="Layers"] li'))[0].tap();
  ok("tapping a layer while the toggle is on takes it out of the selection", (await selectionCount()) === 1);
  await tapText("Done");
  await sleep(300);
  await (await page.waitForSelector('[data-testid="multi-select"]')).tap();
  ok("switching it off goes back to normal taps", (await sel()) === "Select multiple");
  [a, b] = await els();
  await tapEl(a);
  await tapEl(b);
  await tool("Layers");
  ok("after switching off, a tap selects only that object", (await selectionCount()) === 1);
  await tapText("Done");
  await sleep(300);

  // ---------- Sliders under number fields ----------
  await tapEl(b);
  await tool("Edit");
  await page.waitForSelector(L("Width slider"));
  const visible = await page.$$eval('[data-testid="number-slider"]', (ns) => ns.filter((n) => n.offsetParent !== null).map((n) => n.getAttribute("aria-label")));
  ok("touch screens show sliders for size-type fields", ["Width slider", "Height slider", "Rotation slider", "Stroke width slider", "Corner radius slider"].every((x) => visible.includes(x)), visible.join(", "));
  ok("position fields keep only the number (objects are moved by dragging)", !visible.includes("X position slider"));
  await page.screenshot({ path: `${SHOTS}/m-02-sliders.png` });
  const before = (await els())[1];
  await slide("Width slider", [before.width + 40, before.width + 120, before.width + 200, 500]);
  await saved();
  const after = (await els())[1];
  ok("dragging a slider changes the object live", after.width === 500, `width=${after.width}`);
  ok("the number field follows the slider", (await page.$eval(L("Width"), (n) => n.value)) === "500");
  await tapText("Done");
  await sleep(200);
  await (await page.waitForSelector(L("Undo"))).tap();
  await saved();
  ok("a whole slider drag is one undo step", (await els())[1].width === before.width, `${(await els())[1].width} vs ${before.width}`);
  await (await page.waitForSelector(L("Redo"))).tap();
  await saved();

  await tool("Edit");
  await page.waitForSelector(L("Rotation slider"));
  await slide("Rotation slider", [10, 30, 45]);
  await saved();
  ok("the rotation slider sets the angle", (await els())[1].rotation === 45);

  // Desktop pointer: the sliders stay hidden, the panel looks as before.
  const editorUrl = page.url();
  const desk = await browser.newPage();
  await desk.setViewport({ width: 1440, height: 900 });
  await desk.goto(editorUrl, { waitUntil: "networkidle0" });
  await desk.waitForSelector('[aria-label="Layers"] li');
  await (await desk.$$('[aria-label="Layers"] li'))[0].click();
  await desk.waitForSelector(L("Width"));
  ok("with a mouse the sliders are hidden and the panel is as before", await desk.$$eval('[data-testid="number-slider"]', (ns) => ns.length > 0 && ns.every((n) => n.offsetParent === null)));
  ok("with a mouse the multi-select toggle is not shown", !(await desk.$('[data-testid="multi-select"]')));
  await desk.close();

  ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (e) {
  console.log("ABORTED:", e.message);
  await page.screenshot({ path: `${SHOTS}/m-failure.png` }).catch(() => {});
  console.log("page errors:", pageErrors);
  results.push({ name: "aborted", pass: false });
} finally {
  await browser.close();
}
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
