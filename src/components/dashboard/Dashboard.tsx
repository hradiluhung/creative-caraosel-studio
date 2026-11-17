"use client";

import { Check, FolderOpen, Images, LayoutTemplate, MoreHorizontal, Palette, Pencil, Plus, Search, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteProject,
  duplicateStoredProject,
  listProjects,
  renameStoredProject,
  requestPersistentStorage,
  type ProjectMeta,
} from "@/persistence/db";
import { useObjectUrl } from "@/lib/useObjectUrl";
import { Button, Dialog, FloatingMenu, IconButton, TextInput } from "../ui/primitives";
import { cn } from "@/lib/cn";
import { describeStorageError } from "@/persistence/errors";
import { whenIdle } from "@/lib/whenIdle";
import { NewProjectDialog } from "./NewProjectDialog";
// The other tabs bring the renderer, the template data and the library with them:
// they are fetched when their tab is opened, so the project list appears sooner.
const loadTabs = () => [import("./AssetLibrary"), import("./BrandKits"), import("./TemplateLibrary")];
const TabLoading = () => <p className="py-16 text-center text-muted">Loading…</p>;
const AssetLibrary = dynamic(() => import("./AssetLibrary").then((m) => m.AssetLibrary), { ssr: false, loading: TabLoading });
const BrandKits = dynamic(() => import("./BrandKits").then((m) => m.BrandKits), { ssr: false, loading: TabLoading });
const TemplateLibrary = dynamic(() => import("./TemplateLibrary").then((m) => m.TemplateLibrary), { ssr: false, loading: TabLoading });

type Tab = "projects" | "templates" | "assets" | "brand";
const TAB_ICONS: Record<Tab, React.ReactNode> = {
  projects: <FolderOpen />,
  templates: <LayoutTemplate />,
  assets: <Images />,
  brand: <Palette />,
};

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "projects", label: "Projects" },
  { id: "templates", label: "Templates" },
  { id: "assets", label: "Assets" },
  { id: "brand", label: "Brand kits" },
];

function formatDate(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const LONG_PRESS_MS = 500;

function ProjectCard({
  meta,
  onMenu,
  selecting,
  selected,
  onToggle,
  onLongPress,
}: {
  meta: ProjectMeta;
  onMenu: (meta: ProjectMeta, x: number, y: number) => void;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onLongPress: () => void;
}) {
  const cover = useObjectUrl(meta.thumbnail);
  // Phones: a long press starts selecting, with this project selected (the click that follows is ignored).
  const press = useRef<{ timer: number; fired: boolean } | null>(null);
  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
  };
  return (
    <article className="group relative" data-testid="project-card" data-selected={selecting ? String(selected) : undefined}>
      <a
        href={`/editor?id=${encodeURIComponent(meta.id)}`}
        className="block"
        onTouchStart={() => {
          if (selecting) return;
          const state = { fired: false, timer: 0 };
          state.timer = window.setTimeout(() => {
            state.fired = true;
            onLongPress();
          }, LONG_PRESS_MS);
          press.current = state;
        }}
        onTouchMove={cancelPress}
        onTouchEnd={cancelPress}
        onContextMenu={(e) => press.current?.fired && e.preventDefault()}
        onClick={(e) => {
          if (press.current?.fired) {
            press.current = null;
            return e.preventDefault();
          }
          if (selecting) {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <div
          className={cn(
            "relative flex aspect-[4/5] items-center justify-center overflow-hidden rounded-md border border-line bg-sunken p-4 transition-colors group-hover:border-line-strong",
            selecting && selected && "border-ink ring-2 ring-ink group-hover:border-ink",
          )}
        >
          {selecting && <span className="sr-only">{selected ? "Selected" : "Not selected"}</span>}
          {selecting && (
            <span aria-hidden className={cn("absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border", selected ? "border-ink bg-ink text-bg" : "border-line-strong bg-bg/80")}>
              {selected && <Check className="h-3.5 w-3.5" />}
            </span>
          )}
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- local blob preview, not a remote image
            <img src={cover} alt="" className="max-h-full max-w-full object-contain shadow-md" />
          ) : (
            <div
              className="max-h-full max-w-full border border-line-strong bg-panel"
              style={{ aspectRatio: `${meta.width} / ${meta.height}`, height: meta.height >= meta.width ? "100%" : undefined, width: meta.width > meta.height ? "100%" : undefined }}
            />
          )}
        </div>
        <h3 className="mt-2.5 truncate pr-8 text-[13px] font-medium">{meta.name}</h3>
        <p className="mt-0.5 text-xs text-muted">
          {meta.slideCount} {meta.slideCount === 1 ? "slide" : "slides"} · {meta.mode === "seamless" ? "Seamless" : "Independent"} ·{" "}
          {formatDate(meta.updatedAt)}
        </p>
      </a>
      {!selecting && (
      <IconButton
        label={`Actions for ${meta.name}`}
        className="absolute right-0 bottom-3.5"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onMenu(meta, r.left, r.bottom + 4);
        }}
      >
        <MoreHorizontal />
      </IconButton>
      )}
    </article>
  );
}

export function Dashboard() {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<{ meta: ProjectMeta; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<{ meta: ProjectMeta; name: string } | null>(null);
  const [deleting, setDeleting] = useState<ProjectMeta | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };
  const togglePicked = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [tab, setTab] = useState<Tab>("projects");
  // Fetch the other tabs once the page is idle: opening them is then instant, and the service
  // worker has them cached, so they also open offline.
  useEffect(() => whenIdle(() => void Promise.all(loadTabs()).catch(() => undefined)), []);
  useEffect(() => {
    // Links such as "Back to templates" open a specific tab.
    const wanted = new URLSearchParams(window.location.search).get("tab");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (wanted === "templates" || wanted === "assets" || wanted === "brand") setTab(wanted);
  }, []);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(
    () =>
      listProjects().then(
        (list) => {
          setProjects(list);
          setError(null);
        },
        (e: unknown) => {
          setError(describeStorageError(e, "Storage is not available in this browser window."));
          setProjects([]);
        },
      ),
    [],
  );

  useEffect(() => {
    void refresh();
    void requestPersistentStorage();
    // Coming back from the editor through the back/forward cache must show fresh data.
    const onShow = (e: PageTransitionEvent) => e.persisted && void refresh();
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [refresh]);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (e) {
      setError(describeStorageError(e, "Something went wrong."));
    }
    await refresh();
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (projects ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [projects, query]);

  return (
    <div className="pt-safe px-safe min-h-full">
      <header className="mx-auto flex max-w-6xl items-end justify-between gap-4 px-5 pt-6 pb-4 sm:px-8 sm:pt-10 sm:pb-6">
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-[0.18em] text-muted uppercase">Creative Carousel Studio</p>
          <h1 className="mt-1 truncate font-display text-[28px] leading-none font-bold tracking-tight sm:text-[34px]">{TABS.find((t) => t.id === tab)?.label}</h1>
        </div>
        {/* Project creation lives on the Projects page only (phones use the floating button there). */}
        {tab === "projects" && (
          <Button variant="primary" className="shrink-0 max-sm:hidden" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New project
          </Button>
        )}
      </header>

      <main className="pb-safe mx-auto max-w-6xl px-5 sm:px-8">
        {/* Wider screens: tabs under the title. Phones use the bar at the bottom instead. */}
        <nav aria-label="Sections" className="mb-6 hidden gap-5 border-b border-line sm:flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => setTab(t.id)}
              className={cn("-mb-px border-b-2 pb-2.5 text-[13px] font-medium", tab === t.id ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink")}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {notice && (
          <p role="status" className="mb-6 rounded-md border border-line bg-sunken px-3 py-2 text-xs">
            {notice}
          </p>
        )}
        {tab === "templates" && <TemplateLibrary />}
        {tab === "assets" && <AssetLibrary />}
        {tab === "brand" && <BrandKits />}
        {tab === "projects" && (
        <>
        <div className="mb-6 flex items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <TextInput aria-label="Search projects" placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
          </div>
          <Button
            variant={selecting ? "primary" : "outline"}
            aria-pressed={selecting}
            disabled={!projects?.length}
            onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
            className="shrink-0"
          >
            {selecting ? "Done" : "Select"}
          </Button>
        </div>
        {selecting && (
          <div className="mb-6 flex min-h-9 flex-wrap items-center gap-2" data-testid="project-bulk-bar">
            <Button size="sm" variant="ghost" disabled={filtered.length === 0} onClick={() => setPicked(new Set(filtered.map((p) => p.id)))}>
              Select all shown ({filtered.length})
            </Button>
            <span className="text-xs text-muted" data-testid="project-bulk-count">
              {picked.size} selected
            </span>
            <span className="grow" />
            <Button size="sm" variant="danger" disabled={picked.size === 0} onClick={() => setBulkDeleting(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete{picked.size ? ` ${picked.size}` : ""}
            </Button>
          </div>
        )}

        {error && (
          <p role="alert" className="mb-6 rounded-md border border-danger/40 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        {projects === null ? (
          <p className="py-16 text-center text-muted">Loading projects…</p>
        ) : projects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-strong px-6 py-20 text-center">
            <p className="font-display text-2xl font-bold">Start your first carousel</p>
            <p className="mx-auto mt-2 max-w-sm text-muted">
              Projects are saved automatically on this device and stay available offline.
            </p>
            <Button variant="primary" className="mt-6" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New project
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-muted">No project matches “{query}”.</p>
        ) : (
          <section aria-label="Recent projects" className="grid grid-cols-2 gap-x-5 gap-y-8 pb-16 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((meta) => (
              <ProjectCard
                key={meta.id}
                meta={meta}
                onMenu={(m, x, y) => setMenu({ meta: m, x, y })}
                selecting={selecting}
                selected={picked.has(meta.id)}
                onToggle={() => togglePicked(meta.id)}
                onLongPress={() => {
                  setSelecting(true);
                  setPicked(new Set([meta.id]));
                }}
              />
            ))}
          </section>
        )}
        </>
        )}
        {/* Room for the phone navigation bar, so the last row is not hidden behind it. */}
        <div aria-hidden className="h-20 sm:hidden" />
      </main>

      <nav aria-label="Sections" data-testid="mobile-nav" className="pb-safe px-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel sm:hidden">
        <div className="grid grid-cols-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => {
                setTab(t.id);
                window.scrollTo({ top: 0 });
              }}
              className={cn("flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium [&_svg]:h-5 [&_svg]:w-5", tab === t.id ? "text-ink" : "text-muted")}
            >
              {TAB_ICONS[t.id]}
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Phones: New project as a floating button above the navigation bar. */}
      {tab === "projects" && !selecting && (
        <button
          type="button"
          data-testid="new-project-fab"
          onClick={() => setCreating(true)}
          className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 flex h-14 items-center gap-2 rounded-full bg-ink pr-5 pl-4 text-sm font-semibold text-bg shadow-lg active:scale-95 sm:hidden"
        >
          <Plus className="h-5 w-5" /> New project
        </button>
      )}

      {bulkDeleting && (
        <Dialog
          title={`Delete ${picked.size} ${picked.size === 1 ? "project" : "projects"}?`}
          onClose={() => setBulkDeleting(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setBulkDeleting(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                data-testid="confirm-bulk-delete-projects"
                onClick={() => {
                  const ids = [...picked];
                  setBulkDeleting(false);
                  stopSelecting();
                  void run(async () => {
                    // One by one: each delete also frees the images only that project used.
                    for (const id of ids) await deleteProject(id);
                  });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete {picked.size}
              </Button>
            </>
          }
        >
          <div className="space-y-2" data-testid="bulk-delete-projects">
            <p>These projects, and the images only they use, will be removed from this device. This cannot be undone.</p>
            <ul className="list-disc space-y-0.5 pl-5 text-xs">
              {(projects ?? [])
                .filter((p) => picked.has(p.id))
                .slice(0, 6)
                .map((p) => (
                  <li key={p.id} className="truncate">
                    {p.name}
                  </li>
                ))}
            </ul>
            {picked.size > 6 && <p className="text-xs text-muted">and {picked.size - 6} more</p>}
          </div>
        </Dialog>
      )}

      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}

      {menu && (
        <FloatingMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "Open", onSelect: () => (window.location.href = `/editor?id=${encodeURIComponent(menu.meta.id)}`) },
            { label: "Rename", onSelect: () => setRenaming({ meta: menu.meta, name: menu.meta.name }) },
            { label: "Duplicate", onSelect: () => run(() => duplicateStoredProject(menu.meta.id)) },
            {
              label: "Save as template",
              onSelect: () =>
                run(async () => {
                  await (await import("@/templates")).saveProjectAsTemplate(menu.meta.id, menu.meta.name);
                  setNotice(`“${menu.meta.name}” was saved to Templates → My templates.`);
                }),
            },
            { label: "Delete", danger: true, onSelect: () => setDeleting(menu.meta) },
          ]}
        />
      )}

      {renaming && (
        <Dialog
          title="Rename project"
          onClose={() => setRenaming(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!renaming.name.trim()}
                onClick={() => {
                  const { meta, name } = renaming;
                  setRenaming(null);
                  void run(() => renameStoredProject(meta.id, name));
                }}
              >
                <Pencil className="h-3.5 w-3.5" /> Rename
              </Button>
            </>
          }
        >
          <TextInput
            aria-label="Project name"
            autoFocus
            maxLength={80}
            value={renaming.name}
            onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
          />
        </Dialog>
      )}

      {deleting && (
        <Dialog
          title="Delete project?"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const meta = deleting;
                  setDeleting(null);
                  void run(() => deleteProject(meta.id));
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </>
          }
        >
          <p>
            “{deleting.name}” and the images only it uses will be removed from this device. This cannot be undone.
          </p>
        </Dialog>
      )}
    </div>
  );
}
