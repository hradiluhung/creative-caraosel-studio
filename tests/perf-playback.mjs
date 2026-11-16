/**
 * Rough smoothness check for video preview playback on a slow phone.
 * Phone viewport at 3x pixel density, CPU throttled 4x, a 1080p 30 fps clip filling most of the
 * slide next to a photo and a heading. Reports how often the page really painted, the longest
 * stalls, and how many times a playing video was forced to seek (each forced seek is a visible jump).
 * Needs FIXTURES/big.mp4 (1920x1080, 6 s) and FIXTURES/photo-a.jpg:
 *   ffmpeg -f lavfi -i "testsrc2=s=1920x1080:r=30:d=6" -f lavfi -i "sine=frequency=330:duration=6" \
 *     -c:v libx264 -preset veryfast -pix_fmt yuv420p -g 30 -movflags +faststart -c:a aac -shortest big.mp4
 * Informational: prints numbers, never fails.
 */
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL || "http://localhost:3210";
const FIXTURES = process.env.FIXTURES || "/tmp/fixtures";
const CLIP = process.env.PERF_CLIP || "big.mp4";
const RATE = Number(process.env.CPU_THROTTLE || 4);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument(() => {
  // Count forced seeks on videos that are playing.
  globalThis.__seeks = 0;
  const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime");
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
    get: d.get,
    set(v) {
      if (!this.paused) globalThis.__seeks++;
      d.set.call(this, v);
    },
  });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tapText = async (t) => (await page.waitForSelector(`button ::-p-text(${t})`, { visible: true })).tap();
await page.goto(BASE, { waitUntil: "networkidle0" });
await tapText("New project");
await page.type("#np-name", "Playback perf");
await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), tapText("Create project")]);
await page.waitForSelector('[data-testid="canvas-host"] canvas');
await tapText("Add");
if (!process.env.VIDEO_ONLY) {
  await tapText("Add a heading");
  await (await page.waitForSelector('[data-testid="image-input"]')).uploadFile(`${FIXTURES}/photo-a.jpg`);
  await sleep(1500);
}
await (await page.waitForSelector('[data-testid="video-input"]')).uploadFile(`${FIXTURES}/${CLIP}`);
await page.waitForSelector(`[aria-label="Add video ${CLIP}"]`, { timeout: 30000 });
// A heavy clip gets a lighter preview copy first: measure what the user gets after that.
if (!process.env.NO_PROXY_WAIT) {
  const state = await page.evaluate(async () => {
    const read = () =>
      new Promise((resolve) => {
        const req = indexedDB.open("creative-carousel-studio");
        req.onsuccess = () => {
          const all = req.result.transaction("assets").objectStore("assets").getAll();
          all.onsuccess = () => resolve(all.result.filter((a) => a.mime.startsWith("video/")).map((a) => ({ w: a.width, h: a.height, proxy: a.proxy?.size ?? 0 })));
        };
      });
    for (let i = 0; i < 360; i++) {
      const videos = await read();
      // Small sources never get a proxy; heavy ones are measured once theirs is stored.
      if (videos.every((v) => v.proxy > 0 || Math.min(v.w, v.h) <= 720)) return videos;
      await new Promise((r) => setTimeout(r, 500));
    }
    return "no proxy after 3 minutes";
  });
  console.log("video assets:", JSON.stringify(state));
  await sleep(1000);
}
await tapText("Done").catch(() => {});
await sleep(1000);

const cdp = await page.createCDPSession();
await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
await page.evaluate(() => {
  globalThis.__frames = [];
  globalThis.__seeks = 0;
  let last = performance.now();
  const tick = (now) => {
    globalThis.__frames.push(now - last);
    last = now;
    globalThis.__raf = requestAnimationFrame(tick);
  };
  globalThis.__raf = requestAnimationFrame(tick);
});
const t0 = Date.now();
await (await page.waitForSelector('[aria-label="Play slide"]', { visible: true })).tap();
await page.waitForSelector('[data-testid="playback-bar"][data-state="stopped"]', { timeout: 60000 }).catch(() => console.log("playback did not finish in 60 s"));
const wall = (Date.now() - t0) / 1000;
const r = await page.evaluate(() => {
  cancelAnimationFrame(globalThis.__raf);
  const f = globalThis.__frames.slice(2).sort((a, b) => a - b);
  const sum = f.reduce((a, b) => a + b, 0);
  return { n: f.length, fps: (f.length / sum) * 1000, median: f[Math.floor(f.length / 2)], p95: f[Math.floor(f.length * 0.95)], worst: f[f.length - 1], over50: f.filter((x) => x > 50).length, seeks: globalThis.__seeks };
});
console.log(`CPU throttle ${RATE}x, ${CLIP} played in ${wall.toFixed(1)} s`);
console.log(`painted frames ${r.n} (${r.fps.toFixed(1)} per second), median ${r.median.toFixed(0)} ms, p95 ${r.p95.toFixed(0)} ms, worst ${r.worst.toFixed(0)} ms, stalls over 50 ms: ${r.over50}`);
console.log(`forced seeks while playing: ${r.seeks}`);
await browser.close();
