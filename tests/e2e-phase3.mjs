/**
 * Phase 3, checkpoint C1: video as an element (import, poster frame, playback, properties).
 * Same setup as tests/e2e.mjs. Extra fixtures:
 *   clip.mp4   2 s, 320x240, H.264 + AAC, first second red, second second blue:
 *     ffmpeg -f lavfi -i "color=c=red:s=320x240:d=1:r=30" -f lavfi -i "color=c=blue:s=320x240:d=1:r=30" \
 *       -f lavfi -i "sine=frequency=440:duration=2" -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0[v]" \
 *       -map "[v]" -map 2:a -c:v libx264 -pix_fmt yuv420p -g 15 -movflags +faststart -c:a aac -shortest clip.mp4
 *   clip.webm  the same clip:  ffmpeg -i clip.mp4 -c:v libvpx -b:v 300k -c:a libvorbis clip.webm
 *   sides.mp4  1 s, 320x240, no audio, left half red, right half blue:
 *     ffmpeg -f lavfi -i "color=c=red:s=160x240:d=1:r=30" -f lavfi -i "color=c=blue:s=160x240:d=1:r=30" \
 *       -filter_complex "[0:v][1:v]hstack=inputs=2[v]" -map "[v]" -c:v libx264 -pix_fmt yuv420p -movflags +faststart sides.mp4
 *   fake.mp4   any text file with that name
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL || "http://localhost:3210";
const FIXTURES = process.env.FIXTURES || "/tmp/fixtures";
const SHOTS = process.env.SHOTS || "/tmp/shots";
const DL = process.env.DOWNLOADS || "/tmp/dl3";
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";

const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(DL, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
for (const f of fs.readdirSync(DL)) fs.rmSync(path.join(DL, f));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
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
const idbGet = (storeName, key) =>
  page.evaluate(
    (name, k) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("creative-carousel-studio");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const get = req.result.transaction(name).objectStore(name).get(k);
          get.onsuccess = () => {
            req.result.close();
            const v = get.result;
            // Blobs do not survive the trip to Node, so describe them instead.
            resolve(name === "assets" && v ? { type: v.blob?.type, size: v.blob?.size, posterType: v.poster?.type, posterSize: v.poster?.size } : v);
          };
        };
      }),
    storeName,
    key,
  );
const readDoc = () => idbGet("projectDocs", projectId());
const video = async () => (await readDoc()).slides[0].elements.find((e) => e.type === "video");
const decodePng = (buf) =>
  page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext("2d").drawImage(bmp, 0, 0);
    globalThis.__img = c;
    return { width: bmp.width, height: bmp.height };
  }, Buffer.from(buf).toString("base64"));
const pixel = (x, y) => page.evaluate((px, py) => Array.from(globalThis.__img.getContext("2d").getImageData(px, py, 1, 1).data), Math.round(x), Math.round(y));
const exportPng = async (name) => {
  await clickText("Export");
  await clickText("PNG");
  await clickText("Current");
  const warning = !!(await page.$('[data-testid="video-warning"]'));
  await clickText("Export 1 slide");
  await page.waitForSelector('[data-testid="export-done"]', { timeout: 60000 });
  const file = path.join(DL, name);
  for (let i = 0; i < 100 && !fs.existsSync(file); i++) await sleep(150);
  const buf = fs.readFileSync(file);
  fs.rmSync(file);
  await clickText("Done");
  return { warning, size: await decodePng(buf) };
};
/** Screen position of a document point on a freshly fitted slide (same math as fitToViewport). */
const toScreen = async (x, y, padding = 56) => {
  const b = await (await page.$('[data-testid="canvas-host"]')).boundingBox();
  const scale = Math.min((b.width - padding * 2) / 1080, (b.height - padding * 2) / 1350);
  return { x: b.x + (b.width - 1080 * scale) / 2 + x * scale, y: b.y + (b.height - 1350 * scale) / 2 + y * scale };
};
/** Color the editor canvas really shows at a document point. */
const screenColor = async (x, y) => {
  const p = await toScreen(x, y);
  await decodePng(await page.screenshot({ clip: { x: Math.round(p.x) - 2, y: Math.round(p.y) - 2, width: 4, height: 4 } }));
  return pixel(2, 2);
};
const isRed = (c) => c[0] > 180 && c[1] < 80 && c[2] < 80;
const isBlue = (c) => c[2] > 180 && c[0] < 80 && c[1] < 80;
const until = async (probe, timeout = 6000) => {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await probe();
    if (last.done) return last;
    await sleep(60);
  }
  return last;
};
const showsColor = (test, timeout) => until(async () => ((c) => ({ done: test(c), c }))(await screenColor(540, 575)), timeout);
const playbackState = () => page.$eval('[data-testid="playback-bar"]', (el) => el.dataset.state).catch(() => "absent");
const waitState = (state, timeout = 8000) => until(async () => ((s) => ({ done: s === state, s }))(await playbackState()), timeout);

try {
  // ---------- Import ----------
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await clickText("New project");
  await page.type("#np-name", "Video Test");
  await setField("Number of slides", 2);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickText("Create project")]);
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  ok("no playback controls on a slide without video", (await playbackState()) === "absent");

  await (await page.$('[data-testid="video-input"]')).uploadFile(`${FIXTURES}/clip.mp4`, `${FIXTURES}/fake.mp4`);
  await page.waitForSelector('[role="alert"] ::-p-text(not a supported video)');
  ok("a text file disguised as .mp4 is rejected", true);
  await saved();
  let doc = await readDoc();
  let el = doc.slides[0].elements[0];
  const asset = doc.assets[0];
  ok("document is schema version 3 with one video element", doc.schemaVersion === 3 && doc.slides[0].elements.length === 1 && el.type === "video" && el.assetId === asset.id);
  ok(
    "asset records real type, size and duration",
    doc.assets.length === 1 && asset.mime === "video/mp4" && asset.width === 320 && asset.height === 240 && Math.abs(asset.duration - 2) < 0.15,
    JSON.stringify(asset),
  );
  ok("new clip plays the whole file", el.trimStart === 0 && Math.abs(el.trimEnd - asset.duration) < 1e-9 && el.playbackRate === 1 && !el.muted && !el.loop && el.posterTime === 0);
  ok("video is referenced, not embedded", !JSON.stringify(doc).includes("base64") && JSON.stringify(doc).length < 5000);
  const stored = await idbGet("assets", asset.id);
  ok("original file and a poster still are stored with the asset", stored.type === "video/mp4" && stored.size === fs.statSync(`${FIXTURES}/clip.mp4`).size && stored.posterType === "image/jpeg" && stored.posterSize > 200, JSON.stringify(stored));
  ok("the video is listed under Videos with its length", !!(await page.$(`${L("Add video clip.mp4")} ::-p-text(0:0)`)));
  ok("playback controls appear, stopped", (await playbackState()) === "stopped");

  // ---------- Poster frame in editor and in a PNG export ----------
  await setField("X position", 140);
  await setField("Y position", 375);
  await setField("Width", 800);
  await setField("Height", 600);
  await saved();
  let shown = await showsColor(isRed);
  ok("editor shows the poster frame (red first second)", shown.done, String(shown.c));
  let out = await exportPng("video-test-01.png");
  let center = await pixel(540, 675);
  const outside = await pixel(540, 200);
  ok("export dialog says video is exported as a still for now", out.warning);
  ok("PNG export has the slide size", out.size.width === 1080 && out.size.height === 1350);
  ok("poster frame is visible in the PNG export", isRed(center) && outside.every((v) => v > 245), `${center} | ${outside}`);

  await setField("Poster time", 1.5);
  await saved();
  ok("poster time is stored", (await video()).posterTime === 1.5);
  shown = await showsColor(isBlue);
  ok("editor follows the new poster time (blue second second)", shown.done, String(shown.c));
  out = await exportPng("video-test-01.png");
  center = await pixel(540, 675);
  ok("PNG export uses the exact frame at the poster time", isBlue(center), String(center));
  await page.screenshot({ path: `${SHOTS}/p3-01-poster.png` });

  // ---------- Playback ----------
  await setField("Poster time", 0.5);
  await saved();
  await showsColor(isRed);
  await click(L("Play slide"));
  ok("play switches the controls to playing", (await waitState("playing", 2000)).done);
  shown = await showsColor(isBlue, 5000);
  ok("playing shows live frames (blue arrives although the poster is red)", shown.done && (await playbackState()) === "playing", `${shown.c} ${await playbackState()}`);
  const clock = await page.$eval('[data-testid="playback-clock"]', (n) => n.textContent);
  ok("clock runs against the slide duration", /^0:0[01]\.\d \/ 0:02\.0$/.test(clock), clock);
  ok("playback stops by itself at the end of the slide", (await waitState("stopped")).done);
  shown = await showsColor(isRed);
  ok("stopped slide shows the poster frame again", shown.done, String(shown.c));
  ok("playing never changed the document", (await page.$eval('[data-testid="save-status"]', (n) => n.dataset.status)) === "saved");

  // Trim: starting in the blue part means the first frame shown is already blue.
  await setField("Trim start", 1.2);
  await saved();
  el = await video();
  ok("trim start is stored inside the clip", el.trimStart === 1.2 && el.trimEnd > 1.9);
  await click(L("Play slide"));
  await waitState("playing", 2000);
  await click(L("Pause slide"));
  ok("pause holds playback", (await waitState("paused", 2000)).done);
  shown = await showsColor(isBlue);
  ok("paused frame comes from the trimmed range", shown.done, String(shown.c));
  await clickText("Use current frame as poster");
  await saved();
  el = await video();
  ok("current frame can become the poster", el.posterTime >= 1.2 && el.posterTime <= 2, String(el.posterTime));
  await click(L("Stop and show poster frames"));
  await waitState("stopped", 2000);
  shown = await showsColor(isBlue);
  ok("stop returns to the (new) poster frame", shown.done, String(shown.c));

  // ---------- Properties ----------
  await page.select(L("Speed"), "2");
  await click("label ::-p-text(Mute)");
  await click("label ::-p-text(Loop)");
  await page.select(L("Mask shape"), "ellipse");
  await setField("Border width", 12);
  await click(L("Flip horizontal"));
  await saved();
  el = await video();
  ok(
    "speed, mute, loop, mask, border and flip are stored",
    el.playbackRate === 2 && el.muted && el.loop && el.mask === "ellipse" && el.borderWidth === 12 && el.flipX,
    JSON.stringify({ r: el.playbackRate, m: el.muted, l: el.loop, mask: el.mask, b: el.borderWidth, f: el.flipX }),
  );
  ok("properties panel shows the played length at 2x", /plays 0:00\.[34]/.test(await page.$eval('[data-testid="video-info"]', (n) => n.textContent)));
  out = await exportPng("video-test-01.png");
  center = await pixel(540, 675);
  const corner = await pixel(150, 385);
  ok("mask applies to video like it does to photos", isBlue(center) && corner.every((v) => v > 245), `${center} | ${corner}`);
  await click(L("Play slide"));
  ok("a muted, looping, fast clip still plays to the end of the slide", (await waitState("playing", 2000)).done && (await waitState("stopped")).done);

  // ---------- Undo, slide change, reload ----------
  await click(L("Play slide"));
  await waitState("playing", 2000);
  await click('ol[aria-label="Slides"] > li:nth-child(2) button');
  ok("leaving the slide removes the playback controls", (await until(async () => ({ done: (await playbackState()) === "absent" }), 3000)).done);
  await click('ol[aria-label="Slides"] > li:nth-child(1) button');
  ok("coming back finds the slide stopped", (await waitState("stopped", 3000)).done);

  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  shown = await showsColor(isBlue, 8000);
  ok("video and poster frame survive a reload", shown.done && (await video()).assetId === asset.id, String(shown.c));
  const thumb = await page.$eval('ol[aria-label="Slides"] > li:nth-child(1) img', (img) => img.naturalWidth).catch(() => 0);
  ok("slide thumbnail is rendered for the video slide", thumb > 0);

  // ---------- WebM ----------
  await click('ol[aria-label="Slides"] > li:nth-child(2) button');
  await (await page.$('[data-testid="video-input"]')).uploadFile(`${FIXTURES}/clip.webm`);
  await saved();
  doc = await readDoc();
  const webm = doc.assets.find((a) => a.mime === "video/webm");
  ok("WebM is imported by signature with its duration", !!webm && Math.abs(webm.duration - 2) < 0.2 && doc.slides[1].elements[0]?.type === "video", JSON.stringify(webm));
  shown = await showsColor(isRed, 8000);
  ok("WebM poster frame is drawn", shown.done, String(shown.c));
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await saved();
  ok("importing a video is one undo step", (await readDoc()).slides[1].elements.length === 0);

  // ---------- Cover crop and flip, checked in pixels ----------
  await (await page.$('[data-testid="video-input"]')).uploadFile(`${FIXTURES}/sides.mp4`);
  await saved();
  // A square frame crops the 4:3 clip at its sides; the red / blue border stays in the middle.
  await setField("X position", 240);
  await setField("Y position", 375);
  await setField("Width", 600);
  await setField("Height", 600);
  await saved();
  await exportPng("video-test-02.png");
  let left = await pixel(300, 675);
  let right = await pixel(780, 675);
  ok("video fills its frame without distortion (left red, right blue)", isRed(left) && isBlue(right) && isRed(await pixel(520, 400)) && isBlue(await pixel(560, 950)), `${left} | ${right}`);
  await click(L("Flip horizontal"));
  await saved();
  await exportPng("video-test-02.png");
  left = await pixel(300, 675);
  right = await pixel(780, 675);
  ok("flip horizontal mirrors the video in the export", isBlue(left) && isRed(right), `${left} | ${right}`);
  shown = await until(async () => ((c) => ({ done: isBlue(c), c }))(await screenColor(300, 675)));
  ok("and in the editor", shown.done, String(shown.c));
  await click(L("Play slide"));
  await waitState("playing", 2000);
  shown = await until(async () => ((c) => ({ done: isBlue(c), c }))(await screenColor(300, 675)), 600);
  ok("live frames are flipped the same way as the poster", shown.done && isRed(await screenColor(780, 675)), String(shown.c));
  await waitState("stopped");
  await page.screenshot({ path: `${SHOTS}/p3-02-end.png` });

  // ---------- A browser that loads no frame until asked (iOS Safari), simulated ----------
  // On iOS a <video> that is not playing stops at its metadata: no "loadeddata", readyState 1,
  // until something seeks it or plays it. Chrome is made to behave the same way here.
  const ios = await browser.newPage();
  await ios.setViewport({ width: 1440, height: 900 });
  ios.on("pageerror", (e) => pageErrors.push(`[lazy] ${e}`));
  await ios.evaluateOnNewDocument(() => {
    const asked = new WeakSet();
    const proto = HTMLMediaElement.prototype;
    const readyState = Object.getOwnPropertyDescriptor(proto, "readyState");
    Object.defineProperty(proto, "readyState", { get() { return asked.has(this) ? readyState.get.call(this) : Math.min(readyState.get.call(this), 1); } });
    const currentTime = Object.getOwnPropertyDescriptor(proto, "currentTime");
    Object.defineProperty(proto, "currentTime", { get: currentTime.get, set(v) { asked.add(this); currentTime.set.call(this, v); } });
    const play = proto.play;
    proto.play = function () { asked.add(this); return play.call(this); };
    const createElement = document.createElement.bind(document);
    document.createElement = (tag, ...rest) => {
      const el = createElement(tag, ...rest);
      if (String(tag).toLowerCase() === "video") {
        for (const type of ["loadeddata", "canplay", "canplaythrough"]) {
          el.addEventListener(type, (e) => !asked.has(el) && e.stopImmediatePropagation(), true);
        }
      }
      return el;
    };
  });
  await ios.goto(BASE, { waitUntil: "networkidle0" });
  await (await ios.waitForSelector("button ::-p-text(New project)", { visible: true })).click();
  await ios.type("#np-name", "Lazy Video");
  await Promise.all([ios.waitForNavigation({ waitUntil: "networkidle0" }), (await ios.waitForSelector("button ::-p-text(Create project)")).click()]);
  await ios.waitForSelector('[data-testid="canvas-host"] canvas');
  const importStarted = Date.now();
  await (await ios.$('[data-testid="video-input"]')).uploadFile(`${FIXTURES}/clip.mp4`);
  const lazy = await until(async () => {
    const alert = await ios.$eval('[role="alert"]', (n) => n.textContent).catch(() => null);
    const listed = !!(await ios.$(L("Add video clip.mp4")));
    return { done: !!alert || listed, alert, listed };
  }, 40000);
  const importMs = Date.now() - importStarted;
  ok("video import works when the browser loads no frame until asked", lazy.listed && !lazy.alert, lazy.alert ?? "");
  ok("and does not sit in a timeout first", importMs < 6000, `${importMs} ms`);
  const lazyAsset = await ios.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open("creative-carousel-studio");
        req.onsuccess = () => {
          const all = req.result.transaction("assets").objectStore("assets").getAll();
          all.onsuccess = () => resolve(all.result.filter((a) => a.name === "clip.mp4").map((a) => ({ duration: a.duration, poster: a.poster?.size ?? 0 })).pop());
        };
      }),
  );
  ok("with duration and a poster still", !!lazyAsset && Math.abs(lazyAsset.duration - 2) < 0.15 && lazyAsset.poster > 200, JSON.stringify(lazyAsset));
  await sleep(1500);
  const lazyShot = await ios.screenshot();
  await decodePng(lazyShot);
  const hostBox = await (await ios.$('[data-testid="canvas-host"]')).boundingBox();
  const lazyCenter = await pixel(hostBox.x + hostBox.width / 2, hostBox.y + hostBox.height / 2);
  ok("and its poster frame is drawn on the canvas", isRed(lazyCenter), String(lazyCenter));
  await (await ios.waitForSelector(L("Play slide"), { visible: true })).click();
  await sleep(1500);
  await decodePng(await ios.screenshot());
  ok("and it plays", isBlue(await pixel(hostBox.x + hostBox.width / 2, hostBox.y + hostBox.height / 2)));
  await ios.close();

  ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (e) {
  console.error("ABORTED:", e.message?.split("\n")[0]);
  await page.screenshot({ path: `${SHOTS}/p3-failure.png` }).catch(() => {});
  results.push({ name: "run completed", pass: false });
  if (pageErrors.length) console.error("page errors:", pageErrors.slice(0, 5));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
