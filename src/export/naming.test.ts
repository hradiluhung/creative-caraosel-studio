import { describe, expect, it } from "vitest";
import { slideFileName, slugify, zipFileName } from "./naming";

describe("export naming", () => {
  it("slugifies project names safely", () => {
    expect(slugify("Bali Trip — Day 1!")).toBe("bali-trip-day-1");
    expect(slugify("Café Été")).toBe("cafe-ete");
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify("???")).toBe("carousel");
  });

  it("numbers slides from 1, zero padded, in a sortable way", () => {
    const names = Array.from({ length: 12 }, (_, i) => slideFileName("My Trip", i, 12, "jpeg"));
    expect(names[0]).toBe("my-trip-01.jpg");
    expect(names[11]).toBe("my-trip-12.jpg");
    expect([...names].sort()).toEqual(names);
    expect(slideFileName("My Trip", 2, 3, "png")).toBe("my-trip-03.png");
    expect(zipFileName("My Trip")).toBe("my-trip-slides.zip");
  });
});
