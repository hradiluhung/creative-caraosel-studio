"use client";

import { MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
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

function ProjectCard({ meta, onMenu }: { meta: ProjectMeta; onMenu: (meta: ProjectMeta, x: number, y: number) => void }) {
  const cover = useObjectUrl(meta.thumbnail);
  return (
    <article className="group relative">
      <a href={`/editor?id=${encodeURIComponent(meta.id)}`} className="block">
        <div className="flex aspect-[4/5] items-center justify-center overflow-hidden rounded-md border border-line bg-sunken p-4 transition-colors group-hover:border-line-strong">
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
      <header className="mx-auto flex max-w-6xl items-end justify-between gap-4 px-5 pt-10 pb-6 sm:px-8">
        <div>
          <p className="text-[11px] font-medium tracking-[0.18em] text-muted uppercase">Creative Carousel Studio</p>
          <h1 className="mt-1 font-display text-[34px] leading-none font-bold tracking-tight">{TABS.find((t) => t.id === tab)?.label}</h1>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New project
        </Button>
      </header>

      <main className="pb-safe mx-auto max-w-6xl px-5 sm:px-8">
        <nav aria-label="Sections" className="mb-6 flex gap-5 border-b border-line">
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
        <div className="relative mb-6 max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <TextInput aria-label="Search projects" placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
        </div>

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
              <ProjectCard key={meta.id} meta={meta} onMenu={(m, x, y) => setMenu({ meta: m, x, y })} />
            ))}
          </section>
        )}
        </>
        )}
      </main>

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
