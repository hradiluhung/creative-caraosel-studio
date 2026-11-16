export type ImageFormat = "png" | "jpeg";

export const FORMAT_INFO: Record<ImageFormat, { mime: string; ext: string; label: string }> = {
  png: { mime: "image/png", ext: "png", label: "PNG" },
  jpeg: { mime: "image/jpeg", ext: "jpg", label: "JPG" },
};

/** Filesystem-safe base name. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "carousel";
}

/** carousel-01.jpg, carousel-02.mp4 ... zero padded so files sort in slide order everywhere. */
export function slideFileNameWithExt(projectName: string, slideIndex: number, totalSlides: number, ext: string) {
  const digits = Math.max(2, String(totalSlides).length);
  return `${slugify(projectName)}-${String(slideIndex + 1).padStart(digits, "0")}.${ext}`;
}

export function slideFileName(projectName: string, slideIndex: number, totalSlides: number, format: ImageFormat) {
  return slideFileNameWithExt(projectName, slideIndex, totalSlides, FORMAT_INFO[format].ext);
}

export function zipFileName(projectName: string) {
  return `${slugify(projectName)}-slides.zip`;
}
