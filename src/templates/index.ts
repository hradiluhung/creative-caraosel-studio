/**
 * Template registry: built-in templates (code) plus templates the user saved (IndexedDB).
 * Both kinds are plain project documents, so "using" a template is just cloning it.
 */
import { createId } from "@/document/ids";
import { parseProject } from "@/document/migrations";
import { cloneProject } from "@/document/operations";
import type { Project } from "@/document/schema";
import { deleteStoredTemplate, listProjects, listStoredTemplates, loadProject, putStoredTemplate, saveProject } from "@/persistence/db";
import { BUILT_IN_TEMPLATES } from "./builtin";

export const MY_TEMPLATES = "My templates";

export interface TemplateInfo {
  id: string;
  name: string;
  category: string;
  source: "builtin" | "user";
  doc: Project;
  /** Stored cover for user templates; built-ins are rendered live. */
  thumbnail: Blob | null;
}

let builtIns: TemplateInfo[] | null = null;

export function listBuiltInTemplates(): TemplateInfo[] {
  builtIns ??= BUILT_IN_TEMPLATES.map((t) => ({ id: t.id, name: t.name, category: t.category, source: "builtin" as const, doc: t.build(), thumbnail: null }));
  return builtIns;
}

export async function listAllTemplates(): Promise<TemplateInfo[]> {
  const user: TemplateInfo[] = [];
  for (const t of await listStoredTemplates().catch(() => [])) {
    try {
      user.push({ id: t.id, name: t.name, category: t.category, source: "user", doc: parseProject(t.doc), thumbnail: t.thumbnail });
    } catch {
      /* skip templates that no longer validate instead of breaking the library */
    }
  }
  return [...user, ...listBuiltInTemplates()];
}

/** New independent project from a template: fresh ids everywhere, same editable content. */
export function instantiateTemplate(template: Pick<TemplateInfo, "doc">, name: string, now = new Date()): Project {
  return { ...cloneProject(template.doc, name.trim() || "Untitled project", now), brandKitId: null };
}

export async function createProjectFromTemplate(template: TemplateInfo, name: string): Promise<Project> {
  const project = instantiateTemplate(template, name);
  await saveProject(project, template.thumbnail);
  return project;
}

export async function saveProjectAsTemplate(projectId: string, name: string): Promise<void> {
  const project = await loadProject(projectId);
  if (!project) throw new Error("The project could not be found.");
  const meta = (await listProjects()).find((m) => m.id === projectId);
  await putStoredTemplate({
    id: createId(),
    name: name.trim() || project.name,
    category: MY_TEMPLATES,
    doc: cloneProject(project, name.trim() || project.name),
    thumbnail: meta?.thumbnail ?? null,
    createdAt: new Date().toISOString(),
  });
}

export { deleteStoredTemplate as deleteUserTemplate };
