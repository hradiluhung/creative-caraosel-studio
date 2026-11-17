/** Run something when the browser has nothing better to do. Returns a function that cancels it. */
export function whenIdle(work: () => void, timeout = 4000): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(work, { timeout });
    return () => cancelIdleCallback(id);
  }
  // Safari has no requestIdleCallback: a short delay after load is close enough.
  const id = window.setTimeout(work, 1500);
  return () => window.clearTimeout(id);
}
