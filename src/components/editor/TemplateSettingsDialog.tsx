"use client";

import { useMemo, useState } from "react";
import { useEditorStore } from "@/store/editorStore";
import { updateTemplateDetails } from "@/templates";
import { countFrames, MAX_TEMPLATE_DESCRIPTION, stripPhotos, TEMPLATE_CATEGORIES } from "@/templates/model";
import { Button, Dialog, Label, Select } from "../ui/primitives";

export interface TemplateDetails {
  id: string;
  category: string;
  description: string;
}

/** Category, description and photo frames of the template that is open in the editor. */
export function TemplateSettingsDialog({ template, onSaved, onClose }: { template: TemplateDetails; onSaved: (next: TemplateDetails) => void; onClose: () => void }) {
  const project = useEditorStore((s) => s.project);
  const [category, setCategory] = useState(template.category);
  const [description, setDescription] = useState(template.description);
  const [error, setError] = useState<string | null>(null);
  const frames = useMemo(() => (project ? countFrames(project) : { empty: 0, filled: 0 }), [project]);
  const categories = TEMPLATE_CATEGORIES.includes(category as (typeof TEMPLATE_CATEGORIES)[number]) ? [...TEMPLATE_CATEGORIES] : [category, ...TEMPLATE_CATEGORIES];
  const dirty = category !== template.category || description !== template.description;

  const save = async () => {
    try {
      await updateTemplateDetails(template.id, { category, description });
      onSaved({ id: template.id, category, description: description.trim() });
      onClose();
    } catch {
      setError("The template details could not be saved.");
    }
  };

  return (
    <Dialog
      title="Template settings"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" disabled={!dirty} onClick={() => void save()}>
            Save details
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-muted">You are editing a template. Changes are saved to the template itself; projects that were already made from it do not change. The name is the one in the top bar.</p>
        <div className="space-y-1.5">
          <Label>Category</Label>
          <Select label="Template category" value={category} onChange={setCategory} options={categories.map((c) => ({ value: c, label: c }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="template-description">Description</Label>
          <textarea
            id="template-description"
            value={description}
            maxLength={MAX_TEMPLATE_DESCRIPTION}
            rows={3}
            placeholder="What is this template for?"
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            className="w-full resize-none rounded-[5px] border border-line bg-panel px-2.5 py-2 text-[13px] outline-none focus:border-ink"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Photo frames</Label>
          <p className="text-xs text-muted" data-testid="template-frames">
            {frames.empty} empty frame{frames.empty === 1 ? "" : "s"} waiting for photos, {frames.filled} frame{frames.filled === 1 ? "" : "s"} with a photo that ships with the template.
          </p>
          <Button
            size="sm"
            disabled={frames.filled === 0}
            onClick={() => {
              useEditorStore.getState().commit((p) => stripPhotos(p));
            }}
          >
            Turn all photos into empty frames
          </Button>
          <p className="text-[11px] text-muted">One step, and it can be undone. A single photo can be emptied from its properties (“Turn into empty frame”).</p>
        </div>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
