"use client";

import { useEffect, useRef, useState } from "react";
import { renderThumbnail } from "@/export/exporter";
import { getExportFrames } from "@/document/geometry";
import type { Project } from "@/document/schema";
import { ensureFontsLoaded } from "@/render/fonts";
import type { ImageStore } from "@/render/resources";
import { collectFonts } from "@/render/scene";

/**
 * Live slide thumbnails, rendered asynchronously through the export renderer.
 * A slide is only re-rendered when its own content object changed.
 */
export function useSlideThumbnails(project: Project | null, images: ImageStore): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const cache = useRef(new Map<string, { source: object; frameKey: string; url: string }>());
  const [imageTick, setImageTick] = useState(0);

  useEffect(() => images.subscribe(() => setImageTick((t) => t + 1)), [images]);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      await ensureFontsLoaded(collectFonts(project));
      const next: Record<string, string> = {};
      const live = new Set<string>();
      for (const frame of getExportFrames(project)) {
        if (cancelled) return;
        const slide = project.slides[frame.slideIndex];
        // In seamless mode every slide shows a slice of the same panorama object.
        const source: object = project.mode === "seamless" ? project.panorama : slide;
        const frameKey = `${frame.x}:${frame.width}x${frame.height}:${imageTick}`;
        live.add(slide.id);
        const hit = cache.current.get(slide.id);
        if (hit && hit.source === source && hit.frameKey === frameKey) {
          next[slide.id] = hit.url;
          continue;
        }
        try {
          const blob = await renderThumbnail(project, frame, images, 200);
          const url = URL.createObjectURL(blob);
          if (hit) window.setTimeout(() => URL.revokeObjectURL(hit.url), 3000);
          cache.current.set(slide.id, { source, frameKey, url });
          next[slide.id] = url;
        } catch {
          if (hit) next[slide.id] = hit.url;
        }
      }
      for (const [id, entry] of cache.current) {
        if (!live.has(id)) {
          URL.revokeObjectURL(entry.url);
          cache.current.delete(id);
        }
      }
      if (!cancelled) setUrls(next);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [project, images, imageTick]);

  useEffect(() => {
    const entries = cache.current;
    return () => {
      for (const e of entries.values()) URL.revokeObjectURL(e.url);
      entries.clear();
    };
  }, []);

  return urls;
}
