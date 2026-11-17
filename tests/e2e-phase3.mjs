/**
 * Phase 3: video. C1 video as an element (import, poster frame, playback, properties) and
 * C2 timeline (scrub, split, trim, move, zoom, slide length), C3 video export (MP4 per video slide,
 * mixed ZIP, frame-exact content, sound, real-time fallback), C4 background music (import, waveform,
 * fades in the exported sound).
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
 *   heavy.mp4  8 s, 3840x2160, 60 fps, about 20 Mbit/s (a "phone camera" clip):
 *     ffmpeg -f lavfi -i "testsrc2=s=3840x2160:r=60:d=8" -f lavfi -i "sine=frequency=330:duration=8" -c:v libx264 \
 *       -preset ultrafast -b:v 20M -pix_fmt yuv420p -g 60 -movflags +faststart -c:a aac -shortest heavy.mp4
 *   music.wav  3 s tone at constant loudness:  ffmpeg -f lavfi -i "sine=frequency=660:duration=3" -ac 2 -ar 44100 music.wav
 *   music.mp3  the same:  ffmpeg -i music.wav -b:a 128k music.mp3
 *   fake.mp3   any text file with that name
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import JSZip from "jszip";

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
  // A slide with video would be exported as a video file: these checks want the still image.
  if (await page.$('[data-testid="video-export"]')) await clickText("Still image");
  const warning = !!(await page.$('[data-testid="video-warning"]'));
  await clickText("Export 1 slide");
  await page.waitForSelector('[data-testid="export-done"]', { timeout: 60000 });
  const file = path.join(DL, name);
  for (let i = 0; i < 100 && !fs.existsSync(file); i++) await sleep(150);
  const buf = fs.readFileSync(file);
  fs.rmSync(file);
  await clickText("Continue editing");
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
  // captureBeyondViewport would resize the window to the clip for a moment, which flips the app into its phone layout.
  await decodePng(await page.screenshot({ clip: { x: Math.round(p.x) - 2, y: Math.round(p.y) - 2, width: 4, height: 4 }, captureBeyondViewport: false }));
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
  ok("document is schema version 6 with one video element", doc.schemaVersion === 6 && doc.slides[0].elements.length === 1 && el.type === "video" && el.assetId === asset.id);
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
  ok("a video slide can still be exported as an image of its poster frame", out.warning);
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

  // Any video imported earlier can be put into this frame again, without importing it twice.
  doc = await readDoc();
  const earlier = doc.assets.find((a) => a.name === "clip.mp4");
  const options = await page.$$eval(`${L("Video file")} option`, (ns) => ns.map((n) => n.textContent));
  ok("the video frame lists every video imported into the project", options.length === doc.assets.filter((a) => a.mime.startsWith("video/")).length && options.some((o) => o.startsWith("clip.mp4")) && options.some((o) => o.startsWith("sides.mp4")), options.join(" | "));
  await page.select(L("Video file"), earlier.id);
  await saved();
  doc = await readDoc();
  const swapped = doc.slides[1].elements.find((e) => e.type === "video");
  ok("choosing one swaps the file but keeps the frame", swapped.assetId === earlier.id && swapped.width === 600 && swapped.x === 240 && swapped.flipX && swapped.trimStart === 0 && Math.abs(swapped.trimEnd - 2) < 0.1 && doc.assets.filter((a) => a.name === "clip.mp4").length === 1, JSON.stringify([swapped.assetId === earlier.id, swapped.trimEnd, swapped.width]));
  shown = await until(async () => ((c) => ({ done: isRed(c), c }))(await screenColor(300, 675)));
  ok("and the canvas shows the chosen video (all red at its start)", shown.done && isRed(await screenColor(780, 675)), String(shown.c));
  await click(L("Play slide"));
  shown = await until(async () => ((c) => ({ done: isBlue(c), c }))(await screenColor(300, 675)), 5000);
  ok("which then plays", shown.done, String(shown.c));
  await waitState("stopped");
  await page.screenshot({ path: `${SHOTS}/p3-02-end.png` });

  // ---------- C2: timeline ----------
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await clickText("New project");
  await page.type("#np-name", "Timeline Test");
  await setField("Number of slides", 1);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickText("Create project")]);
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  ok("no timeline on a slide without video", !(await page.$('[data-testid="timeline"]')));
  await page.click('[data-category="text"]');
  await clickText("Add a heading");
  await (await page.$('[data-testid="video-input"]')).uploadFile(`${FIXTURES}/clip.mp4`);
  await saved();
  await setField("X position", 140);
  await setField("Y position", 375);
  await setField("Width", 800);
  await setField("Height", 600);
  await saved();
  const videos = async () => (await readDoc()).slides[0].elements.filter((e) => e.type === "video");
  const bars = () => page.$$eval('[data-testid="clip-bar"]', (ns) => ns.map((n) => ({ name: n.getAttribute("aria-label"), start: +n.dataset.start, length: +n.dataset.length, width: n.getBoundingClientRect().width })));
  const ruler = async () => (await page.$('[data-testid="timeline-ruler"]')).boundingBox();
  const seekTo = async (fraction) => {
    const b = await ruler();
    await page.mouse.click(b.x + b.width * fraction, b.y + 8);
  };
  const clockText = () => page.$eval('[data-testid="playback-clock"]', (n) => n.textContent);
  const dragBy = async (selector, dx) => {
    const b = await (await page.waitForSelector(selector, { visible: true })).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.width / 2 + (dx * i) / 8, b.y + b.height / 2);
    await page.mouse.up();
  };
  let tl = await bars();
  ok("timeline shows the clip as a bar of its length", tl.length === 1 && tl[0].start === 0 && Math.abs(tl[0].length - 2) < 0.1, JSON.stringify(tl));
  ok("and the text layer as a full-length overlay bar", (await page.$$eval('[data-testid="overlay-bar"]', (ns) => ns.map((n) => n.textContent.trim()))).join() === "Add a heading");

  await seekTo(0.75);
  shown = await showsColor(isBlue);
  ok("pressing the ruler moves the playhead and shows that frame (1.5 s is blue)", shown.done && (await playbackState()) === "paused" && /^0:01\.[45] /.test(await clockText()), `${shown.c} ${await clockText()}`);
  await seekTo(0.25);
  shown = await showsColor(isRed);
  ok("scrubbing back shows the earlier frame (0.5 s is red)", shown.done, String(shown.c));
  const rb = await ruler();
  await page.mouse.move(rb.x + rb.width * 0.2, rb.y + 8);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(rb.x + rb.width * (0.2 + 0.06 * i), rb.y + 8);
  await page.mouse.up();
  shown = await showsColor(isBlue);
  ok("dragging along the ruler scrubs", shown.done && /^0:01\.[56] /.test(await clockText()), `${shown.c} ${await clockText()}`);
  ok("scrubbing never changes the document", (await videos()).length === 1 && (await page.$eval('[data-testid="save-status"]', (n) => n.dataset.status)) === "saved");

  // Split in the middle: the red half and the blue half become two clips that follow each other.
  await seekTo(0.5);
  await sleep(200);
  await click(L("Split clip at playhead"));
  await saved();
  let vs = await videos();
  ok(
    "split creates two clips that meet at the playhead",
    vs.length === 2 && vs[0].start === 0 && Math.abs(vs[0].trimEnd - 1) < 0.02 && Math.abs(vs[1].start - 1) < 0.02 && Math.abs(vs[1].trimStart - vs[0].trimEnd) < 1e-9 && Math.abs(vs[1].trimEnd - 2) < 0.1 && vs[1].assetId === vs[0].assetId,
    JSON.stringify(vs.map((v) => [v.name, v.start, v.trimStart, v.trimEnd])),
  );
  tl = await bars();
  ok("both halves are bars, the second starts where the first ends", tl.length === 2 && tl.some((b) => b.name === "Clip clip (2)" && Math.abs(b.start - 1) < 0.02) && Math.abs(tl[0].width - tl[1].width) < 4, JSON.stringify(tl));
  ok("no second asset was created", (await readDoc()).assets.length === 1);
  await seekTo(0.25);
  shown = await showsColor(isRed);
  ok("a clip is only on screen while it plays (the blue half is hidden at 0.5 s)", shown.done, String(shown.c));
  await seekTo(0.8);
  shown = await showsColor(isBlue);
  ok("and the second half shows after the cut", shown.done, String(shown.c));
  await click(L("Stop and show poster frames"));
  await waitState("stopped", 2000);
  await click(L("Play slide"));
  const sawRed = await showsColor(isRed, 1500);
  const sawBlue = await showsColor(isBlue, 5000);
  ok("playback runs through the cut: first half, then second half", sawRed.done && sawBlue.done, `${sawRed.c} | ${sawBlue.c}`);
  ok("and stops at the end of the last clip", (await waitState("stopped")).done);

  // Trim the second half from its right edge: a quarter of the ruler is 0.5 s.
  const quarter = (await ruler()).width / 4;
  await dragBy(L("Trim end of clip (2)"), -quarter);
  await saved();
  vs = await videos();
  ok("dragging a trim handle trims the clip", Math.abs(vs[1].trimEnd - 1.5) < 0.06 && Math.abs(vs[1].trimStart - 1) < 0.02 && vs[0].trimEnd < 1.02, JSON.stringify(vs.map((v) => [v.trimStart, v.trimEnd])));
  ok("the slide got shorter with it", / \/ 0:01\.[45]$/.test(await clockText()), await clockText());
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await saved();
  vs = await videos();
  ok("a whole trim drag is one undo step", vs.length === 2 && Math.abs(vs[1].trimEnd - 2) < 0.1, String(vs[1]?.trimEnd));

  // After trimming, the timeline keeps showing what was cut away, so the handle can be dragged back out.
  await dragBy(L("Trim end of clip (2)"), -quarter);
  await saved();
  const rulerNow = await ruler();
  tl = await bars();
  const trimmed = tl.find((b) => b.name === "Clip clip (2)");
  const handleBox = await (await page.$(L("Trim end of clip (2)"))).boundingBox();
  ok(
    "a trimmed clip does not fill the timeline again: there is room right of its handle",
    Math.abs(rulerNow.width - quarter * 4) < 4 && Math.abs(trimmed.width - quarter) < 6 && rulerNow.x + rulerNow.width - (handleBox.x + handleBox.width) > quarter * 0.8 && !!(await page.$('[data-testid="clip-reach"]')),
    `ruler ${rulerNow.width.toFixed(0)}, bar ${trimmed.width.toFixed(0)}`,
  );
  await dragBy(L("Trim end of clip (2)"), quarter);
  await saved();
  vs = await videos();
  ok("and the same handle stretches the clip back to its full length", Math.abs(vs[1].trimEnd - 2) < 0.06, String(vs[1].trimEnd));
  await dragBy(L("Trim end of clip (2)"), quarter * 2);
  await saved();
  ok("but never past the end of the source", Math.abs((await videos())[1].trimEnd - 2) < 0.06);

  // Trim the first half from its left edge: start and trimStart move together, the cut stays.
  const span2 = (await ruler()).width / 2; // pixels per second
  await dragBy(L("Trim start of clip"), span2 * 0.4);
  await saved();
  vs = await videos();
  ok("trimming the left edge keeps the right edge in place", Math.abs(vs[0].start - 0.4) < 0.05 && Math.abs(vs[0].trimStart - 0.4) < 0.05 && Math.abs(vs[0].start + (vs[0].trimEnd - vs[0].trimStart) - 1) < 0.02, JSON.stringify([vs[0].start, vs[0].trimStart, vs[0].trimEnd]));

  // Move the second half later: a gap opens and the slide gets longer.
  const before = (await videos())[1].start;
  await dragBy(L("Clip clip (2)"), span2 * 0.3);
  await saved();
  vs = await videos();
  ok("dragging a clip moves it in time", Math.abs(vs[1].start - before - 0.3) < 0.08 && Math.abs(vs[1].trimStart - 1) < 0.02, `${before} -> ${vs[1].start}`);
  await setField("Starts at", 1);
  await saved();
  ok("the start time can also be typed", (await videos())[1].start === 1);

  // Zoom
  const fitWidth = (await bars())[0].width;
  await click(L("Zoom timeline in"));
  await sleep(150);
  const zoomed = (await bars())[0].width;
  const scrolls = await page.$eval('[data-testid="timeline-scroll"]', (n) => n.scrollWidth > n.clientWidth + 10);
  ok("zoom makes the bars longer and the timeline scrollable", Math.abs(zoomed / fitWidth - 1.6) < 0.05 && scrolls, `${fitWidth} -> ${zoomed}`);
  await click(L("Zoom timeline out"));

  // Slide length
  await click("label ::-p-text(Fixed slide length)");
  await saved();
  let slideDoc = (await readDoc()).slides[0];
  ok("fixing the slide length starts from the current length", Math.abs(slideDoc.duration - 2) < 0.1, String(slideDoc.duration));
  await setField("Slide length", 3);
  await saved();
  slideDoc = (await readDoc()).slides[0];
  ok("a manual slide length is stored and shown", slideDoc.duration === 3 && / \/ 0:03\.0$/.test(await clockText()), `${slideDoc.duration} ${await clockText()}`);
  await click("label ::-p-text(Fixed slide length)");
  await saved();
  ok("unfixing follows the clips again", (await readDoc()).slides[0].duration === undefined && / \/ 0:02\.0$/.test(await clockText()), await clockText());

  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="timeline"]');
  tl = await bars();
  ok("the edited timeline survives a reload", tl.length === 2 && (await readDoc()).schemaVersion === 6, JSON.stringify(tl));
  await page.screenshot({ path: `${SHOTS}/p3-03-timeline.png` });

  // ---------- C3: video export ----------
  /** Wait for a downloaded file and return its bytes. */
  const download = async (name, timeout = 120000) => {
    const file = path.join(DL, name);
    for (let i = 0; i < timeout / 150 && !fs.existsSync(file); i++) await sleep(150);
    const buf = fs.readFileSync(file);
    fs.rmSync(file);
    return buf;
  };
  /** Open a video file in the browser and report its size, length and the color of some frames. */
  const inspectVideo = (buf, mime, times, on = page) =>
    on.evaluate(
      async (b64, type, at) => {
        const blob = await (await fetch(`data:${type};base64,${b64}`)).blob();
        const v = document.createElement("video");
        v.muted = true;
        v.src = URL.createObjectURL(blob);
        await new Promise((res, rej) => ((v.onloadeddata = res), (v.onerror = () => rej(new Error("cannot open the exported video")))));
        if (!Number.isFinite(v.duration)) {
          // Recorded files have no length in their header until the browser has looked for the end.
          v.currentTime = 1e7;
          await new Promise((res) => (v.ondurationchange = res));
        }
        const c = new OffscreenCanvas(v.videoWidth, v.videoHeight);
        const ctx = c.getContext("2d", { willReadFrequently: true });
        const colors = [];
        for (const t of at) {
          v.currentTime = Math.min(t, v.duration - 0.02);
          await new Promise((res) => (v.onseeked = res));
          // The frame a seek lands on can arrive a moment after "seeked" (and the callback may never come for a detached video).
          await new Promise((res) => (v.requestVideoFrameCallback?.(res), setTimeout(res, 200)));
          ctx.drawImage(v, 0, 0);
          colors.push({
            center: Array.from(ctx.getImageData(v.videoWidth / 2, v.videoHeight / 2, 1, 1).data),
            top: Array.from(ctx.getImageData(v.videoWidth / 2, 20, 1, 1).data),
          });
        }
        return { width: v.videoWidth, height: v.videoHeight, duration: v.duration, colors };
      },
      Buffer.from(buf).toString("base64"),
      mime,
      times,
    );
  /** Loudness (RMS) of slices of the sound in an exported file, decoded in the browser. */
  const loudness = (buf, slices) =>
    page.evaluate(
      async (b64, parts) => {
        const data = await (await fetch(`data:video/mp4;base64,${b64}`)).arrayBuffer();
        const audio = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(data);
        const ch = audio.getChannelData(0);
        return parts.map(([from, to]) => {
          let sum = 0;
          const a = Math.floor(from * audio.sampleRate);
          const b = Math.min(ch.length, Math.floor(to * audio.sampleRate));
          for (let i = a; i < b; i++) sum += ch[i] * ch[i];
          return Math.sqrt(sum / Math.max(1, b - a));
        });
      },
      Buffer.from(buf).toString("base64"),
      slices,
    );
  const isMp4 = (buf) => buf.subarray(4, 8).toString("latin1") === "ftyp";
  const isJpeg = (buf) => buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const hasBox = (buf, name) => buf.includes(Buffer.from(name, "latin1"));
  const runExport = async (label) => {
    await clickText(label);
    await Promise.race([
      page.waitForSelector('[data-testid="export-done"]', { timeout: 180000 }),
      page.waitForSelector('[role="dialog"] [role="alert"]', { timeout: 180000 }).then(async (n) => {
        throw new Error(`export failed: ${await n.evaluate((x) => x.textContent)}`);
      }),
    ]);
  };

  await page.goto(BASE, { waitUntil: "networkidle0" });
  await clickText("New project");
  await page.type("#np-name", "Mixed Export");
  await setField("Number of slides", 3);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickText("Create project")]);
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await (await page.$('[data-testid="image-input"]')).uploadFile(`${FIXTURES}/photo-a.jpg`);
  await saved();
  await click('ol[aria-label="Slides"] > li:nth-child(2) button');
  await (await page.$('[data-testid="video-input"]')).uploadFile(`${FIXTURES}/clip.mp4`);
  await saved();
  await setField("X position", 140);
  await setField("Y position", 375);
  await setField("Width", 800);
  await setField("Height", 600);
  await saved();

  await clickText("Export");
  await page.waitForSelector('[data-testid="video-export"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="video-note"]')?.textContent.includes("Checking"));
  const note = await page.$eval('[data-testid="video-note"]', (n) => n.textContent);
  const summary = await page.$eval('[data-testid="video-summary"]', (n) => n.textContent);
  const soundOptions = await page.$$eval('[role="radiogroup"][aria-label="Sound"] [role="radio"]', (ns) => ns.map((n) => n.textContent));
  ok("export dialog says what this browser will produce", /^MP4 \(H\.264\)/.test(note) && summary.startsWith("1080 × 1350, 30 fps"), `${note} | ${summary}`);
  ok("and offers sound or no sound", soundOptions.join() === "With sound,No sound" && note.includes("AAC sound"), soundOptions.join());
  ok("it announces a mixed ZIP", !!(await page.$("p ::-p-text(2 JPG and 1 video)")));
  await runExport("Export 3 slides");
  const zipBuf = await download("mixed-export-slides.zip");
  await clickText("Continue editing");
  const zip = await JSZip.loadAsync(zipBuf);
  const names = Object.keys(zip.files);
  ok("mixed project exports one ordered ZIP: photo, video, photo", names.join() === "mixed-export-01.jpg,mixed-export-02.mp4,mixed-export-03.jpg", names.join());
  const entries = await Promise.all(names.map((n) => zip.files[n].async("nodebuffer")));
  ok("file types match their names", isJpeg(entries[0]) && isMp4(entries[1]) && isJpeg(entries[2]));
  ok("the MP4 has an H.264 track and an AAC sound track", hasBox(entries[1], "avc1") && hasBox(entries[1], "mp4a") && !hasBox(entries[1], "Opus"));
  const clipSound = await loudness(entries[1], [[0.3, 1.7]]);
  ok("and the clip's own sound is really audible in it", clipSound[0] > 0.02, clipSound[0].toFixed(4));
  let mp4 = await inspectVideo(entries[1], "video/mp4", [0, 0.9, 1.1, 1.9]);
  ok("MP4 has the slide size", mp4.width === 1080 && mp4.height === 1350, `${mp4.width}x${mp4.height}`);
  ok("MP4 duration matches the slide (2 s)", Math.abs(mp4.duration - 2) < 0.1, String(mp4.duration));
  ok(
    "MP4 frames are the slide at that time: red, red, then blue, blue, on the white slide",
    isRed(mp4.colors[0].center) && isRed(mp4.colors[1].center) && isBlue(mp4.colors[2].center) && isBlue(mp4.colors[3].center) && mp4.colors.every((c) => c.top.every((v) => v > 240)),
    mp4.colors.map((c) => c.center.slice(0, 3).join("/")).join(" "),
  );

  // Timeline edits reach the export: trimmed start, 720p, no sound.
  await click('[data-testid="canvas-host"]').catch(() => {});
  await click(L("Clip clip"));
  await setField("Trim start", 1.2);
  await saved();
  await clickText("Export");
  await clickText("Current");
  await clickText("720p");
  await clickText("No sound");
  ok("the dialog shows the smaller size", (await page.$eval('[data-testid="video-summary"]', (n) => n.textContent)).startsWith("720 × 900"));
  await runExport("Export 1 slide");
  const single = await download("mixed-export-02.mp4");
  await clickText("Continue editing");
  mp4 = await inspectVideo(single, "video/mp4", [0, 0.7]);
  ok("a single video slide downloads as one MP4 at 720p", isMp4(single) && mp4.width === 720 && mp4.height === 900, `${mp4.width}x${mp4.height}`);
  ok("trim reaches the export: 0.8 s long and blue from the first frame", Math.abs(mp4.duration - 0.8) < 0.1 && isBlue(mp4.colors[0].center) && isBlue(mp4.colors[1].center), `${mp4.duration} ${mp4.colors[0].center}`);
  ok("choosing no sound leaves the sound track out", !hasBox(single, "mp4a"));

  // A split clip exports as one continuous video.
  await setField("Trim start", 0);
  await saved();
  await seekTo(0.5);
  await sleep(200);
  await click(L("Split clip at playhead"));
  await saved();
  await clickText("Export");
  await clickText("Current");
  await runExport("Export 1 slide");
  mp4 = await inspectVideo(await download("mixed-export-02.mp4"), "video/mp4", [0.5, 0.95, 1.05, 1.5]);
  await clickText("Continue editing");
  ok(
    "a split clip exports seamlessly across the cut",
    Math.abs(mp4.duration - 2) < 0.1 && isRed(mp4.colors[0].center) && isRed(mp4.colors[1].center) && isBlue(mp4.colors[2].center) && isBlue(mp4.colors[3].center),
    `${mp4.duration} ${mp4.colors.map((c) => c.center.slice(0, 3).join("/")).join(" ")}`,
  );

  // ---------- C4: background music ----------
  const slide2 = async () => (await readDoc()).slides[1];
  // Silence the clips so that everything heard in the export is the music.
  for (const name of ["Clip clip", "Clip clip (2)"]) {
    await click(L(name));
    await click("label ::-p-text(Mute)");
  }
  await saved();
  ok("both clips are muted", (await slide2()).elements.filter((e) => e.type === "video").every((e) => e.muted));

  await (await page.$('[data-testid="music-input"]')).uploadFile(`${FIXTURES}/fake.mp3`);
  await page.waitForSelector('[data-testid="music-controls"] [role="alert"] ::-p-text(not a supported music file)');
  ok("a text file disguised as .mp3 is rejected", (await slide2()).audio === undefined);
  await (await page.$('[data-testid="music-input"]')).uploadFile(`${FIXTURES}/music.wav`);
  await page.waitForSelector('[data-testid="music-bar"]');
  await saved();
  doc = await readDoc();
  const song = doc.assets.find((a) => a.mime === "audio/wav");
  let track = doc.slides[1].audio;
  ok("music becomes the slide's track and plays the whole file", !!song && Math.abs(song.duration - 3) < 0.1 && track?.assetId === song.id && track.start === 0 && track.trimStart === 0 && Math.abs(track.trimEnd - 3) < 0.1 && !track.loop, JSON.stringify(track));
  const storedPeaks = await page.evaluate(
    (id) =>
      new Promise((resolve) => {
        const req = indexedDB.open("creative-carousel-studio");
        req.onsuccess = () => {
          const get = req.result.transaction("assets").objectStore("assets").get(id);
          get.onsuccess = () => resolve({ type: get.result.blob.type, bars: get.result.peaks?.length ?? 0, max: Math.max(...(get.result.peaks ?? [0])) });
        };
      }),
    song.id,
  );
  ok("the original file and a waveform are stored", storedPeaks.type === "audio/wav" && storedPeaks.bars === 240 && storedPeaks.max > 0.05, JSON.stringify(storedPeaks));
  const bar = await page.$eval('[data-testid="music-bar"]', (n) => ({ start: +n.dataset.start, length: +n.dataset.length }));
  const drawn = await page.$eval('[data-testid="music-waveform"]', (c) => c.dataset.hasPeaks === "yes" && c.getContext("2d").getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0));
  ok("timeline shows the music as a bar cut at the end of the slide, with its waveform", bar.start === 0 && Math.abs(bar.length - 2) < 0.1 && drawn, JSON.stringify(bar));
  ok("music is not listed as a photo", !(await page.$(L("Add music.wav"))) && !(await page.$('aside[aria-label="Insert"] ::-p-text(Missing)')));

  await setField("Fade in", 1);
  await saved();
  ok("fade in is stored", (await slide2()).audio.fadeIn === 1);
  await click(L("Play slide"));
  ok("a slide with music still plays to its end", (await waitState("playing", 2000)).done && (await waitState("stopped")).done);

  await clickText("Export");
  await clickText("Current");
  await runExport("Export 1 slide");
  let withMusic = await download("mixed-export-02.mp4");
  await clickText("Continue editing");
  let levels = await loudness(withMusic, [[0.02, 0.2], [1.2, 1.8]]);
  ok("exported video carries the music as AAC (clips are muted)", hasBox(withMusic, "mp4a") && levels[1] > 0.02, levels.map((v) => v.toFixed(4)).join(" "));
  ok("with the fade in: quiet at the start, full after one second", levels[0] < levels[1] * 0.35, levels.map((v) => v.toFixed(4)).join(" "));

  // Start the music one second into the slide: the first second of the export is silent.
  await dragBy('[data-testid="music-bar"]', (await ruler()).width / 2);
  await saved();
  track = (await slide2()).audio;
  ok("dragging the music bar moves it in time", Math.abs(track.start - 1) < 0.08, String(track.start));
  await setField("Fade in", 0);
  await saved();
  await clickText("Export");
  await clickText("Current");
  await runExport("Export 1 slide");
  withMusic = await download("mixed-export-02.mp4");
  await clickText("Continue editing");
  levels = await loudness(withMusic, [[0.1, 0.8], [1.3, 1.9]]);
  ok("the export is silent until the music starts", levels[0] < 0.003 && levels[1] > 0.02, levels.map((v) => v.toFixed(4)).join(" "));

  await click(L("Remove music"));
  await saved();
  ok("music can be removed", (await slide2()).audio === undefined && !(await page.$('[data-testid="music-row"]')));
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await saved();
  ok("and removing it is undoable", (await slide2()).audio?.assetId === song.id && !!(await page.$('[data-testid="music-row"]')));
  await click(L("Remove music"));
  await saved();
  // MP3 is recognised by its own signature.
  await (await page.$('[data-testid="music-input"]')).uploadFile(`${FIXTURES}/music.mp3`);
  await page.waitForSelector('[data-testid="music-bar"]');
  await saved();
  doc = await readDoc();
  ok("MP3 is imported by signature with its length", doc.assets.some((a) => a.mime === "audio/mpeg" && Math.abs(a.duration - 3) < 0.2) && doc.schemaVersion === 6);
  await click(L("Remove music"));
  await saved();

  // ---------- Heavy source: a light preview copy, exports from the original ----------
  await click('ol[aria-label="Slides"] > li:nth-child(3) button');
  await (await page.$('[data-testid="video-input"]')).uploadFile(`${FIXTURES}/heavy.mp4`);
  await page.waitForSelector(L("Add video heavy.mp4"), { timeout: 60000 });
  const sawStatus = await page.waitForSelector('[data-testid="proxy-status"]', { timeout: 15000 }).then(() => true, () => false);
  await page.waitForFunction(() => !document.querySelector('[data-testid="proxy-status"]'), { timeout: 120000 });
  await saved();
  doc = await readDoc();
  const heavy = doc.assets.find((a) => a.name === "heavy.mp4");
  const heavyStored = await page.evaluate(
    (id) =>
      new Promise((resolve) => {
        const req = indexedDB.open("creative-carousel-studio");
        req.onsuccess = () => {
          const get = req.result.transaction("assets").objectStore("assets").get(id);
          get.onsuccess = () => resolve({ original: get.result.blob.size, proxy: get.result.proxy?.size ?? 0, proxyType: get.result.proxy?.type });
        };
      }),
    heavy.id,
  );
  ok("a heavy video announces that a lighter copy is being prepared", sawStatus);
  ok("the original is kept and a much smaller proxy is stored next to it", heavy.width === 3840 && heavyStored.original === fs.statSync(`${FIXTURES}/heavy.mp4`).size && heavyStored.proxy > 10000 && heavyStored.proxy < heavyStored.original / 3, JSON.stringify(heavyStored));
  const smallStored = await idbGet("assets", doc.assets.find((a) => a.name === "clip.mp4").id);
  ok("a small video gets no proxy", !!smallStored && !(await page.evaluate(
    (id) => new Promise((resolve) => { const req = indexedDB.open("creative-carousel-studio"); req.onsuccess = () => { const get = req.result.transaction("assets").objectStore("assets").get(id); get.onsuccess = () => resolve(!!get.result.proxy); }; }),
    doc.assets.find((a) => a.name === "clip.mp4").id,
  )));
  await click(L("Play slide"));
  await waitState("playing", 3000);
  await sleep(600);
  const liveSize = await page.evaluate(() => [...document.querySelectorAll("video")].map((v) => `${v.videoWidth}x${v.videoHeight}`).join());
  ok("the editor plays the 720p proxy", liveSize === "1280x720", liveSize);
  await click(L("Stop and show poster frames"));
  await waitState("stopped", 3000);
  ok("the document still points at the original only", doc.slides[2].elements[0].assetId === heavy.id && doc.assets.filter((a) => a.name === "heavy.mp4").length === 1);
  await clickText("Export");
  await clickText("Current");
  await runExport("Export 1 slide");
  const heavyOut = await download("mixed-export-03.mp4");
  await clickText("Continue editing");
  mp4 = await inspectVideo(heavyOut, "video/mp4", [1]);
  ok("and the export of that slide is full size, 8 s, with sound", mp4.width === 1080 && mp4.height === 1350 && Math.abs(mp4.duration - 8) < 0.15 && hasBox(heavyOut, "mp4a"), `${mp4.width}x${mp4.height} ${mp4.duration}`);
  await click('ol[aria-label="Slides"] > li:nth-child(2) button');
  const mixedUrl = page.url();

  // Without WebCodecs the slide is recorded in real time instead, and the dialog says so.
  const old = await browser.newPage();
  await old.setViewport({ width: 1440, height: 900 });
  old.on("pageerror", (e) => pageErrors.push(`[no webcodecs] ${e}`));
  await old.evaluateOnNewDocument(() => {
    delete globalThis.VideoEncoder;
    delete globalThis.AudioEncoder;
  });
  await (await old.createCDPSession()).send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL });
  await old.goto(mixedUrl, { waitUntil: "networkidle0" });
  await old.waitForSelector('[data-testid="canvas-host"] canvas');
  await (await old.waitForSelector('ol[aria-label="Slides"] > li:nth-child(2) button')).click();
  await old.bringToFront();
  await (await old.waitForSelector("button ::-p-text(Export)", { visible: true })).click();
  await (await old.waitForSelector("button ::-p-text(Current)", { visible: true })).click();
  await old.waitForFunction(() => document.querySelector('[data-testid="video-note"]')?.textContent.includes("real time"), { timeout: 10000 }).catch(() => {});
  const fallbackNote = await old.$eval('[data-testid="video-note"]', (n) => n.textContent);
  ok("without WebCodecs the dialog announces a real-time recording without sound", /recorded in real time as (MP4|WebM), without sound/.test(fallbackNote), fallbackNote);
  const recStart = Date.now();
  await (await old.waitForSelector("button ::-p-text(Export 1 slide)")).click();
  await old.waitForSelector('[data-testid="export-done"]', { timeout: 60000 });
  const recSeconds = (Date.now() - recStart) / 1000;
  const recName = fs.readdirSync(DL).find((f) => f.startsWith("mixed-export-02.")) ?? (await sleep(1500), fs.readdirSync(DL).find((f) => f.startsWith("mixed-export-02.")));
  const rec = await download(recName);
  const recorded = await inspectVideo(rec, recName.endsWith(".mp4") ? "video/mp4" : "video/webm", [0.3, 1.6], old);
  ok("the fallback records a playable file of the slide", recorded.width === 1080 && recorded.height === 1350 && isRed(recorded.colors[0].center) && isBlue(recorded.colors[1].center), `${recName} ${recorded.width}x${recorded.height} ${recorded.colors.map((c) => c.center.slice(0, 3).join("/")).join(" ")}`);
  ok("in about the time the slide plays", recSeconds > 1.8 && Math.abs(recorded.duration - 2) < 0.6, `${recSeconds.toFixed(1)} s, file ${recorded.duration}`);
  await old.close();
  await page.bringToFront();

  // ---------- Seamless project: one slide plays at a time ----------
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await clickText("New project");
  await page.type("#np-name", "Seamless Video");
  await setField("Number of slides", 3);
  await clickText("Seamless");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickText("Create project")]);
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await (await page.$('[data-testid="video-input"]')).uploadFile(`${FIXTURES}/clip.mp4`);
  await saved();
  await click('ol[aria-label="Slides"] > li:nth-child(2) button');
  await (await page.$('[data-testid="video-input"]')).uploadFile(`${FIXTURES}/sides.mp4`);
  await saved();
  doc = await readDoc();
  const pano = doc.panorama.elements.filter((e) => e.type === "video");
  const slideOf = (e) => Math.floor((e.x + e.width / 2) / doc.width);
  ok("two videos sit on two different slides of one panorama", doc.mode === "seamless" && pano.length === 2 && slideOf(pano[0]) === 0 && slideOf(pano[1]) === 1, JSON.stringify(pano.map((e) => [e.name, e.x, slideOf(e)])));
  const timelineState = async () => ({
    slide: await page.$eval('[data-testid="timeline-slide"]', (n) => n.textContent).catch(() => null),
    bars: (await bars()).map((b) => b.name).join(),
    clock: await clockText().catch(() => null),
  });
  let ts = await timelineState();
  ok("the timeline is the timeline of the selected video's slide only", ts.slide === "Slide 2" && ts.bars === "Clip sides" && / \/ 0:01\.0$/.test(ts.clock), JSON.stringify(ts));
  const liveVideos = () => page.evaluate(() => [...document.querySelectorAll("video")].map((v) => ({ playing: !v.paused, length: Number(v.duration.toFixed(1)) })));
  await click(L("Play slide"));
  await waitState("playing", 3000);
  await sleep(400);
  let live = await liveVideos();
  ok("play starts only that slide's video, not every video of the panorama", live.length === 1 && live[0].length === 1, JSON.stringify(live));
  await waitState("stopped");
  // The other slide: its own clip, its own length.
  await click('ol[aria-label="Slides"] > li:nth-child(1) button');
  await page.keyboard.press("Escape");
  ts = await until(async () => ((t) => ({ done: t.slide === "Slide 1", ...t }))(await timelineState()), 3000);
  ok("moving to the other slide shows that slide's clip and length", ts.slide === "Slide 1" && ts.bars === "Clip clip" && / \/ 0:02\.0$/.test(ts.clock), JSON.stringify(ts));
  await click(L("Play slide"));
  await waitState("playing", 3000);
  await sleep(400);
  live = await liveVideos();
  ok("and plays that one alone", live.length === 1 && live[0].length === 2, JSON.stringify(live));
  await click('ol[aria-label="Slides"] > li:nth-child(3) button');
  ok("a running playback ends when another slide is chosen", (await until(async () => ({ done: (await playbackState()) !== "playing" }), 3000)).done && (await liveVideos()).length === 0);

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
    // ... and while it plays, a long video reports readyState 2 ("not enough data"), although it plays fine.
    Object.defineProperty(proto, "readyState", {
      get() {
        const real = readyState.get.call(this);
        return !asked.has(this) ? Math.min(real, 1) : !this.paused ? Math.min(real, 2) : real;
      },
    });
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
  await ios.evaluate(() => {
    globalThis.__rewinds = 0;
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime");
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", { get: d.get, set(v) { if (v < d.get.call(this) - 0.2) globalThis.__rewinds++; d.set.call(this, v); } });
  });
  const playStarted = Date.now();
  await (await ios.waitForSelector(L("Play slide"), { visible: true })).click();
  await sleep(1500);
  await decodePng(await ios.screenshot());
  ok("and it plays", isBlue(await pixel(hostBox.x + hostBox.width / 2, hostBox.y + hostBox.height / 2)));
  await ios.waitForSelector('[data-testid="playback-bar"][data-state="stopped"]', { timeout: 30000 }).catch(() => {});
  const playMs = Date.now() - playStarted;
  const rewinds = await ios.evaluate(() => globalThis.__rewinds);
  ok("at normal speed although the browser reports too little buffered data (2 s clip)", playMs < 3500, `${playMs} ms`);
  ok("and the video is never rewound while it plays (no repeated sound)", rewinds === 0, String(rewinds));
  await ios.close();

  ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (e) {
  console.error("ABORTED:", e.message?.split("\n")[0], "\n", (e.stack || "").split("\n").filter((l) => l.includes("e2e-phase3")).slice(0, 3).join("\n"));
  await page.screenshot({ path: `${SHOTS}/p3-failure.png` }).catch(() => {});
  results.push({ name: "run completed", pass: false });
  if (pageErrors.length) console.error("page errors:", pageErrors.slice(0, 5));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
