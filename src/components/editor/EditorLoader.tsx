"use client";

import dynamic from "next/dynamic";

/** The editor needs a real browser (canvas, IndexedDB), so it is never rendered on the server. */
const EditorApp = dynamic(() => import("./EditorApp"), {
  ssr: false,
  loading: () => <div className="flex h-dvh items-center justify-center text-muted">Loading editor…</div>,
});

export function EditorLoader() {
  return <EditorApp />;
}
