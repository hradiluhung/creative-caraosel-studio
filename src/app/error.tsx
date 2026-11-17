"use client";

import { useEffect } from "react";

/**
 * Catches a crash while drawing a page, so the user gets a way forward instead of a blank screen.
 * Projects are saved to this device after every change, so reloading loses at most the last moment.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="font-display text-2xl font-bold">Something went wrong</h1>
      <p role="alert" className="max-w-md text-muted">
        The app hit an unexpected error. Your projects are saved on this device after every change, so nothing more than the last moment can be lost.
      </p>
      {error.message && <p className="max-w-md font-mono text-[11px] text-muted">{error.message}</p>}
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={reset} className="h-9 rounded-[5px] bg-ink px-3.5 text-[13px] font-medium text-bg">
          Try again
        </button>
        <button type="button" onClick={() => (window.location.href = "/")} className="h-9 rounded-[5px] border border-line-strong px-3.5 text-[13px] font-medium">
          Back to projects
        </button>
      </div>
    </main>
  );
}
