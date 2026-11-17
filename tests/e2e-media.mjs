/**
 * Media in frames and video export sound: New project only on the Projects page, the Photo
 * Journal template library, video crop (same controls and geometry as photos, in the editor,
 * still exports and MP4 exports), videos in empty frames (file picker, double-tap picker, drop),
 * and the sound of exported videos (present, in sync, from files the browser's decodeAudioData
 * cannot handle).
 *
 * Same setup as tests/e2e.mjs. Fixtures (besides the ones of tests/e2e-phase3.mjs):
 *   offset.mp4   2.5 s, picture red for 1 s then blue; its sound track starts 1 s in (edit list):
 *     ffmpeg -f lavfi -i "color=c=red:s=320x240:d=1:r=30" -f lavfi -i "color=c=blue:s=320x240:d=1.5:r=30" \
 *       -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0[v]" -map "[v]" -c:v libx264 -pix_fmt yuv420p -g 15 v.mp4
 *     ffmpeg -f lavfi -i "sine=frequency=440:duration=1.5:sample_rate=48000" -c:a aac a.m4a
 *     ffmpeg -i v.mp4 -itsoffset 1.0 -i a.m4a -map 0:v -map 1:a -c copy -movflags +faststart offset.mp4
 *   twoaudio.mp4 2 s, two sound tracks: AC-3 first (not decodable in Chrome on Linux), then AAC:
 *     ffmpeg -i clip.mp4 -i clip.mp4 -map 0:v -map 0:a -map 1:a -c:v copy -c:a:0 ac3 -c:a:1 aac twoaudio.mp4
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL || "http://localhost:3210";
const FIXTURES = process.env.FIXTURES || "/tmp/fixtures";
const SHOTS = process.env.SHOTS || "/tmp/shots";
const DL = process.env.DOWNLOADS || "/tmp/dl-media";
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
  await page.waitForSelector('[data-testid="save-status"][data-status="saved"]', { timeout: 20000 });
};
const setField = async (label, value) => {
  const f = await page.waitForSelector(L(label), { visible: true });
  await f.click({ clickCount: 3 });
  await f.type(String(value));
  await page.keyboard.press("Enter");
};
const projectId = () => new URL(page.url()).searchParams.get("id");
const readDoc = () =>
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
    projectId(),
  );
const newProject = async (name) => {
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await clickText("New project");
  await page.type("#np-name", name);
  await setField("Number of slides", 1);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickText("Create project")]);
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
};
/** The next file that lands in the download folder. */
const nextDownload = async (timeout = 180000) => {
  for (let i = 0; i < timeout / 150; i++) {
    const done = fs.readdirSync(DL).filter((f) => !f.endsWith(".crdownload"));
    if (done.length) {
      await sleep(200);
      const file = path.join(DL, done[0]);
      const buf = fs.readFileSync(file);
      fs.rmSync(file);
      return { name: done[0], buf };
    }
    await sleep(150);
  }
  throw new Error("no download");
};
const runExport = async () => {
  const go = await page.$$eval('[role="dialog"] button', (bs) => bs.map((b) => b.textContent).find((t) => /^Export \d+ slide/.test(t)));
  await clickText(go);
  await Promise.race([
    page.waitForSelector('[data-testid="export-done"]', { timeout: 180000 }),
    page.waitForSelector('[role="dialog"] [role="alert"]', { timeout: 180000 }).then(async (n) => {
      throw new Error(`export failed: ${await n.evaluate((x) => x.textContent)}`);
    }),
  ]);
  const file = await nextDownload();
  const doneText = await page.$eval('[data-testid="export-done"]', (n) => n.textContent);
  await clickText("Continue editing");
  return { ...file, doneText };
};
const loadPng = (buf) =>
  page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext("2d").drawImage(bmp, 0, 0);
    globalThis.__img = c;
  }, Buffer.from(buf).toString("base64"));
const pixel = (x, y) => page.evaluate((px, py) => Array.from(globalThis.__img.getContext("2d").getImageData(px, py, 1, 1).data), Math.round(x), Math.round(y));
const isRed = (c) => c[0] > 180 && c[1] < 90 && c[2] < 90;
const isBlue = (c) => c[2] > 180 && c[0] < 90 && c[1] < 90;
const exportStill = async () => {
  await clickText("Export");
  await clickText("PNG");
  await clickText("Current");
  if (await page.$('[data-testid="video-export"]')) await clickText("Still image");
  const { buf } = await runExport();
  await loadPng(buf);
};
const exportVideo = async () => {
  await clickText("Export");
  await page.waitForSelector('[data-testid="video-export"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="video-note"]')?.textContent.includes("Checking"));
  await clickText("Current");
  return runExport();
};
/** Colors of an exported video at some times and points, decoded by the browser. */
const videoColors = (buf, samples) =>
  page.evaluate(
    async (b64, at) => {
      const blob = await (await fetch(`data:video/mp4;base64,${b64}`)).blob();
      const v = document.createElement("video");
      v.muted = true;
      v.src = URL.createObjectURL(blob);
      await new Promise((res, rej) => ((v.onloadeddata = res), (v.onerror = () => rej(new Error("cannot open the exported video")))));
      const c = new OffscreenCanvas(v.videoWidth, v.videoHeight);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      const out = [];
      for (const [t, x, y] of at) {
        v.currentTime = t;
        await new Promise((res) => (v.onseeked = res));
        await new Promise((res) => (v.requestVideoFrameCallback?.(res), setTimeout(res, 200)));
        ctx.drawImage(v, 0, 0);
        out.push(Array.from(ctx.getImageData(x, y, 1, 1).data));
      }
      return out;
    },
    Buffer.from(buf).toString("base64"),
    samples,
  );
/** Loudness (RMS) of slices of the sound of an exported file. */
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
const hasBox = (buf, name) => buf.includes(Buffer.from(name, "latin1"));
/** Screen position of a document point on a freshly fitted 1080 x 1350 slide. */
const toScreen = async (x, y, padding = 56) => {
  const b = await (await page.$('[data-testid="canvas-host"]')).boundingBox();
  const scale = Math.min((b.width - padding * 2) / 1080, (b.height - padding * 2) / 1350);
  return { x: b.x + (b.width - 1080 * scale) / 2 + x * scale, y: b.y + (b.height - 1350 * scale) / 2 + y * scale };
};
const screenColor = async (x, y) => {
  const p = await toScreen(x, y);
  await loadPng(await page.screenshot({ clip: { x: Math.round(p.x) - 2, y: Math.round(p.y) - 2, width: 4, height: 4 }, captureBeyondViewport: false }));
  return pixel(2, 2);
};
const slideKey = async (label, key) => {
  await page.focus(L(label));
  await page.keyboard.press(key);
  await sleep(150);
  await saved();
};
const undo = async () => {
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await saved();
};

try {
  // ---------- New project only on the Projects page ----------
  await page.goto(BASE, { waitUntil: "networkidle0" });
  const headerNew = () => page.$$eval("header button", (ns) => ns.filter((n) => n.textContent.includes("New project") && n.offsetParent !== null).length);
  ok("the Projects page has a New project button", (await headerNew()) === 1);
  const others = {};
  for (const tab of ["Templates", "Assets", "Brand kits"]) {
    await page.$$eval('nav[aria-label="Sections"] button', (bs, t) => bs.find((b) => b.textContent === t).click(), tab);
    await page.waitForFunction((t) => document.querySelector("h1")?.textContent === t, {}, tab);
    others[tab] = await page.$$eval("button", (ns) => ns.filter((n) => n.textContent.trim() === "New project" && n.offsetParent !== null).length);
  }
  ok("Templates, Assets and Brand kits have no New project button", Object.values(others).every((n) => n === 0), JSON.stringify(others));

  // ---------- Template library: one Photo Journal collection ----------
  await page.goto(`${BASE}/?tab=templates`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="template-card"]');
  const cards = await page.$$eval('[data-testid="template-card"]', (ns) => ns.map((n) => n.querySelector("p").textContent));
  ok("the built-in library has 20+ templates, all Photo Journal", cards.length >= 20 && cards.every((m) => m.startsWith("Photo Journal")), `${cards.length}`);
  ok("in several formats (4:5, 1:1, 9:16)", ["4:5", "1:1", "9:16"].every((r) => cards.some((m) => m.includes(r))));
  const categories = await page.$$eval(`${L("Category")} option`, (os) => os.map((o) => o.textContent));
  ok("the category filter offers only Photo Journal", categories.join() === "All categories,Photo Journal", categories.join());

  // ---------- Video crop ----------
  await newProject("Video Crop");
  await (await page.$('[data-testid="video-input"]')).uploadFile(`${FIXTURES}/sides.mp4`); // 320x240: left red, right blue
  await saved();
  await setField("X position", 240);
  await setField("Y position", 375);
  await setField("Width", 600);
  await setField("Height", 600);
  await saved();
  const video = async () => (await readDoc()).slides[0].elements.find((e) => e.type === "video");
  ok("a video has the same Crop controls as a photo", !!(await page.$(L("Move left / right"))) && !!(await page.$(L("Zoom"))) && !!(await page.$("button ::-p-text(Rotate video 90°)")));
  await exportStill();
  ok("centre crop by default: red left half, blue right half", isRed(await pixel(390, 675)) && isBlue(await pixel(690, 675)) && (await video()).crop === undefined);

  await slideKey("Move left / right", "Home");
  let v = await video();
  ok("panning is stored on the video element", v.crop?.x === -1 && v.crop.zoom === 1 && v.width === 600, JSON.stringify(v.crop));
  await exportStill();
  ok("panned to the left end: red now reaches past the middle of the frame", isRed(await pixel(600, 675)) && isBlue(await pixel(780, 675)), `${await pixel(600, 675)} | ${await pixel(780, 675)}`);
  await sleep(500);
  ok("the editor preview shows the same crop", isRed(await screenColor(600, 675)) && isBlue(await screenColor(780, 675)));
  await page.screenshot({ path: `${SHOTS}/media-01-video-crop.png` });

  const mp4 = await exportVideo();
  const frames = await videoColors(mp4.buf, [
    [0.5, 600, 675],
    [0.5, 780, 675],
  ]);
  ok("the MP4 export uses the same crop", isRed(frames[0]) && isBlue(frames[1]), frames.map((c) => c.slice(0, 3).join("/")).join(" "));

  await slideKey("Zoom", "End");
  await exportStill();
  ok("zoomed in at the left end: only red is left in the frame", (await video()).crop.zoom === 5 && isRed(await pixel(260, 400)) && isRed(await pixel(820, 950)));

  await clickText("Reset crop");
  await saved();
  await clickText("Rotate video 90°");
  await saved();
  v = await video();
  await exportStill();
  ok("rotating turns the video inside its frame: red on top, blue below", v.crop?.turns === 1 && v.rotation === 0 && isRed(await pixel(540, 500)) && isBlue(await pixel(540, 850)), `${await pixel(540, 500)} | ${await pixel(540, 850)}`);
  await undo();
  ok("rotating the video is one undo step", (await video()).crop === undefined);
  await click(L("Frame shape As video"));
  await saved();
  v = await video();
  ok("'As video' gives the frame the video's own shape", v.width === 600 && v.height === 450, `${v.width}x${v.height}`);

  // ---------- Videos in empty frames ----------
  await page.goto(`${BASE}/?tab=templates`, { waitUntil: "networkidle0" });
  await click(L("Preview template One Line a Day"));
  await page.waitForSelector('[aria-label="Slides in this template"] img', { timeout: 30000 });
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickText("Use this template")]);
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  const slideEls = async (i) => (await readDoc()).slides[i].elements;
  const frameBefore = (await slideEls(0))[1];
  await page.click('ul[aria-label="Layers"] li:nth-child(3)'); // layers list top first: the frame is third
  await page.waitForSelector("button ::-p-text(Choose photo or video)");
  await (await page.$('[data-testid="replace-input"]')).uploadFile(`${FIXTURES}/clip.mp4`);
  await page.waitForSelector("button ::-p-text(Replace video or photo)", { timeout: 20000 });
  await saved();
  let filled = (await slideEls(0))[1];
  ok(
    "an empty frame takes a video and keeps its place, size and stacking",
    filled.type === "video" && filled.id === frameBefore.id && filled.x === 240 && filled.y === 220 && filled.width === 600 && filled.height === 760 && filled.trimEnd === 2,
    JSON.stringify({ type: filled.type, x: filled.x, y: filled.y, w: filled.width, h: filled.height }),
  );
  ok("and the video frame gets the timeline and video controls", !!(await page.$('[data-testid="video-info"]')));
  await page.screenshot({ path: `${SHOTS}/media-02-video-in-frame.png` });

  await clickText("Turn into empty frame");
  await saved();
  filled = (await slideEls(0))[1];
  ok("a video can be turned back into an empty frame", filled.type === "image" && filled.assetId === null && filled.width === 600);
  await undo();
  ok("and undo brings the video back", (await slideEls(0))[1].type === "video");

  // The canvas picker (double-tap on an empty frame) takes videos too.
  await click('ol[aria-label="Slides"] > li:nth-child(2) button');
  await sleep(300);
  await page.click('ul[aria-label="Layers"] li:nth-child(3)');
  await page.waitForSelector("button ::-p-text(Choose photo or video)");
  const accept = await page.$eval('[data-testid="placeholder-input"]', (n) => n.accept);
  ok("the canvas file picker accepts photos and videos", accept.includes("image/jpeg") && accept.includes("video/mp4"), accept);
  await (await page.$('[data-testid="placeholder-input"]')).uploadFile(`${FIXTURES}/sides.mp4`);
  await page.waitForSelector("button ::-p-text(Replace video or photo)", { timeout: 20000 });
  await saved();
  ok("a video picked from the canvas fills the frame", (await slideEls(1))[1].type === "video");

  // Dropping a video file onto an empty frame fills it; it is not added as a new layer.
  await click('ol[aria-label="Slides"] > li:nth-child(3) button');
  await sleep(600);
  await page.keyboard.press("Escape");
  const target = await toScreen(540, 600);
  const before3 = (await slideEls(2)).length;
  await page.evaluate(
    async (b64, x, y) => {
      const blob = await (await fetch(`data:video/mp4;base64,${b64}`)).blob();
      const dt = new DataTransfer();
      dt.items.add(new File([blob], "dropped.mp4", { type: "video/mp4" }));
      const el = document.elementFromPoint(x, y);
      for (const type of ["dragover", "drop"]) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    },
    fs.readFileSync(`${FIXTURES}/clip.mp4`).toString("base64"),
    target.x,
    target.y,
  );
  await page.waitForFunction(
    (pid) =>
      new Promise((resolve) => {
        const req = indexedDB.open("creative-carousel-studio");
        req.onsuccess = () => {
          const get = req.result.transaction("projectDocs").objectStore("projectDocs").get(pid);
          get.onsuccess = () => (req.result.close(), resolve(get.result.slides[2].elements[1].type === "video"));
        };
      }),
    { timeout: 20000, polling: 300 },
    projectId(),
  );
  ok("a video dropped on an empty frame fills that frame", (await slideEls(2)).length === before3 && (await slideEls(2))[1].name === "dropped");

  // The filled frame exports with its sound.
  await click('ol[aria-label="Slides"] > li:nth-child(1) button');
  await sleep(300);
  const framed = await exportVideo();
  const framedSound = await loudness(framed.buf, [[0.3, 1.7]]);
  ok("the video in the frame exports as MP4 with its sound", framed.name.endsWith(".mp4") && hasBox(framed.buf, "mp4a") && framedSound[0] > 0.02, framedSound[0].toFixed(4));

  // ---------- Sound of exported videos ----------
  await newProject("Sound Sync");
  await (await page.$('[data-testid="video-input"]')).uploadFile(`${FIXTURES}/offset.mp4`);
  await saved();
  const synced = await exportVideo();
  const [before, after] = await loudness(synced.buf, [
    [0.1, 0.85],
    [1.15, 2.4],
  ]);
  const syncColors = await videoColors(synced.buf, [
    [0.5, 540, 675],
    [1.5, 540, 675],
  ]);
  ok(
    "a sound track that starts 1 s into the file stays 1 s in: silent while red, audible once blue",
    before < 0.005 && after > 0.02 && isRed(syncColors[0]) && isBlue(syncColors[1]),
    `${before.toFixed(4)} / ${after.toFixed(4)}`,
  );
  ok("the export reports sound", !/no sound/i.test(synced.doneText));

  await newProject("Two Tracks");
  await (await page.$('[data-testid="video-input"]')).uploadFile(`${FIXTURES}/twoaudio.mp4`);
  await saved();
  const two = await exportVideo();
  const twoSound = await loudness(two.buf, [[0.3, 1.7]]);
  ok("a file whose first sound track cannot be decoded still exports with sound", hasBox(two.buf, "mp4a") && twoSound[0] > 0.02, twoSound[0].toFixed(4));

  ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (e) {
  console.error("ABORTED:", e.message?.split("\n")[0]);
  await page.screenshot({ path: `${SHOTS}/failure-media.png` }).catch(() => {});
  results.push({ name: "run completed", pass: false });
  if (pageErrors.length) console.error("page errors:", pageErrors.slice(0, 5));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
