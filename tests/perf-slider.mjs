/**
 * Rough responsiveness check for the image adjustment sliders.
 * Simulates a slow phone (CPU throttled 4x) and reports how long the page is blocked
 * per slider step on a 12 MP photo that fills a 1080 x 1350 slide.
 * Needs FIXTURES/camera.jpg (any large photo). Informational: prints numbers, never fails.
 */
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL || "http://localhost:3210";
const FIXTURES = process.env.FIXTURES || "/tmp/fixtures";
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const L = (l) => `[aria-label="${l}"]`;
const clickText = async (t) => (await page.waitForSelector(`button ::-p-text(${t})`, { visible: true })).click();
const setField = async (label, value) => {
  const f = await page.waitForSelector(L(label), { visible: true });
  await f.click();
  await f.type(String(value));
  await page.keyboard.press("Enter");
};
await page.goto(BASE, { waitUntil: "networkidle0" });
await clickText("New project");
await page.type("#np-name", "Perf");
await setField("Number of slides", 1);
await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickText("Create project")]);
await page.waitForSelector('[data-testid="canvas-host"] canvas');
await (await page.$('[data-testid="image-input"]')).uploadFile(`${FIXTURES}/camera.jpg`);
await page.waitForSelector("button ::-p-text(Replace photo)", { timeout: 30000 });
for (const [k, v] of [["X position", 0], ["Y position", 0], ["Width", 1080], ["Height", 1350]]) await setField(k, v);
await clickText("Adjust manually");
const cdp = await page.createCDPSession();
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now())))));
const measure = async (label) => {
  await (await page.waitForSelector(`input[type="range"]${L(label)}`)).focus();
  await frame();
  const times = [];
  for (let i = 0; i < 12; i++) {
    const t0 = await page.evaluate(() => performance.now());
    await page.keyboard.press("ArrowRight");
    times.push((await frame()) - t0);
  }
  times.sort((a, b) => a - b);
  console.log(`${label.padEnd(10)} median ${times[6].toFixed(0)} ms/step, worst ${times[11].toFixed(0)} ms`);
};
await measure("Opacity");
await measure("Brightness");
await measure("Blur");
await measure("Vignette");

// Continuous drag: one new value per animation frame, like a finger moving the thumb.
const drag = (label) =>
  page.evaluate(async (sel) => {
    const input = document.querySelector(sel);
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const frames = [];
    let last = performance.now();
    for (let i = 0; i < 40; i++) {
      setValue.call(input, String(-40 + i * 2));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      frames.push(now - last);
      last = now;
    }
    frames.sort((a, b) => a - b);
    return { median: frames[20], worst: frames[39] };
  }, `input[type="range"][aria-label="${label}"]`);
for (const label of ["Brightness", "Contrast"]) {
  const d = await drag(label);
  console.log(`drag ${label.padEnd(10)} median frame ${d.median.toFixed(0)} ms, worst ${d.worst.toFixed(0)} ms`);
}
console.log("dedicated workers:", page.workers().length);
await browser.close();
