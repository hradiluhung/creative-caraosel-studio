"use client";

import { useEffect } from "react";

/**
 * Registers the offline service worker. Production only: in dev it would cache stale bundles.
 *
 * Some code is fetched on demand (dashboard tabs, zip library, video export). On a first visit that
 * can happen before the service worker is in control, so it would be missing offline. A few
 * seconds after load, and whenever the page is hidden, the page tells the worker which build
 * files it has loaded and the worker caches the ones it does not have yet.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Service worker registration failed", err);
    });
    const report = () => {
      const urls = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((name) => name.startsWith(window.location.origin) && name.includes("/_next/static/"));
      if (urls.length === 0) return;
      void navigator.serviceWorker.ready.then((registration) => registration.active?.postMessage({ type: "cache-scripts", urls })).catch(() => undefined);
    };
    const timer = window.setTimeout(report, 6000);
    const onHidden = () => document.visibilityState === "hidden" && report();
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, []);
  return null;
}
