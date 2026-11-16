"use client";

import { History, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { restoredProject, versionLabel } from "@/document/history";
import { useObjectUrl } from "@/lib/useObjectUrl";
import { deleteVersion, listVersions, loadVersion, renameVersion, type VersionSummary } from "@/persistence/db";
import type { ImageStore } from "@/render/resources";
import { useEditorStore } from "@/store/editorStore";
import { Button, Dialog } from "../ui/primitives";
import { captureVersion } from "./useVersionHistory";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Thumb({ blob }: { blob: Blob | null }) {
  const url = useObjectUrl(blob);
  return (
    <span className="flex h-14 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[3px] border border-line bg-sunken">
      {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <History className="h-4 w-4 text-muted" />}
    </span>
  );
}

/**
 * Earlier states of the open project: save one, look through them, go back to one.
 * Restoring is an ordinary change of the document (undoable), and the state it replaces is
 * saved as a version first, so nothing is ever lost by restoring.
 */
export function VersionHistoryDialog({ images, onClose }: { images: ImageStore; onClose: () => void }) {
  const project = useEditorStore((s) => s.project);
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const projectId = project?.id;

  const refresh = useCallback(async () => {
    if (projectId) setVersions(await listVersions(projectId));
  }, [projectId]);
  useEffect(() => {
    let live = true;
    if (projectId) void listVersions(projectId).then((list) => live && setVersions(list));
    return () => {
      live = false;
    };
  }, [projectId]);

  if (!project) return null;

  const run = async (work: () => Promise<string | void>) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await work();
      if (text) setMessage({ kind: "ok", text });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "That did not work." });
    }
    await refresh();
    setBusy(false);
  };

  const save = () =>
    run(async () => {
      await captureVersion(project, "manual", images, name);
      setName("");
      return "Version saved.";
    });

  const restore = (v: VersionSummary) =>
    run(async () => {
      const doc = await loadVersion(v.id);
      if (!doc) throw new Error("This version no longer exists.");
      const s = useEditorStore.getState();
      const current = s.project;
      if (!current) return;
      // The state being replaced is kept, so a restore can itself be taken back later.
      await captureVersion(current, "before-restore", images);
      s.commit((p) => restoredProject(p, doc));
      return `Restored "${versionLabel(v)}" from ${when(v.createdAt)}. Undo brings the previous state back.`;
    });

  return (
    <Dialog title="Version history" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="space-y-3" data-testid="version-history">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void save();
          }}
        >
          <input
            aria-label="Version name"
            placeholder="Name (optional), for example: before the client changes"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            className="h-8 min-w-0 flex-1 rounded-[5px] border border-line bg-transparent px-2 text-xs outline-none focus:border-ink"
          />
          <Button type="submit" variant="primary" size="sm" disabled={busy}>
            Save version
          </Button>
        </form>
        <p className="text-[11px] text-muted">
          A version is saved automatically when you open a project and about every ten minutes while you edit. Versions with a name are kept until you delete them; of the others the newest 20 are kept.
          Versions live on this device only.
        </p>
        {message && (
          <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-xs text-danger" : "text-xs"}>
            {message.text}
          </p>
        )}
        {versions === null ? (
          <p className="text-xs text-muted">Loading…</p>
        ) : versions.length === 0 ? (
          <p className="text-xs text-muted">No versions yet.</p>
        ) : (
          <ol aria-label="Versions" className="thin-scroll max-h-[46vh] space-y-1 overflow-y-auto">
            {versions.map((v) => (
              <li key={v.id} data-testid="version-row" data-kind={v.kind} className="flex items-center gap-2 rounded-md border border-line p-1.5">
                <Thumb blob={v.thumbnail} />
                <div className="min-w-0 flex-1">
                  {renaming?.id === v.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const value = renaming.value;
                        setRenaming(null);
                        void run(() => renameVersion(v.id, value));
                      }}
                    >
                      <input
                        autoFocus
                        aria-label="New version name"
                        value={renaming.value}
                        maxLength={80}
                        onChange={(e) => setRenaming({ id: v.id, value: e.target.value })}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Escape") setRenaming(null);
                        }}
                        onBlur={() => setRenaming(null)}
                        className="h-7 w-full rounded-[4px] border border-ink bg-transparent px-1.5 text-xs outline-none"
                      />
                    </form>
                  ) : (
                    <p className="truncate text-xs font-medium">{versionLabel(v)}</p>
                  )}
                  <p className="truncate text-[11px] text-muted">
                    {when(v.createdAt)} · {v.slideCount} {v.slideCount === 1 ? "slide" : "slides"}
                    {v.name ? " · kept" : ""}
                  </p>
                </div>
                <Button size="sm" disabled={busy} onClick={() => void restore(v)} aria-label={`Restore ${versionLabel(v)} from ${when(v.createdAt)}`}>
                  <RotateCcw className="h-3.5 w-3.5" /> Restore
                </Button>
                <button type="button" aria-label="Rename version" title="Rename (named versions are kept)" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={() => setRenaming({ id: v.id, value: v.name ?? "" })} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-sunken disabled:opacity-40">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button type="button" aria-label="Delete version" title="Delete this version" disabled={busy} onClick={() => void run(() => deleteVersion(v.id))} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-sunken disabled:opacity-40">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Dialog>
  );
}
