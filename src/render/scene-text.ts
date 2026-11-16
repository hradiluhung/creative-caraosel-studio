import type { TextElement } from "@/document/schema";

/** Text as it is drawn: letter case is a render-time effect, the stored text never changes. */
export function displayText(el: Pick<TextElement, "text" | "transform">): string {
  switch (el.transform) {
    case "uppercase":
      return el.text.toUpperCase();
    case "lowercase":
      return el.text.toLowerCase();
    case "capitalize":
      return el.text.replace(/(^|\s)(\p{L})/gu, (_m, space: string, ch: string) => space + ch.toUpperCase());
    default:
      return el.text;
  }
}

