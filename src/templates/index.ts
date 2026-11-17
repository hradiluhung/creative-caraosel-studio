/**
 * Template registry: built-in templates (code) plus templates the user saved (IndexedDB).
 * Both kinds are plain project documents, so "using" a template is just cloning it.
 */
import { createId } from "@/document/ids";
import { parseProject } from "@/document/migrations";
import { cloneProject } from "@/document/operations";
import type { Project } from "@/document/schema";
import { deleteStoredTemplate, getStoredTemplate, listProjects, listStoredTemplates, loadProject, patchStoredTemplate, putStoredTemplate, saveProject } from "@/persistence/db";
import { BUILT_IN_TEMPLATES } from "./builtin";

import { cleanTemplateCategory, cleanTemplateDescription, cleanTemplateName, MY_TEMPLATES } from "./model";

export { MY_TEMPLATES };

export interface TemplateInfo {
  id: string;
  name: string;
  category: string;
  description?: string;
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
      user.push({ id: t.id, name: t.name, category: t.category, description: t.description, source: "user", doc: parseProject(t.doc), thumbnail: t.thumbnail });
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

/** A user template opened for editing, or null when it does not exist (or no longer validates). */
export async function loadUserTemplate(id: string): Promise<TemplateInfo | null> {
  const t = await getStoredTemplate(id);
  if (!t) return null;
  return { id: t.id, name: t.name, category: t.category, description: t.description, source: "user", doc: parseProject(t.doc), thumbnail: t.thumbnail };
}

/** Autosave target of the template editor: the document, and the name and cover that follow from it. */
export async function saveTemplateDoc(id: string, doc: Project, thumbnail?: Blob): Promise<void> {
  const found = await patchStoredTemplate(id, { doc, name: cleanTemplateName(doc.name), ...(thumbnail ? { thumbnail } : {}) });
  if (!found) throw new Error("This template was deleted.");
}

export async function updateTemplateDetails(id: string, details: { category: string; description: string }): Promise<void> {
  await patchStoredTemplate(id, { category: cleanTemplateCategory(details.category), description: cleanTemplateDescription(details.description) });
}

/**
 * An editable copy in "My templates". Works for built-in templates too, which is how one of
 * them becomes the starting point of an own template.
 */
export async function duplicateTemplate(template: TemplateInfo, now = new Date()): Promise<string> {
  const name = cleanTemplateName(`${template.name} copy`);
  const id = createId();
  await putStoredTemplate({
    id,
    name,
    category: template.source === "user" ? template.category : MY_TEMPLATES,
    description: template.description,
    doc: { ...cloneProject(template.doc, name, now), brandKitId: null },
    thumbnail: template.thumbnail,
    createdAt: now.toISOString(),
  });
  return id;
}

export { deleteStoredTemplate as deleteUserTemplate };
