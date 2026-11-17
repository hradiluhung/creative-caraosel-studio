/**
 * Turn storage failures into a sentence a person can act on. Pure: it only looks at the error.
 * Browsers differ in names and wording, so matching is by name first, then by message.
 */
export type StorageProblem = "full" | "unavailable" | "blocked" | "newer" | "unknown";

export function classifyStorageError(error: unknown): StorageProblem {
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const text = `${name} ${message}`.toLowerCase();
  if (name === "QuotaExceededError" || text.includes("quota") || text.includes("disk is full") || text.includes("no space")) return "full";
  if (name === "VersionError" || text.includes("higher version") || text.includes("newer version")) return "newer";
  if (text.includes("blocked")) return "blocked";
  if (
    name === "SecurityError" ||
    name === "InvalidStateError" ||
    name === "NotFoundError" ||
    name === "UnknownError" ||
    text.includes("indexeddb") ||
    text.includes("database") ||
    text.includes("mutation operation was attempted")
  ) {
    return "unavailable";
  }
  return "unknown";
}

const SENTENCES: Record<Exclude<StorageProblem, "unknown">, string> = {
  full: "This device is out of storage space. Free some space (the Assets tab shows unused files), then try again.",
  unavailable: "Storage is not available in this browser window. Private browsing or blocked site data can cause this.",
  blocked: "Another tab of this app is still open with an older version. Close the other tabs and reload.",
  newer: "This device has data from a newer version of the app. Reload to get the latest version.",
};

/** A full sentence for the user. Unknown errors keep their own message when they have one. */
export function describeStorageError(error: unknown, fallback = "Something went wrong while using storage."): string {
  const problem = classifyStorageError(error);
  if (problem !== "unknown") return SENTENCES[problem];
  const message = error instanceof Error ? error.message.trim() : "";
  return message || fallback;
}
