/**
 * Organising: no accidental text selection, grouping and actions on several objects, deleting
 * any slide (independent and seamless), and selecting several projects on the dashboard.
 * Same setup as tests/e2e.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL || "http://localhost:3210";
const SHOTS = process.env.SHOTS || "/tmp/shots";
const DL = process.env.DOWNLOADS || "/tmp/dl-organize";
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

const W = 1080, H = 1350;
const view = async () => {
  const b = await (await page.$('[data-testid="canvas-host"]')).boundingBox();
  const scale = Math.min((b.width - 112) / W, (b.height - 112) / H);
  const ox = b.x + (b.width - W * scale) / 2;
  const oy = b.y + (b.height - H * scale) / 2;
  return { scale, at: (x, y) => ({ x: ox + x * scale, y: oy + y * scale }) };
};
const els = async () => (await active()).elements;
const at = async (x, y) => (await view()).at(x, y);
const clickAt = async (x, y, { shift = false, button = "left" } = {}) => {
  const p = await at(x, y);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(p.x, p.y, { button });
  if (shift) await page.keyboard.up("Shift");
  await sleep(120);
};
const menuItems = () => page.$$eval('[role="menu"] [role="menuitem"]', (ns) => ns.map((n) => n.textContent));
const menu = async (label) => {
  await (await page.waitForSelector(`[role="menu"] [role="menuitem"] ::-p-text(${label})`, { visible: true })).click();
  await saved();
};
const selectedRows = () => page.$$eval('[aria-label="Layers"] [aria-current="true"]', (n) => n.length);
const centre = (e) => ({ x: e.x + e.width / 2, y: e.y + e.height / 2 });
const addRect = async (x, y, w = 200, h = 200) => {
  await page.click('[data-category="shapes"]');
  await click(L("Add rectangle"));
  await saved();
  for (const [label, v] of [["X position", x], ["Y position", y], ["Width", w], ["Height", h]]) {
    await setField(label, v);
  }
  await saved();
};
const makeProject = async (name, slides, seamless = false) => {
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await clickText("New project");
  await page.type("#np-name", name);
  await setField("Number of slides", slides);
  if (seamless) await clickText("Seamless panorama");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickText("Create project")]);
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
};

try {
  // ---------- No accidental text selection ----------
  await page.goto(BASE, { waitUntil: "networkidle0" });
  const style = (sel) => page.$eval(sel, (n) => getComputedStyle(n).userSelect);
  ok("interface text cannot be selected (title, buttons)", (await style("h1")) === "none" && (await style("button")) === "none");
  ok("inputs stay selectable", (await style(L("Search projects"))) === "text");
  const h1 = await (await page.$("h1")).boundingBox();
  await page.mouse.click(h1.x + 20, h1.y + h1.height / 2, { clickCount: 2 });
  await page.mouse.click(h1.x + 20, h1.y + h1.height / 2, { clickCount: 3 });
  ok("double- and triple-clicking interface text highlights nothing", (await page.evaluate(() => window.getSelection().toString())) === "");

  // ---------- Grouping and several objects ----------
  await makeProject("Organize", 1);
  await page.click('[data-category="text"]');
  await clickText("Add a heading");
  await saved();
  const heading = (await els())[0];
  const hc = centre(heading);
  const hp = await at(hc.x, hc.y);
  await page.mouse.click(hp.x, hp.y);
  await page.mouse.click(hp.x, hp.y);
  await page.waitForSelector('textarea[aria-label="Edit text"]');
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  const sel = await page.$eval('textarea[aria-label="Edit text"]', (t) => ({ us: getComputedStyle(t).userSelect, len: t.selectionEnd - t.selectionStart }));
  ok("text editing on the canvas can still select text", sel.us !== "none" && sel.len > 0, JSON.stringify(sel));
  await page.keyboard.press("Escape");
  await sleep(200);
  await page.keyboard.press("Delete");
  await saved();

  await addRect(100, 100);
  await addRect(500, 100);
  await addRect(300, 700);
  let [a, b, c] = await els();
  ok("setup: three objects", (await els()).length === 3 && a.x === 100 && b.x === 500 && c.y === 700, JSON.stringify((await els()).map((e) => [e.x, e.y])));

  await clickAt(1000, 1300);
  await clickAt(centre(a).x, centre(a).y);
  await clickAt(centre(b).x, centre(b).y, { shift: true });
  await clickAt(centre(b).x, centre(b).y, { button: "right" });
  await page.waitForSelector('[role="menu"]');
  let items = await menuItems();
  ok(
    "the menu for several objects offers group, stacking, lock and delete",
    ["Group", "Bring forward", "Send backward", "Bring to front", "Send to back", "Lock", "Delete 2 objects"].every((x) => items.includes(x)) && !items.includes("Ungroup"),
    items.join(", "),
  );
  await page.screenshot({ path: `${SHOTS}/o-01-menu.png` });
  await menu("Group");
  let doc = await els();
  ok("Group gives both the same group and keeps every other property", doc[0].groupId && doc[0].groupId === doc[1].groupId && !doc[2].groupId && doc[0].x === 100 && doc[1].x === 500 && doc[0].width === 200);

  // Clicking one member selects the whole group.
  await clickAt(1000, 1300);
  await clickAt(centre(a).x, centre(a).y);
  ok("clicking one member selects the whole group", (await selectedRows()) === 2);
  ok("the layers panel shows the group", (await page.$eval('[data-testid="layer-group"]', (n) => n.textContent)) === "Group (2)");

  // Dragging one member moves the group as one.
  const p0 = await at(centre(b).x, centre(b).y);
  const { scale } = await view();
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await page.mouse.move(p0.x + 40 * scale, p0.y + 30 * scale, { steps: 4 });
  await page.keyboard.down("Control"); // no snapping, exact distances
  await page.mouse.move(p0.x + 120 * scale, p0.y + 80 * scale, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Control");
  await saved();
  doc = await els();
  const dxA = doc[0].x - a.x, dxB = doc[1].x - b.x, dyA = doc[0].y - a.y, dyB = doc[1].y - b.y;
  ok("dragging one member moves every member by the same amount", Math.abs(dxA - dxB) < 1 && Math.abs(dyA - dyB) < 1 && dxA > 60 && dyA > 40 && doc[2].x === c.x, `${dxA},${dyA} / ${dxB},${dyB}`);
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await saved();
  doc = await els();
  ok("moving the group is one undo step", doc[0].x === a.x && doc[1].x === b.x);

  // Resizing the group from a corner scales the members together.
  await clickAt(centre(a).x, centre(a).y);
  const corner = await at(b.x + b.width, b.y + b.height);
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.keyboard.down("Control");
  await page.mouse.move(corner.x + 60 * scale, corner.y + 10 * scale, { steps: 6 });
  await page.mouse.move(corner.x + 120 * scale, corner.y + 20 * scale, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Control");
  await saved();
  doc = await els();
  ok("resizing the group resizes every member together", doc[0].width > 205 && Math.abs(doc[0].width - doc[1].width) < 1 && doc[0].x === a.x && doc[1].x > b.x, JSON.stringify(doc.slice(0, 2).map((e) => [e.x, e.width])));
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await saved();

  // Duplicating a group makes a new group.
  await clickAt(centre(a).x, centre(a).y);
  await page.keyboard.down("Control");
  await page.keyboard.press("d");
  await page.keyboard.up("Control");
  await saved();
  doc = await els();
  const groups = [...new Set(doc.map((e) => e.groupId).filter(Boolean))];
  ok("duplicating a group gives a second, separate group", doc.length === 5 && groups.length === 2);
  await page.keyboard.press("Delete");
  await saved();
  ok("deleting the selected copy removes both of its members", (await els()).length === 3);

  // Picking a single member from the layers list.
  await page.click('[data-testid="layer-group"]');
  await sleep(100);
  ok("the group row selects the whole group", (await selectedRows()) === 2);
  // Click the layer's name (the arrows on a selected row move the selection).
  await (await page.$('[aria-label="Layers"] li[aria-current="true"] span[title="Double-click to rename"]')).click();
  await sleep(100);
  ok("a member's own row selects only that member, to edit it alone", (await selectedRows()) === 1);
  await page.click('[data-testid="layer-group"]');
  await sleep(100);
  const beforeArrow = (await els()).map((e) => e.id);
  await click('[aria-label="Layers"] li[aria-current="true"] [aria-label="Bring forward"]');
  await saved();
  const afterArrow = (await els()).map((e) => e.id);
  ok("a row's arrows move the whole selection, so a group stays together", afterArrow.join() === [beforeArrow[2], beforeArrow[0], beforeArrow[1]].join(), `${beforeArrow} -> ${afterArrow}`);
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await saved();

  // Ungroup with the keyboard.
  await clickAt(centre(a).x, centre(a).y);
  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await page.keyboard.press("g");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await saved();
  ok("Ctrl+Shift+G ungroups", (await els()).every((e) => !e.groupId));
  await clickAt(1000, 1300);
  await clickAt(centre(a).x, centre(a).y);
  ok("after ungrouping a click selects one object again", (await selectedRows()) === 1);

  // Stacking, lock and delete on several objects at once.
  [a, b, c] = await els();
  await clickAt(centre(c).x, centre(c).y, { shift: true });
  await clickAt(centre(c).x, centre(c).y, { button: "right" });
  await menu("Send to back");
  doc = await els();
  ok("Send to back moves all selected objects, in their order", doc.map((e) => e.id).join() === [a.id, c.id, b.id].join());
  await clickAt(centre(c).x, centre(c).y, { button: "right" });
  await menu("Bring forward");
  doc = await els();
  ok("Bring forward moves them up one step as a block", doc.map((e) => e.id).join() === [b.id, a.id, c.id].join(), doc.map((e) => e.id).join());
  await clickAt(centre(c).x, centre(c).y, { button: "right" });
  await menu("Lock");
  doc = await els();
  ok("Lock locks every selected object", doc.filter((e) => e.locked).map((e) => e.id).sort().join() === [a.id, c.id].sort().join());
  // Locked objects ignore the canvas, so they are unlocked from the panel (the selection is kept).
  await click(L("Unlock"));
  await saved();
  ok("Unlock in the panel unlocks them all", (await els()).every((e) => !e.locked));
  await clickAt(centre(c).x, centre(c).y, { button: "right" });
  await menu("Delete 2 objects");
  doc = await els();
  ok("Delete removes every selected object", doc.length === 1 && doc[0].id === b.id);
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await saved();
  ok("and one undo brings them all back", (await els()).length === 3);

  // The properties panel offers the same for several objects.
  await clickAt(1000, 1300);
  await clickAt(centre(a).x, centre(a).y);
  await clickAt(centre(b).x, centre(b).y, { shift: true });
  await click(L("Group"));
  await saved();
  doc = await els();
  ok("Group is also in the properties panel", doc.filter((e) => e.groupId).length === 2);
  await page.screenshot({ path: `${SHOTS}/o-02-group.png` });

  // ---------- Deleting any slide ----------
  await makeProject("Three slides", 3);
  for (const [i, x] of [[1, 101], [2, 202], [3, 303]]) {
    await click(`[aria-label="Slide ${i} (${i} of 3)"]`);
    await addRect(x, 100);
  }
  await click('[aria-label="Slide 2 (2 of 3)"]');
  await click(L("Delete slide"));
  await saved();
  doc = await readDoc(projectId());
  ok("deleting slide 2 keeps slides 1 and 3 with their content, in order", doc.slides.length === 2 && doc.slides.map((s) => s.name).join() === "Slide 1,Slide 3" && doc.slides[0].elements[0].x === 101 && doc.slides[1].elements[0].x === 303, JSON.stringify(doc.slides.map((s) => [s.name, s.elements.map((e) => e.x)])));
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await saved();
  doc = await readDoc(projectId());
  ok("undo brings the slide back in its place", doc.slides.map((s) => s.name).join() === "Slide 1,Slide 2,Slide 3" && doc.slides[1].elements[0].x === 202);

  await makeProject("Panorama", 3, true);
  for (const [i, x] of [[1, 100], [2, 1200], [3, 2300]]) {
    await click(`[aria-label="Slide ${i} (${i} of 3)"]`);
    await addRect(x, 300);
  }
  await click('[aria-label="Slide 2 (2 of 3)"]');
  ok("the delete button names the slide it deletes", (await page.$eval(L("Delete slide"), (n) => n.title)) === "Delete slide 2");
  await click(L("Delete slide"));
  await saved();
  doc = await readDoc(projectId());
  ok("in a seamless panorama the middle slide is cut out and the rest closes up", doc.slides.length === 2 && doc.panorama.elements.map((e) => e.x).join() === "100,1220", JSON.stringify(doc.panorama.elements.map((e) => e.x)));

  // ---------- Several projects on the dashboard ----------
  await page.goto(BASE, { waitUntil: "networkidle0" });
  const cards = () => page.$$('[data-testid="project-card"]');
  const before = (await cards()).length;
  await clickText("Select");
  ok("Select shows checkmarks and the selection bar", !!(await page.$('[data-testid="project-bulk-bar"]')) && (await page.$$eval('[data-testid="project-card"]', (ns) => ns.every((n) => n.dataset.selected === "false"))));
  const links = await page.$$('[data-testid="project-card"] a');
  await links[0].click();
  await links[1].click();
  ok("clicking cards selects them instead of opening them", new URL(page.url()).pathname === "/" && (await page.$eval('[data-testid="project-bulk-count"]', (n) => n.textContent)) === "2 selected");
  await links[1].click();
  ok("clicking again takes a project out", (await page.$eval('[data-testid="project-bulk-count"]', (n) => n.textContent)) === "1 selected");
  await links[1].click();
  await page.screenshot({ path: `${SHOTS}/o-03-projects.png` });
  await clickText("Delete 2");
  await page.waitForSelector('[data-testid="bulk-delete-projects"]');
  const listed = await page.$$eval('[data-testid="bulk-delete-projects"] li', (ns) => ns.length);
  ok("deleting asks first and lists the projects", listed === 2 && (await page.$eval('[role="dialog"] h2', (n) => n.textContent)) === "Delete 2 projects?");
  await clickText("Cancel");
  ok("cancelling deletes nothing", (await cards()).length === before);
  await clickText("Delete 2");
  await click('[data-testid="confirm-bulk-delete-projects"]');
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="project-card"]').length === n, {}, before - 2);
  const stored = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open("creative-carousel-studio"); r.onsuccess = () => { const q = r.result.transaction("projectMeta").objectStore("projectMeta").count(); q.onsuccess = () => (r.result.close(), res(q.result)); }; }));
  ok("confirming deletes exactly those projects", (await cards()).length === before - 2 && stored === before - 2 && !(await page.$('[data-testid="project-bulk-bar"]')));
  await clickText("Select");
  await clickText(`Select all shown (${before - 2})`);
  ok("Select all shown picks every visible project", (await page.$eval('[data-testid="project-bulk-count"]', (n) => n.textContent)) === `${before - 2} selected`);
  await clickText("Done");
  ok("Done leaves selecting without deleting", (await cards()).length === before - 2);

  ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (e) {
  console.log("ABORTED:", e.message);
  await page.screenshot({ path: `${SHOTS}/o-failure.png` }).catch(() => {});
  console.log("page errors:", pageErrors);
  results.push({ name: "aborted", pass: false });
} finally {
  await browser.close();
}
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
