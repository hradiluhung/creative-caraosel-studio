/**
 * Built-in templates. Each one is a function that returns a normal project document made of
 * editable elements (text, shapes, stickers, empty photo frames), never a flattened image.
 * To add a template, append a TemplateDef to one of the lists below; the library picks it up.
 *
 * The built-in library is one collection: Photo Journal. Its templates share a visual direction
 * (paper tones, ink, an expressive serif, small captions and numbering) and vary the photo
 * arrangement, composition, typography and text placement.
 */
import type { Project } from "@/document/schema";
import { JOURNAL_TEMPLATES } from "./journal";
import { MORE_JOURNAL_TEMPLATES } from "./journalMore";

export interface TemplateDef {
  id: string;
  name: string;
  category: string;
  build(): Project;
}

export const BUILT_IN_TEMPLATES: TemplateDef[] = [...JOURNAL_TEMPLATES, ...MORE_JOURNAL_TEMPLATES];
