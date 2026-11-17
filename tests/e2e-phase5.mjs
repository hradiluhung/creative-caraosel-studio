/**
 * Phase 5: production checks. Security headers and CSP, save failures, recovery, accessibility (axe-core).
 * Same setup as tests/e2e.mjs (production build on BASE_URL, CHROME_PATH, FIXTURES with photo-a.jpg).
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
const idb = (fn, ...args) =>
  // Evaluated as a string through the DevTools protocol, which the page's Content Security Policy does not restrict.
  page.evaluate(`(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open("creative-carousel-studio"); r.onerror = () => rej(r.error); r.onsuccess = () => res(r.result); });
    try { return await (${fn.toString()})(db, ...${JSON.stringify(args)}); } finally { db.close(); }
  })()`);
const get = (db, store, key) => new Promise((res) => { const r = db.transaction(store).objectStore(store).get(key); r.onsuccess = () => res(r.result); });
const readDoc = () => idb((db, id) => new Promise((res) => { const r = db.transaction("projectDocs").objectStore("projectDocs").get(id); r.onsuccess = () => res(r.result); }), projectId());
const storedVersions = () =>
  idb((db, id) => new Promise((res) => {
    const r = db.transaction("projectVersions").objectStore("projectVersions").index("projectId").getAll(id);
    r.onsuccess = () => res(r.result.map((v) => ({ kind: v.kind, name: v.name ?? null, elements: v.doc.slides[0].elements.length, thumb: v.thumbnail?.size ?? 0, at: v.createdAt })).sort((a, b) => a.at.localeCompare(b.at)));
  }), projectId());
void get;
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

const AXE = fs.readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
/**
 * Run axe-core on the current page. `meta-viewport` is switched off on purpose: page zoom is
 * limited so that iOS does not zoom into every text field and so the canvas can own pinch zoom
 * (documented as a known limitation). Everything else in WCAG 2.1 A and AA is checked.
 */
const axe = async (target = page) => {
  await target.evaluate(AXE);
  const result = await target.evaluate(() =>
    window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, rules: { "meta-viewport": { enabled: false } } }),
  );
  return result.violations.map((v) => ({ id: v.id, impact: v.impact, count: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ") }));
};
const a11y = async (name, target = page) => {
  const violations = await axe(target);
  ok(`accessibility: ${name} has no WCAG A/AA violations`, violations.length === 0, JSON.stringify(violations));
};
const newProject = async (name) => {
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await clickText("New project");
  await page.type("#np-name", name);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickText("Create project")]);
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
};
const status = () => page.$eval('[data-testid="save-status"]', (n) => ({ status: n.dataset.status, text: n.textContent }));
const breakStorage = () =>
  page.evaluate(() => {
    window.__put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    };
  });
const repairStorage = () => page.evaluate(() => (IDBObjectStore.prototype.put = window.__put));
const corrupt = (id) => idb((db, key) => new Promise((res) => { const tx = db.transaction("projectDocs", "readwrite"); tx.objectStore("projectDocs").put({ schemaVersion: 7, broken: true }, key); tx.oncomplete = () => res(true); }), id);

try {
  // ---------- Security ----------
  for (const path of ["/", "/editor", "/manifest.webmanifest", "/sw.js"]) {
    const res = await fetch(`${BASE}${path}`);
    const h = res.headers;
    const csp = h.get("content-security-policy") ?? "";
    ok(
      `security headers on ${path}`,
      csp.includes("default-src 'self'") && csp.includes("object-src 'none'") && csp.includes("frame-ancestors 'none'") &&
        h.get("x-content-type-options") === "nosniff" && h.get("x-frame-options") === "DENY" && h.get("referrer-policy") === "no-referrer" && (h.get("permissions-policy") ?? "").includes("camera=()"),
      csp.slice(0, 80),
    );
  }
  {
    const csp = (await fetch(`${BASE}/`)).headers.get("content-security-policy");
    ok("the production policy does not allow eval or any other origin", !/'unsafe-eval'/.test(csp.replace("'wasm-unsafe-eval'", "")) && !/https?:|\*/.test(csp), csp);
    // Enforced, not just sent: a request to another origin is refused by the browser.
    const probe = await browser.newPage();
    await probe.goto(BASE, { waitUntil: "networkidle0" });
    const blocked = await probe.evaluate(
      () =>
        new Promise((resolve) => {
          const seen = [];
          document.addEventListener("securitypolicyviolation", (e) => seen.push(e.effectiveDirective));
          new Image().src = "https://example.com/pixel.png";
          fetch("https://example.com/data").catch(() => undefined);
          const s = document.createElement("script");
          s.src = "https://example.com/x.js";
          document.head.append(s);
          setTimeout(() => resolve(seen.sort()), 700);
        }),
    );
    ok("the browser blocks images, requests and scripts from other origins", ["connect-src", "img-src", "script-src-elem"].every((d) => blocked.includes(d)), JSON.stringify(blocked));
    await probe.close();
  }

  // ---------- Accessibility: dashboard ----------
  await newProject("Phase Five");
  await page.click('[data-category="shapes"]');
  await click(L("Add rectangle"));
  await until(async () => ({ done: (await elementCount()) === 1 }));
  await saved();
  const id = projectId();
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await page.waitForSelector(L("Actions for Phase Five"));
  await a11y("dashboard, projects");
  await clickText("Templates");
  await page.waitForSelector(L("Category"));
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="template-card"]')].every((c) => c.querySelector("img")), { timeout: 20000 });
  await a11y("dashboard, templates");
  await clickText("Assets");
  await page.waitForSelector('[data-testid="storage-overview"]');
  await a11y("dashboard, assets");
  await clickText("Brand kits");
  await sleep(300);
  await a11y("dashboard, brand kits");

  // Dialog: focus moves in, Tab stays in, Escape closes and focus returns.
  await clickText("Projects");
  await clickText("New project");
  await page.waitForSelector('[role="dialog"]');
  await a11y("new project dialog");
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  let stayed = await inside();
  for (let i = 0; i < 40 && stayed; i++) {
    await page.keyboard.press("Tab");
    stayed = await inside();
  }
  for (let i = 0; i < 8 && stayed; i++) {
    await page.keyboard.down("Shift");
    await page.keyboard.press("Tab");
    await page.keyboard.up("Shift");
    stayed = await inside();
  }
  ok("keyboard focus stays inside an open dialog", stayed);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  ok("Escape closes the dialog and focus returns to the button that opened it", await page.evaluate(() => document.activeElement?.textContent?.includes("New project")));

  // ---------- Accessibility: editor ----------
  await page.goto(`${BASE}/editor?id=${id}`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await a11y("editor, nothing selected");
  {
    const b = await (await page.$('[data-testid="canvas-host"]')).boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await sleep(200);
  }
  await a11y("editor, shape selected");
  await clickText("Export");
  await page.waitForSelector('[role="dialog"]');
  await a11y("export dialog");
  await page.keyboard.press("Escape");
  await click(L("Version history"));
  await page.waitForSelector('[role="dialog"]');
  await a11y("version history dialog");
  await page.type('[role="dialog"] input', "Good state");
  await clickText("Save version");
  await page.waitForSelector('[data-testid="version-row"]');
  await page.keyboard.press("Escape");
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await a11y("editor on a phone-sized screen");
  await page.setViewport({ width: 1440, height: 900 });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="canvas-host"] canvas');

  // ---------- Recovery: closing right after an edit ----------
  await page.click('[data-category="shapes"]');
  await click(L("Add ellipse"));
  await page.reload({ waitUntil: "networkidle0" }); // no waiting for the autosave delay
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  ok("an edit made just before the page closes is not lost", (await elementCount()) === 2);

  // ---------- Error handling: a save that fails ----------
  await breakStorage();
  await page.click('[data-category="shapes"]');
  await click(L("Add triangle"));
  await page.waitForSelector('[data-testid="save-status"][data-status="error"]');
  let st = await status();
  ok("a failed save is shown with the reason and a way to retry", st.text.includes("out of storage space") && !!(await page.$('[data-testid="retry-save"]')), st.text);
  ok("nothing was written while saving failed", (await elementCount()) === 2);
  await a11y("editor while a save has failed");
  await repairStorage();
  await page.waitForSelector('[data-testid="save-status"][data-status="saved"]', { timeout: 9000 });
  ok("the save is retried automatically once storage works again", (await elementCount()) === 3 && !(await page.$('[data-testid="retry-save"]')));
  await breakStorage();
  await page.click('[data-category="shapes"]');
  await click(L("Add star"));
  await page.waitForSelector('[data-testid="retry-save"]');
  await repairStorage();
  await click('[data-testid="retry-save"]');
  await page.waitForSelector('[data-testid="save-status"][data-status="saved"]', { timeout: 3000 });
  ok("Retry saves at once", (await elementCount()) === 4);

  // ---------- Recovery: a project whose data is damaged ----------
  // Leave the editor first: while it is open, its pending autosave could write the healthy
  // document back over the damaged one and the screen under test would never appear.
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await corrupt(id);
  await page.goto(`${BASE}/editor?id=${id}`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="recovery-version"]');
  const screenText = await page.$eval("main", (n) => n.textContent);
  ok("a damaged project opens a recovery screen instead of a broken editor", screenText.includes("Could not open this project") && screenText.includes("Restore a saved version") && screenText.includes("Good state"));
  await a11y("recovery screen");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('[data-testid="recovery-version"] button')]);
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  const recovered = await readDoc();
  ok("restoring a saved version brings the project back with that content", recovered.id === id && recovered.name === "Phase Five" && recovered.slides[0].elements.length === 1 && recovered.schemaVersion === 7, JSON.stringify({ n: recovered.slides?.[0]?.elements?.length }));
  ok("the project's versions are still there after recovery", (await storedVersions()).some((v) => v.name === "Good state"));
  await page.click('[data-category="shapes"]');
  await click(L("Add rectangle"));
  await saved();
  ok("the recovered project can be edited and saved again", (await elementCount()) === 2);

  await newProject("No Versions");
  const lost = projectId();
  await saved().catch(() => undefined);
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await corrupt(lost);
  await idb((db, key) => new Promise((res) => { const tx = db.transaction("projectVersions", "readwrite"); const idx = tx.objectStore("projectVersions").index("projectId"); const r = idx.openCursor(key); r.onsuccess = () => { const c = r.result; if (c) { c.delete(); c.continue(); } }; tx.oncomplete = () => res(true); }), lost);
  await page.goto(`${BASE}/editor?id=${lost}`, { waitUntil: "networkidle0" });
  await page.waitForSelector('main [role="alert"]');
  ok("without saved versions the screen says so and offers the way back", (await page.$eval("main", (n) => n.textContent)).includes("no saved versions to restore from") && !(await page.$('[data-testid="recovery-version"]')));
  await clickText("Back to projects");
  await page.waitForSelector(L("Actions for No Versions"));
  await click(L("Actions for No Versions"));
  await click('[role="menu"] ::-p-text(Delete)');
  await click('[role="dialog"] button ::-p-text(Delete)');
  await page.waitForFunction(() => !document.querySelector('[aria-label="Actions for No Versions"]'), { timeout: 5000 });
  ok("a damaged project does not break the dashboard and can be deleted there", !!(await page.$(L("Actions for Phase Five"))));

  await page.goto(`${BASE}/editor?id=does-not-exist`, { waitUntil: "networkidle0" });
  await page.waitForSelector('main [role="alert"]');
  ok("an unknown project id gives a clear message", (await page.$eval('main [role="alert"]', (n) => n.textContent)).includes("does not exist on this device"));
  await page.goto(`${BASE}/editor?template=does-not-exist`, { waitUntil: "networkidle0" });
  await page.waitForSelector('main [role="alert"]');
  ok("an unknown template id gives a clear message", (await page.$eval('main [role="alert"]', (n) => n.textContent)).includes("template does not exist"));

  // ---------- Performance change must not cost offline use ----------
  // A first visit in a clean profile: tabs are loaded on demand now, and must still open offline.
  {
    const context = await browser.createBrowserContext();
    const fresh = await context.newPage();
    const errors = [];
    fresh.on("pageerror", (e) => errors.push(String(e)));
    await fresh.goto(BASE, { waitUntil: "networkidle0" });
    await fresh.evaluate(() => navigator.serviceWorker.ready);
    await sleep(8000); // idle loading of the tabs, then the report to the service worker
    await fresh.setOfflineMode(true);
    await fresh.reload({ waitUntil: "domcontentloaded" });
    await (await fresh.waitForSelector("button ::-p-text(Templates)", { visible: true })).click();
    const cardsOffline = await fresh.waitForSelector('[data-testid="template-card"]', { timeout: 8000 }).then(() => true, () => false);
    await (await fresh.waitForSelector("button ::-p-text(Assets)")).click();
    const assetsOffline = await fresh.waitForSelector('[data-testid="storage-overview"]', { timeout: 8000 }).then(() => true, () => false);
    await (await fresh.waitForSelector("button ::-p-text(Brand kits)")).click();
    await sleep(500);
    ok("after one online visit, every dashboard tab opens offline", cardsOffline && assetsOffline && errors.length === 0, `${cardsOffline} ${assetsOffline} ${errors.join(" | ")}`);
    await fresh.setOfflineMode(false);
    await context.close();
  }

  ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 4).join(" | "));
} catch (e) {
  console.log("ABORTED:", e.message);
  console.log("page errors:", pageErrors.slice(0, 5));
  results.push({ name: "aborted", pass: false });
} finally {
  await browser.close();
}
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
