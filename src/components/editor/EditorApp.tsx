"use client";

import { Layers, Maximize, PaintBucket, Plus, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DocumentError } from "@/document/migrations";
import { loadCustomFonts } from "@/persistence/customFonts";
import { getAssetBlob, getAssetPoster, getAssetProxy, getBrandKit, loadProject } from "@/persistence/db";
import { ensureProxy, subscribeProxies } from "@/persistence/proxy";
import { ImageStore } from "@/render/resources";
import { useEditorStore } from "@/store/editorStore";
import { cn } from "@/lib/cn";
import { useIsMobile } from "@/lib/useMediaQuery";
import { Button, Sheet } from "../ui/primitives";
import { importMedia } from "./actions";
import { canvasApi } from "./canvasApi";
import { CanvasStage } from "./CanvasStage";
import { ExportDialog } from "./ExportDialog";
import { BackgroundControls, InsertPanel } from "./InsertPanel";
import { LayersPanel } from "./LayersPanel";
import { Timeline } from "./Timeline";
import { PropertiesPanel } from "./PropertiesPanel";
import { SlideNavigator } from "./SlideNavigator";
import { SaveStatus, TopBar } from "./TopBar";
import { useAutosave } from "./useAutosave";
import { useVersionHistory } from "./useVersionHistory";
import { loadUserTemplate } from "@/templates";
import { TemplateSettingsDialog, type TemplateDetails } from "./TemplateSettingsDialog";
import { VersionHistoryDialog } from "./VersionHistoryDialog";
import { useSlideThumbnails } from "./useSlideThumbnails";

type LoadState = { kind: "loading" } | { kind: "ready"; template: TemplateDetails | null } | { kind: "error"; message: string; details?: string[] };
type MobileSheet = "insert" | "edit" | "layers" | "background" | null;

function useEditorShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      const s = useEditorStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const handled = () => e.preventDefault();
      if (mod && key === "z") return handled(), e.shiftKey ? s.redo() : s.undo();
      if (mod && key === "y") return handled(), s.redo();
      if (mod && key === "c") return s.selection.length > 0 ? (handled(), s.copySelected()) : undefined;
      if (mod && key === "x") return s.selection.length > 0 ? (handled(), s.copySelected(), s.deleteSelected()) : undefined;
      if (mod && key === "v") return s.clipboard.length > 0 ? (handled(), s.paste()) : undefined;
      if (mod && key === "d") return handled(), s.duplicateSelected();
      if (mod && key === "a") {
        const p = s.project;
        if (!p) return;
        handled();
        const els = p.mode === "seamless" ? p.panorama.elements : (p.slides.find((sl) => sl.id === s.activeSurfaceId)?.elements ?? []);
        return s.select(els.filter((el) => !el.locked && el.visible).map((el) => el.id));
      }
      if (mod && (key === "0" || key === "1")) return handled(), key === "0" ? canvasApi.fit() : canvasApi.zoomTo(1);
      if (mod && (key === "=" || key === "+")) return handled(), canvasApi.zoomBy(1.25);
      if (mod && key === "-") return handled(), canvasApi.zoomBy(1 / 1.25);
      if (mod) return;
      if (key === "delete" || key === "backspace") return handled(), s.deleteSelected();
      if (key === "escape") return s.select([]);
      const step = e.shiftKey ? 10 : 1;
      if (key === "arrowleft") return handled(), s.nudgeSelected(-step, 0);
      if (key === "arrowright") return handled(), s.nudgeSelected(step, 0);
      if (key === "arrowup") return handled(), s.nudgeSelected(0, -step);
      if (key === "arrowdown") return handled(), s.nudgeSelected(0, step);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

function Workspace({ images, template: openedTemplate }: { images: ImageStore; template: TemplateDetails | null }) {
  const [template, setTemplate] = useState(openedTemplate);
  const [templateSettings, setTemplateSettings] = useState(false);
  const isMobile = useIsMobile();
  const project = useEditorStore((s) => s.project);
  const hasSelection = useEditorStore((s) => s.selection.length > 0);
  const thumbnails = useSlideThumbnails(project, images);
  const [exporting, setExporting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [panels, setPanels] = useState({ left: true, right: true });
  const [requestedSheet, setSheet] = useState<MobileSheet>(null);
  // A sheet about the selection makes no sense once nothing is selected.
  const sheet = requestedSheet === "edit" && !hasSelection ? null : requestedSheet;
  const [dropActive, setDropActive] = useState(false);
  const [dropErrors, setDropErrors] = useState<string[]>([]);

  useAutosave(images, template?.id ?? null);
  useVersionHistory(images, !template);

  // Keep the attached brand kit loaded for the color fields and the Brand section.
  const brandKitId = project?.brandKitId ?? null;
  useEffect(() => {
    let live = true;
    const setKit = useEditorStore.getState().setBrandKit;
    if (!brandKitId) setKit(null);
    else void getBrandKit(brandKitId).then((kit) => live && setKit(kit ?? null), () => live && setKit(null));
    return () => {
      live = false;
    };
  }, [brandKitId]);
  useEditorShortcuts(!exporting && !historyOpen && !templateSettings);
  const onTemplateSettings = template ? () => setTemplateSettings(true) : undefined;
  const templateDialog = template && templateSettings && <TemplateSettingsDialog template={template} onSaved={setTemplate} onClose={() => setTemplateSettings(false)} />;

  // Heavy videos get a light preview copy in the background (also ones imported before this existed).
  const assets = project?.assets;
  useEffect(() => {
    assets?.forEach(ensureProxy);
  }, [assets]);
  useEffect(() => subscribeProxies((assetId, state) => state.status === "ready" && void images.refreshPreview(assetId)), [images]);

  const canvas = (
    <div
      className="relative min-h-0 min-w-0 flex-1"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDropActive(false);
        void importMedia(Array.from(e.dataTransfer.files)).then(setDropErrors);
      }}
    >
      <CanvasStage images={images} />
      {dropActive && (
        <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent/10 text-sm font-medium">
          Drop images or videos to add them
        </div>
      )}
      {dropErrors.length > 0 && (
        <div role="alert" className="absolute top-3 left-1/2 w-[min(90%,420px)] -translate-x-1/2 rounded-md border border-danger/40 bg-panel px-3 py-2 text-xs text-danger shadow-lg">
          {dropErrors.map((e) => (
            <p key={e}>{e}</p>
          ))}
          <button type="button" className="mt-1 underline" onClick={() => setDropErrors([])}>
            Dismiss
          </button>
        </div>
      )}
      {isMobile && (
        <div className="absolute top-2 right-2 left-2 flex items-center justify-between">
          <span className="rounded-full bg-panel/85 px-2 py-0.5 backdrop-blur">
            <SaveStatus />
          </span>
          <button
            type="button"
            aria-label="Fit canvas to screen"
            onClick={() => canvasApi.fit()}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-panel/90 shadow-sm backdrop-blur"
          >
            <Maximize className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );

  if (isMobile) {
    const tools: Array<{ id: Exclude<MobileSheet, null>; label: string; icon: React.ReactNode; disabled?: boolean }> = [
      { id: "insert", label: "Add", icon: <Plus /> },
      { id: "edit", label: "Edit", icon: <SlidersHorizontal />, disabled: !hasSelection },
      { id: "layers", label: "Layers", icon: <Layers /> },
      { id: "background", label: "Canvas", icon: <PaintBucket /> },
    ];
    return (
      <div className="flex h-dvh flex-col overflow-hidden">
        <TopBar compact onExport={() => setExporting(true)} onHistory={() => setHistoryOpen(true)} onTemplateSettings={onTemplateSettings} />
        {canvas}
        {!sheet && <Timeline />}
        {sheet === "insert" && (
          <Sheet title="Add" onClose={() => setSheet(null)}>
            <InsertPanel images={images} />
          </Sheet>
        )}
        {sheet === "edit" && (
          <Sheet title="Edit" onClose={() => setSheet(null)}>
            <PropertiesPanel />
          </Sheet>
        )}
        {sheet === "layers" && (
          <Sheet title="Layers" onClose={() => setSheet(null)}>
            <LayersPanel />
          </Sheet>
        )}
        {sheet === "background" && (
          <Sheet title="Canvas" onClose={() => setSheet(null)}>
            <div className="px-3.5 py-3.5">
              <BackgroundControls />
            </div>
          </Sheet>
        )}
        {!sheet && <SlideNavigator thumbnails={thumbnails} compact />}
        <nav aria-label="Editor tools" className="pb-safe px-safe grid grid-cols-4 border-t border-line bg-panel">
          {tools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              disabled={tool.disabled}
              aria-pressed={sheet === tool.id}
              onClick={() => setSheet(sheet === tool.id ? null : tool.id)}
              className={cn(
                "flex h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium disabled:opacity-30 [&_svg]:h-5 [&_svg]:w-5",
                sheet === tool.id ? "text-ink" : "text-muted",
              )}
            >
              {tool.icon}
              {tool.label}
            </button>
          ))}
        </nav>
        {exporting && <ExportDialog images={images} onClose={() => setExporting(false)} />}
        {historyOpen && <VersionHistoryDialog images={images} onClose={() => setHistoryOpen(false)} />}
        {templateDialog}
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar compact={false} onExport={() => setExporting(true)} onHistory={() => setHistoryOpen(true)} onTemplateSettings={onTemplateSettings} onTogglePanel={(side) => setPanels((p) => ({ ...p, [side]: !p[side] }))} />
      <div className="flex min-h-0 flex-1">
        {panels.left && (
          <aside aria-label="Insert" className="thin-scroll w-60 shrink-0 overflow-y-auto border-r border-line bg-panel">
            <InsertPanel images={images} />
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          {canvas}
          <Timeline />
          <SlideNavigator thumbnails={thumbnails} />
        </div>
        {panels.right && (
          <aside aria-label="Properties and layers" className="flex w-64 shrink-0 flex-col border-l border-line bg-panel">
            <div className="thin-scroll min-h-0 flex-[3] overflow-y-auto">
              <PropertiesPanel />
            </div>
            <div className="flex min-h-0 flex-[2] flex-col border-t border-line">
              <h2 className="px-3.5 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">Layers</h2>
              <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
                <LayersPanel />
              </div>
            </div>
          </aside>
        )}
      </div>
      {exporting && <ExportDialog images={images} onClose={() => setExporting(false)} />}
        {historyOpen && <VersionHistoryDialog images={images} onClose={() => setHistoryOpen(false)} />}
        {templateDialog}
    </div>
  );
}

export default function EditorApp() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const images = useMemo(() => new ImageStore(getAssetBlob, getAssetPoster, getAssetProxy), []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const templateId = params.get("template");
    (async () => {
      if (!id && !templateId) return setState({ kind: "error", message: "No project was specified." });
      try {
        // Custom fonts must be registered before any text is measured or drawn.
        await loadCustomFonts();
        if (templateId) {
          // Template mode: the same editor, working on the template's own document.
          const template = await loadUserTemplate(templateId);
          if (cancelled) return;
          if (!template) return setState({ kind: "error", message: "This template does not exist on this device." });
          useEditorStore.getState().open(template.doc);
          return setState({ kind: "ready", template: { id: template.id, category: template.category, description: template.description ?? "" } });
        }
        const project = await loadProject(id!);
        if (cancelled) return;
        if (!project) return setState({ kind: "error", message: "This project does not exist on this device." });
        useEditorStore.getState().open(project);
        setState({ kind: "ready", template: null });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof DocumentError) setState({ kind: "error", message: e.message, details: e.issues.slice(0, 5) });
        else setState({ kind: "error", message: e instanceof Error ? e.message : "The project could not be opened." });
      }
    })();
    return () => {
      cancelled = true;
      useEditorStore.getState().close();
      images.dispose();
    };
  }, [images]);

  if (state.kind === "loading") {
    return <div className="flex h-dvh items-center justify-center text-muted">Opening project…</div>;
  }
  if (state.kind === "error") {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-display text-2xl font-bold">Could not open this project</p>
        <p role="alert" className="max-w-md text-muted">
          {state.message}
        </p>
        {state.details && (
          <ul className="max-w-md text-left font-mono text-[11px] text-muted">
            {state.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
        <Button onClick={() => (window.location.href = "/")}>Back to projects</Button>
      </div>
    );
  }
  return <Workspace images={images} template={state.template} />;
}
