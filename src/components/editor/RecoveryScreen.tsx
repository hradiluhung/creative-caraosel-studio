"use client";

import { useEffect, useState } from "react";
import { versionLabel } from "@/document/history";
import { listVersions, recoverProjectFromVersion, type VersionSummary } from "@/persistence/db";
import { describeStorageError } from "@/persistence/errors";
import { Button } from "../ui/primitives";

/**
 * Shown when a project cannot be opened. If the project has saved versions, one of them can be
 * made the project again; nothing is changed until the user picks one.
 */
export function RecoveryScreen({ projectId, message, details }: { projectId: string | null; message: string; details?: string[] }) {
  const [versions, setVersions] = useState<VersionSummary[] | null>(projectId ? null : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    listVersions(projectId).then(
      (list) => live && setVersions(list),
      () => live && setVersions([]),
    );
    return () => {
      live = false;
    };
  }, [projectId]);

  const restore = async (versionId: string) => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      const project = await recoverProjectFromVersion(projectId, versionId);
      if (!project) throw new Error("That version no longer exists.");
      window.location.reload();
    } catch (e) {
      setError(describeStorageError(e, "That version could not be restored."));
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <h1 className="font-display text-2xl font-bold">Could not open this project</h1>
      <p role="alert" className="max-w-md text-muted">
        {message}
      </p>
      {details && details.length > 0 && (
        <ul className="max-w-md text-left font-mono text-[11px] text-muted">
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      {versions && versions.length > 0 && (
        <section aria-labelledby="recovery-title" className="mt-3 w-full max-w-md rounded-lg border border-line p-4 text-left">
          <h2 id="recovery-title" className="text-[13px] font-semibold">
            Restore a saved version
          </h2>
          <p className="mt-1 text-xs text-muted">The project is replaced by the version you choose. Its other versions are kept.</p>
          <ul className="mt-3 max-h-64 space-y-1.5 overflow-auto">
            {versions.map((v) => (
              <li key={v.id} data-testid="recovery-version" className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate">
                  {versionLabel(v)} · {new Date(v.createdAt).toLocaleString()} · {v.slideCount} slide{v.slideCount === 1 ? "" : "s"}
                </span>
                <Button size="sm" disabled={busy} onClick={() => void restore(v.id)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {versions && versions.length === 0 && projectId && <p className="max-w-md text-xs text-muted">This project has no saved versions to restore from.</p>}
      {error && (
        <p role="alert" className="max-w-md text-xs text-danger">
          {error}
        </p>
      )}
      <Button onClick={() => (window.location.href = "/")}>Back to projects</Button>
    </main>
  );
}
