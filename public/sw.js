/*
 * Offline shell for Creative Carousel Studio.
 * - install:  precache both app pages plus every script, style and font they reference
 * - navigate: network first, cached page as fallback (so updates arrive when online)
 * - /_next/static: cache first (file names are content hashed, so they never change)
 * Projects, images and fonts chosen by the user live in IndexedDB, not here.
 * Bump VERSION to drop old caches.
 */
const VERSION = "ccs-shell-v1";
const PAGES = ["/", "/editor"];
const STATIC_RE = /\/_next\/static\/[^"'\\\s)<>]+/g;

async function precache() {
  const cache = await caches.open(VERSION);
  const assets = new Set();
  for (const page of PAGES) {
    const res = await fetch(page, { cache: "reload" });
    if (!res.ok) throw new Error(`precache failed for ${page}`);
    await cache.put(page, res.clone());
    const html = await res.text();
    for (const m of html.match(STATIC_RE) || []) assets.add(m);
    for (const m of html.match(/\/favicon\.ico[^"'\s<>]*/g) || []) assets.add(m);
  }
  const stylesheets = [...assets].filter((u) => u.split("?")[0].endsWith(".css"));
  for (const url of stylesheets) {
    try {
      const css = await (await fetch(url)).text();
      // Only woff2: every browser that supports service workers supports it.
      for (const m of css.matchAll(/url\(([^)]+\.woff2)\)/g)) {
        assets.add(new URL(m[1].replace(/["']/g, ""), new URL(url, self.location.origin)).pathname);
      }
    } catch (e) {
      /* fonts fall back to runtime caching */
    }
  }
  await Promise.all(
    [...assets, "/manifest.webmanifest", "/icons/icon-192.png", "/icons/apple-touch-icon.png"].map((u) =>
      cache.add(u).catch(() => undefined),
    ),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function navigate(request) {
  const cache = await caches.open(VERSION);
  const path = new URL(request.url).pathname.replace(/\/$/, "") || "/";
  try {
    const res = await fetch(request);
    if (res.ok && PAGES.includes(path)) await cache.put(path, res.clone());
    return res;
  } catch (e) {
    return (await cache.match(path)) || (await cache.match("/")) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  const fresh = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => undefined);
  return hit || (await fresh) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") event.respondWith(navigate(request));
  else if (url.pathname.startsWith("/_next/static/")) event.respondWith(cacheFirst(request));
  else if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest" || url.pathname === "/favicon.ico") {
    event.respondWith(staleWhileRevalidate(request));
  }
});
