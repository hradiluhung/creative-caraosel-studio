"use client";

import { useEffect, useRef } from "react";
import { renderThumbnail } from "@/export/exporter";
import { getExportFrames } from "@/document/geometry";
import type { Project } from "@/document/schema";
import { saveProject, saveProjectNow } from "@/persistence/db";
import { describeStorageError } from "@/persistence/errors";
import { saveTemplateDoc } from "@/templates";
import type { ImageStore } from "@/render/resources";
import { useEditorStore } from "@/store/editorStore";

const DEBOUNCE_MS = 700;
/** After a failed save, try again on our own: the cause (full disk, closed connection) is often temporary. */
const RETRY_MS = 5000;
/** Fired by the "Retry" control next to the save status. */
export const RETRY_SAVE_EVENT = "ccs:retry-save";

/**
 * Debounced, non-blocking autosave. Writes are serialized, and anything still
 * pending is flushed when the page is hidden or closed, which is the last
 * reliable moment on iOS before a PWA can be suspended.
 */
/** With `templateId` the document is the template itself and is written to the template store. */
export function useAutosave(images: ImageStore, templateId: string | null = null) {
  const savedRef = useRef<Project | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let timer: number | undefined;
    let retry: number | undefined;
    savedRef.current = useEditorStore.getState().project;

    const save = (withCover: boolean) => {
      const project = useEditorStore.getState().project;
      if (!project || project === savedRef.current) return;
      useEditorStore.getState().setSaveStatus("saving");
      chainRef.current = chainRef.current.then(async () => {
        try {
          let cover: Blob | undefined;
          if (withCover) {
            try {
              cover = await renderThumbnail(project, getExportFrames(project)[0], images, 480);
            } catch {
              cover = undefined; // a failed cover must never block saving the document
            }
          }
          if (templateId) await saveTemplateDoc(templateId, project, cover);
          else await saveProject(project, cover);
          savedRef.current = project;
          const s = useEditorStore.getState();
          if (s.project === project) s.setSaveStatus("saved");
        } catch (e) {
          useEditorStore.getState().setSaveStatus("error", describeStorageError(e, "Could not save"));
          window.clearTimeout(retry);
          retry = window.setTimeout(() => save(false), RETRY_MS);
        }
      });
    };

    const unsubscribe = useEditorStore.subscribe((state, prev) => {
      if (state.project === prev.project || !state.project) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => save(true), DEBOUNCE_MS);
    });

    const flush = () => {
      window.clearTimeout(timer);
      window.clearTimeout(retry);
      save(false);
    };
    // Leaving while the last save failed would lose work: ask first.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useEditorStore.getState().saveStatus === "error") e.preventDefault();
    };
    window.addEventListener(RETRY_SAVE_EVENT, flush);
    window.addEventListener("beforeunload", onBeforeUnload);
    // The page is going away: the normal save is asynchronous and may never get to run, so the
    // document is also queued for writing right now. Whichever finishes, the content is the same.
    const flushNow = () => {
      const project = useEditorStore.getState().project;
      if (project && project !== savedRef.current && !templateId) saveProjectNow(project);
      flush();
    };
    const onVisibility = () => document.visibilityState === "hidden" && flushNow();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushNow);

    return () => {
      flush();
      window.clearTimeout(retry);
      window.removeEventListener(RETRY_SAVE_EVENT, flush);
      window.removeEventListener("beforeunload", onBeforeUnload);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushNow);
    };
  }, [images, templateId]);
}
