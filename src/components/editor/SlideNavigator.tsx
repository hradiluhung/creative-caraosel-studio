"use client";

import { ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { renameSlide } from "@/document/operations";
import { MAX_SLIDES } from "@/document/schema";
import { useEditorStore } from "@/store/editorStore";
import { cn } from "@/lib/cn";
import { IconButton } from "../ui/primitives";
import { canvasApi } from "./canvasApi";

export function SlideNavigator({ thumbnails, compact = false }: { thumbnails: Record<string, string>; compact?: boolean }) {
  const project = useEditorStore((s) => s.project);
  const focusIndex = useEditorStore((s) => s.focusSlideIndex);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  if (!project) return null;

  const s = () => useEditorStore.getState();
  const seamless = project.mode === "seamless";
  const active = project.slides[focusIndex] ?? project.slides[0];
  const full = project.slides.length >= MAX_SLIDES;
  const thumbH = compact ? 44 : 64;
  const thumbW = Math.max(24, Math.min(140, (thumbH * project.width) / project.height));

  const go = (index: number, id: string) => {
    if (seamless) {
      s().setFocusSlide(index);
      canvasApi.focusSlide(index);
    } else {
      s().setActiveSurface(id);
    }
  };

  return (
    <div className="flex items-stretch border-t border-line bg-panel">
      <ol aria-label="Slides" className={cn("thin-scroll flex flex-1 items-start overflow-x-auto px-3", compact ? "gap-1.5 py-1.5" : "gap-2 py-2.5", seamless && "gap-0")}>
        {project.slides.map((slide, index) => {
          const isActive = index === focusIndex;
          return (
            <li
              key={slide.id}
              draggable={!seamless && !renaming}
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-ccs-slide", slide.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (seamless || !e.dataTransfer.types.includes("application/x-ccs-slide")) return;
                e.preventDefault();
                setDropTarget(slide.id);
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDropTarget(null);
                const id = e.dataTransfer.getData("application/x-ccs-slide");
                if (id && id !== slide.id) s().moveSlide(id, index);
              }}
              className="shrink-0"
            >
              <button
                type="button"
                aria-label={`${slide.name} (${index + 1} of ${project.slides.length})`}
                aria-current={isActive}
                onClick={() => go(index, slide.id)}
                style={{ width: thumbW, height: thumbH }}
                className={cn(
                  "relative block overflow-hidden bg-sunken outline-1 -outline-offset-1",
                  seamless ? "rounded-none" : "rounded-[3px]",
                  isActive ? "outline-2 outline-ink" : "outline-line-strong",
                  dropTarget === slide.id && "outline-2 outline-accent",
                )}
              >
                {thumbnails[slide.id] && (
                  // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                  <img src={thumbnails[slide.id]} alt="" draggable={false} className="h-full w-full object-fill" />
                )}
                <span className="absolute bottom-0.5 left-0.5 rounded-[2px] bg-black/60 px-1 text-[9px] leading-[14px] font-medium text-white tabular-nums">
                  {index + 1}
                </span>
              </button>
              {!compact && !seamless && (
                renaming?.id === slide.id ? (
                  <input
                    autoFocus
                    aria-label="Slide name"
                    value={renaming.name}
                    maxLength={40}
                    onChange={(e) => setRenaming({ id: slide.id, name: e.target.value })}
                    onBlur={() => {
                      s().commit((p) => renameSlide(p, slide.id, renaming.name));
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    style={{ width: thumbW }}
                    className="mt-1 block h-4 rounded-[2px] border border-ink bg-panel px-0.5 text-[10px] outline-none"
                  />
                ) : (
                  <span
                    title="Double-click to rename"
                    onDoubleClick={() => setRenaming({ id: slide.id, name: slide.name })}
                    style={{ width: thumbW }}
                    className="mt-1 block truncate text-center text-[10px] leading-4 text-muted"
                  >
                    {slide.name}
                  </span>
                )
              )}
            </li>
          );
        })}
      </ol>

      <div className={cn("flex shrink-0 items-center gap-0.5 border-l border-line px-2", compact && "px-1")}>
        {!seamless && (
          <>
            <IconButton label="Move slide left" disabled={focusIndex === 0} onClick={() => s().moveSlide(active.id, focusIndex - 1)}>
              <ChevronLeft />
            </IconButton>
            <IconButton label="Move slide right" disabled={focusIndex >= project.slides.length - 1} onClick={() => s().moveSlide(active.id, focusIndex + 1)}>
              <ChevronRight />
            </IconButton>
            <IconButton label="Duplicate slide" disabled={full} onClick={() => s().duplicateSlide(active.id)}>
              <Copy />
            </IconButton>
          </>
        )}
        <IconButton
          label={seamless ? "Remove last slide" : "Delete slide"}
          disabled={project.slides.length <= 1}
          onClick={() => s().removeSlide(seamless ? project.slides[project.slides.length - 1].id : active.id)}
        >
          <Trash2 />
        </IconButton>
        <IconButton label={seamless ? "Extend panorama by one slide" : "Add slide"} disabled={full} onClick={() => s().addSlide()}>
          <Plus />
        </IconButton>
      </div>
    </div>
  );
}
