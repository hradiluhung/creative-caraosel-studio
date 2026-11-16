/**
 * Version history rules. Pure, so they are unit tested in Node and can be reused unchanged
 * when versions are synchronised to a server later (SPEC 18: project_versions).
 */
import type { Project } from "./schema";

/** auto: made by the app. manual: "Save version". before-restore: the state a restore replaced. */
export type VersionKind = "auto" | "manual" | "before-restore";

/** What the retention rule needs to know about a stored version. */
export interface VersionInfo {
  id: string;
  createdAt: string;
  kind: VersionKind;
  name?: string;
}

/** Automatic versions are made at most this often while a project is being edited. */
export const AUTO_VERSION_INTERVAL_MS = 10 * 60 * 1000;
/** How many versions without a name are kept per project. Named ones are kept until deleted. */
export const MAX_UNNAMED_VERSIONS = 20;

/** A version the user gave a name is theirs to delete; everything else is housekeeping. */
export function isKeptVersion(v: Pick<VersionInfo, "name">): boolean {
  return !!v.name?.trim();
}

/** Ids of the versions to delete so that only the newest `keep` unnamed ones remain. */
export function versionsToPrune(versions: VersionInfo[], keep = MAX_UNNAMED_VERSIONS): string[] {
  return versions
    .filter((v) => !isKeptVersion(v))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(Math.max(0, keep))
    .map((v) => v.id);
}

/**
 * Whether the app should save an automatic version now: the document has changed since the
 * newest version, and that version is old enough (or there is none yet).
 */
export function shouldAutoVersion(project: Pick<Project, "updatedAt">, newestVersionAt: string | undefined, now: Date, intervalMs = AUTO_VERSION_INTERVAL_MS): boolean {
  if (!newestVersionAt) return true;
  if (project.updatedAt <= newestVersionAt) return false;
  return now.getTime() - new Date(newestVersionAt).getTime() >= intervalMs;
}

/**
 * The document a restore produces: the old content under the current project's identity.
 * The project keeps its id, name and creation date, so restoring never forks or renames it.
 */
export function restoredProject(current: Project, version: Project): Project {
  return { ...version, id: current.id, name: current.name, createdAt: current.createdAt };
}

/** Short label for a version without a name. */
export function versionLabel(v: Pick<VersionInfo, "kind" | "name">): string {
  if (v.name?.trim()) return v.name.trim();
  return v.kind === "manual" ? "Saved version" : v.kind === "before-restore" ? "Before restore" : "Automatic version";
}
