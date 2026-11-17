"use client";

import { useEffect, useRef } from "react";
import { renderThumbnail } from "@/export/exporter";
import { getExportFrames } from "@/document/geometry";
import type { Project } from "@/document/schema";
import { saveProject } from "@/persistence/db";
import { saveTemplateDoc } from "@/templates";
import type { ImageStore } from "@/render/resources";
import { useEditorStore } from "@/store/editorStore";

const DEBOUNCE_MS = 700;

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
          useEditorStore.getState().setSaveStatus("error", e instanceof Error ? e.message : "Could not save");
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
      save(false);
    };
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);

    return () => {
      flush();
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [images, templateId]);
}
