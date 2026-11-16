"use client";

import { useEffect } from "react";

/** Registers the offline service worker. Production only: in dev it would cache stale bundles. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Service worker registration failed", err);
    });
  }, []);
  return null;
}
