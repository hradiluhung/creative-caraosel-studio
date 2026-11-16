"use client";

import { ChevronDown, ChevronUp, Eye, EyeOff, Image as ImageIcon, Layers2, Lock, Shapes, Sticker, Type, Unlock } from "lucide-react";
import { useState } from "react";
import { getElements, moveElementToIndex, updateElements } from "@/document/operations";
import type { DesignElement } from "@/document/schema";
import { useEditorStore } from "@/store/editorStore";
import { cn } from "@/lib/cn";
import { IconButton } from "../ui/primitives";

const ICONS = { text: Type, image: ImageIcon, shape: Shapes, sticker: Sticker, overlay: Layers2 } as const;

function LayerRow({ el, index, count }: { el: DesignElement; index: number; count: number }) {
  const selected = useEditorStore((s) => s.selection.includes(el.id));
  const activeSurfaceId = useEditorStore((s) => s.activeSurfaceId);
  const [draft, setDraft] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<"above" | "below" | null>(null);
  const Icon = ICONS[el.type];
  const s = () => useEditorStore.getState();
  const patch = (p: Partial<DesignElement>) => s().commit((doc) => updateElements(doc, activeSurfaceId, [el.id], p));

  return (
    <li
      role="option"
      draggable={draft === null}
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-ccs-layer", el.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("application/x-ccs-layer")) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        setDropHint(e.clientY < r.top + r.height / 2 ? "above" : "below");
      }}
      onDragLeave={() => setDropHint(null)}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("application/x-ccs-layer");
        const hint = dropHint;
        setDropHint(null);
        if (!id || id === el.id) return;
        s().commit((doc) => {
          const els = getElements(doc, activeSurfaceId);
          const from = els.findIndex((x) => x.id === id);
          const target = els.findIndex((x) => x.id === el.id);
          if (from < 0 || target < 0) return doc;
          // The list is shown top layer first, so "above" in the list means a higher index.
          let to = hint === "above" ? target + 1 : target;
          if (from < to) to -= 1;
          return moveElementToIndex(doc, activeSurfaceId, id, to);
        });
      }}
      onClick={(e) => (e.shiftKey || e.metaKey || e.ctrlKey ? s().toggleSelect(el.id) : s().select([el.id]))}
      aria-selected={selected}
      className={cn(
        "group flex h-9 items-center gap-1.5 border-y border-transparent pr-1 pl-3 select-none",
        selected ? "bg-sunken" : "hover:bg-sunken/60",
        dropHint === "above" && "border-t-accent",
        dropHint === "below" && "border-b-accent",
        !el.visible && "opacity-50",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted" />
      {draft !== null ? (
        <input
          autoFocus
          aria-label="Layer name"
          value={draft}
          maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => {
            if (draft.trim() && draft.trim() !== el.name) patch({ name: draft.trim() });
            setDraft(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setDraft(null);
          }}
          className="h-6 min-w-0 flex-1 rounded-[3px] border border-ink bg-panel px-1 text-xs outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-xs" title="Double-click to rename" onDoubleClick={() => setDraft(el.name)}>
          {el.name || el.type}
        </span>
      )}
      {selected && draft === null && (
        <>
          <IconButton label="Bring forward" className="h-6 w-6" disabled={index === count - 1} onClick={(e) => (e.stopPropagation(), s().reorder(el.id, "forward"))}>
            <ChevronUp />
          </IconButton>
          <IconButton label="Send backward" className="h-6 w-6" disabled={index === 0} onClick={(e) => (e.stopPropagation(), s().reorder(el.id, "backward"))}>
            <ChevronDown />
          </IconButton>
        </>
      )}
      <IconButton
        label={el.locked ? "Unlock layer" : "Lock layer"}
        className={cn("h-6 w-6", !el.locked && !selected && "md:opacity-0 md:group-hover:opacity-100")}
        onClick={(e) => (e.stopPropagation(), patch({ locked: !el.locked }))}
      >
        {el.locked ? <Lock /> : <Unlock />}
      </IconButton>
      <IconButton
        label={el.visible ? "Hide layer" : "Show layer"}
        className={cn("h-6 w-6", el.visible && !selected && "md:opacity-0 md:group-hover:opacity-100")}
        onClick={(e) => (e.stopPropagation(), patch({ visible: !el.visible }))}
      >
        {el.visible ? <Eye /> : <EyeOff />}
      </IconButton>
    </li>
  );
}

export function LayersPanel() {
  const elements = useEditorStore((s) => (s.project ? getElements(s.project, s.activeSurfaceId) : undefined));
  if (!elements || elements.length === 0) {
    return <p className="px-3.5 py-4 text-xs text-muted">No layers yet. Add text, a shape or an image.</p>;
  }
  // Top-most layer first, like every design tool.
  const rows = elements.map((el, index) => ({ el, index })).reverse();
  return (
    <ul role="listbox" aria-label="Layers" aria-multiselectable className="py-1">
      {rows.map(({ el, index }) => (
        <LayerRow key={el.id} el={el} index={index} count={elements.length} />
      ))}
    </ul>
  );
}
