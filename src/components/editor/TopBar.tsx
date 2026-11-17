"use client";

import { ArrowLeft, Download, History, LayoutTemplate, Maximize, Minus, PanelLeft, PanelRight, Plus, Redo2, Undo2 } from "lucide-react";
import { useState } from "react";
import { renameProject } from "@/document/operations";
import { useEditorStore } from "@/store/editorStore";
import { Button, IconButton } from "../ui/primitives";
import { canvasApi } from "./canvasApi";

const STATUS_TEXT = { saved: "Saved", dirty: "Unsaved changes", saving: "Saving…", error: "Save failed" } as const;

export function SaveStatus() {
  const status = useEditorStore((s) => s.saveStatus);
  const error = useEditorStore((s) => s.saveError);
  return (
    <span
      role="status"
      data-testid="save-status"
      data-status={status}
      title={error ?? undefined}
      className={status === "error" ? "text-xs text-danger" : "text-xs text-muted"}
    >
      {STATUS_TEXT[status]}
    </span>
  );
}

export function TopBar({
  compact,
  onExport,
  onHistory,
  onTemplateSettings,
  onTogglePanel,
}: {
  compact: boolean;
  onExport: () => void;
  onHistory: () => void;
  /** Set while a template (not a project) is open: replaces version history with template settings. */
  onTemplateSettings?: () => void;
  onTogglePanel?: (side: "left" | "right") => void;
}) {
  const name = useEditorStore((s) => s.project?.name ?? "");
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const zoom = useEditorStore((s) => s.zoom);
  const [draft, setDraft] = useState<string | null>(null);
  const s = () => useEditorStore.getState();

  return (
    <header className="pt-safe px-safe border-b border-line bg-panel">
      <div className="flex h-12 items-center gap-1 px-2">
        <a href={onTemplateSettings ? "/?tab=templates" : "/"} aria-label={onTemplateSettings ? "Back to templates" : "Back to projects"} title={onTemplateSettings ? "Back to templates" : "Back to projects"} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] hover:bg-sunken">
          <ArrowLeft className="h-4 w-4" />
        </a>
        {!compact && onTogglePanel && (
          <IconButton label="Toggle insert panel" onClick={() => onTogglePanel("left")}>
            <PanelLeft />
          </IconButton>
        )}
        <input
          aria-label={onTemplateSettings ? "Template name" : "Project name"}
          value={draft ?? name}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== null) s().commit((p) => renameProject(p, draft));
            setDraft(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(null);
              e.currentTarget.blur();
            }
          }}
          className="h-8 min-w-0 flex-1 truncate rounded-[5px] border border-transparent bg-transparent px-2 text-[13px] font-semibold outline-none hover:border-line focus:border-ink md:max-w-64 md:flex-none"
        />
        {onTemplateSettings && (
          <button
            type="button"
            data-testid="template-badge"
            onClick={onTemplateSettings}
            className="flex h-6 shrink-0 items-center gap-1 rounded-full border border-ink px-2 text-[11px] font-semibold hover:bg-sunken"
          >
            <LayoutTemplate className="h-3 w-3" /> Template
          </button>
        )}
        {!compact && <SaveStatus />}
        <div className="flex-1 max-md:hidden" />
        <IconButton label="Undo" disabled={!canUndo} onClick={() => s().undo()}>
          <Undo2 />
        </IconButton>
        <IconButton label="Redo" disabled={!canRedo} onClick={() => s().redo()}>
          <Redo2 />
        </IconButton>
        {onTemplateSettings ? (
          <IconButton label="Template settings" onClick={onTemplateSettings}>
            <LayoutTemplate />
          </IconButton>
        ) : (
          <IconButton label="Version history" onClick={onHistory}>
            <History />
          </IconButton>
        )}
        {!compact && (
          <div className="mx-2 flex items-center">
            <IconButton label="Zoom out" onClick={() => canvasApi.zoomBy(1 / 1.25)}>
              <Minus />
            </IconButton>
            <button
              type="button"
              title="Zoom to 100%"
              aria-label={`Zoom ${Math.round(zoom * 100)} percent. Click for 100 percent`}
              onClick={() => canvasApi.zoomTo(1)}
              className="h-8 w-14 rounded-[5px] text-center text-xs tabular-nums hover:bg-sunken"
            >
              {Math.round(zoom * 100)}%
            </button>
            <IconButton label="Zoom in" onClick={() => canvasApi.zoomBy(1.25)}>
              <Plus />
            </IconButton>
            <IconButton label="Fit canvas to screen" onClick={() => canvasApi.fit()}>
              <Maximize />
            </IconButton>
          </div>
        )}
        <Button variant="primary" size={compact ? "sm" : "md"} onClick={onExport}>
          <Download className="h-3.5 w-3.5" /> Export
        </Button>
        {!compact && onTogglePanel && (
          <IconButton label="Toggle properties panel" onClick={() => onTogglePanel("right")}>
            <PanelRight />
          </IconButton>
        )}
      </div>
    </header>
  );
}
