"use client";

import { useEffect } from "react";
import { getExportFrames } from "@/document/geometry";
import { shouldAutoVersion, type VersionKind } from "@/document/history";
import type { Project } from "@/document/schema";
import { renderThumbnail } from "@/export/exporter";
import { listVersions, saveVersion, type VersionSummary } from "@/persistence/db";
import type { ImageStore } from "@/render/resources";
import { useEditorStore } from "@/store/editorStore";

/** How often the editor looks whether an automatic version is due. */
const CHECK_EVERY_MS = 60_000;

/** Save a version of the given state, with a small picture of its first slide. */
export async function captureVersion(project: Project, kind: VersionKind, images: ImageStore, name?: string): Promise<VersionSummary> {
  // The version holds the state of this moment, so it is dated now and not when the picture is
  // done: otherwise a version saved while the picture renders would be listed as older than it.
  const capturedAt = new Date();
  let thumbnail: Blob | null = null;
  try {
    thumbnail = await renderThumbnail(project, getExportFrames(project)[0], images, 320);
  } catch {
    thumbnail = null; // a missing picture must never cost the version itself
  }
  return saveVersion(project, kind, { name, thumbnail, now: capturedAt });
}

/**
 * Automatic versions: one when a project is opened in a state no version covers yet, and then
 * at most one every ten minutes while it keeps changing (see shouldAutoVersion).
 */
export function useVersionHistory(images: ImageStore, enabled = true) {
  const projectId = useEditorStore((s) => s.project?.id);
  useEffect(() => {
    if (!projectId || !enabled) return;
    let busy = false;
    let stopped = false;
    const check = async () => {
      const project = useEditorStore.getState().project;
      if (busy || stopped || !project || project.id !== projectId) return;
      busy = true;
      try {
        const newest = (await listVersions(projectId))[0]?.createdAt;
        if (!stopped && shouldAutoVersion(project, newest, new Date())) await captureVersion(project, "auto", images);
      } catch {
        /* history is a safety net: it must never get in the way of editing */
      } finally {
        busy = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [projectId, images, enabled]);
}
