/**
 * Small per-device preferences (favorites, recents, saved presets) in localStorage.
 * Not part of any document: losing them never loses work.
 */
import { useSyncExternalStore } from "react";

const PREFIX = "ccs.";
const listeners = new Map<string, Set<() => void>>();
const cache = new Map<string, unknown>();

function read<T>(key: string, fallback: T): T {
  if (cache.has(key)) return cache.get(key) as T;
  let value = fallback;
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(PREFIX + key);
    if (raw !== null) value = JSON.parse(raw) as T;
  } catch {
    /* private mode or corrupted entry: use the fallback */
  }
  cache.set(key, value);
  return value;
}

export function getPref<T>(key: string, fallback: T): T {
  return read(key, fallback);
}

export function setPref<T>(key: string, value: T) {
  cache.set(key, value);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: keep the in-memory value */
  }
  listeners.get(key)?.forEach((l) => l());
}

export function usePref<T>(key: string, fallback: T): T {
  return useSyncExternalStore(
    (onChange) => {
      const set = listeners.get(key) ?? new Set();
      listeners.set(key, set);
      set.add(onChange);
      return () => set.delete(onChange);
    },
    () => read(key, fallback),
    () => fallback,
  );
}

/** Put an item at the front of a most-recent-first list, without duplicates. */
export function pushRecent<T>(key: string, item: T, limit: number) {
  const list = read<T[]>(key, []);
  setPref(key, [item, ...list.filter((x) => JSON.stringify(x) !== JSON.stringify(item))].slice(0, limit));
}

export function toggleInList<T>(key: string, item: T) {
  const list = read<T[]>(key, []);
  setPref(key, list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
}

export const PREF = {
  fontFavorites: "fonts.favorites",
  fontRecents: "fonts.recent",
  recentColors: "colors.recent",
  imagePresets: "image.presets",
  templateFavorites: "templates.favorites",
  templateRecents: "templates.recent",
} as const;
