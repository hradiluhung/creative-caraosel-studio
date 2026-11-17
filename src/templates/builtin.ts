/**
 * Built-in templates. Each one is a function that returns a normal project document made of
 * editable elements (text, shapes, stickers, photo placeholders), never a flattened image.
 * To add a template, append a TemplateDef to BUILT_IN_TEMPLATES; the library picks it up.
 */
import { createOverlay } from "@/document/factory";
import { PANORAMA_ID } from "@/document/geometry";
import { addElements } from "@/document/operations";
import type { DesignElement, Project } from "@/document/schema";
import { JOURNAL_TEMPLATES } from "./journal";
import { H, independent, linear, P, photo, seamless, shadow, shape, solid, sticker, text, W, type Box } from "./kit";

export interface TemplateDef {
  id: string;
  name: string;
  category: string;
  build(): Project;
}

export const BUILT_IN_TEMPLATES: TemplateDef[] = [
  // Photo journals first: the main direction of the template library.
  ...JOURNAL_TEMPLATES,
  {
    id: "quiet-minimal",
    name: "Quiet Minimal",
    category: "Minimalist",
    build: () =>
      independent("Quiet Minimal", W, H, [
        {
          bg: solid("#f3efe8"),
          els: [
            text("VOL. 01", [90, 110, 400], { size: 26, letterSpacing: 6, fill: "#7a746a" }),
            text("Slow\nmornings", [90, 420, 900], { size: 170, fontFamily: "Cormorant Garamond", fill: "#1f1d1a", lineHeight: 0.95 }),
            shape("rect", [90, 800, 120, 3], "#1f1d1a"),
            text("A short series on doing less,\nand noticing more.", [90, 850, 700], { size: 36, fill: "#4b463f", lineHeight: 1.4 }),
            text("Swipe →", [90, 1200, 300], { size: 28, fill: "#7a746a" }),
          ],
        },
        ...[1, 2, 3].map((n) => ({
          bg: solid("#f3efe8"),
          els: [
            photo([90, 110, 900, 760]),
            text(`0${n}`, [90, 930, 200], { size: 28, letterSpacing: 4, fill: "#7a746a" }),
            text("Write one calm thought here", [90, 990, 900], { size: 66, fontFamily: "Cormorant Garamond", fill: "#1f1d1a" }),
            text("Add a supporting sentence that gives the photo some context.", [90, 1150, 800], { size: 30, fill: "#4b463f", lineHeight: 1.4 }),
          ] as DesignElement[],
        })),
        {
          bg: solid("#1f1d1a"),
          els: [
            text("Thank you\nfor reading", [90, 470, 900], { size: 130, fontFamily: "Cormorant Garamond", fill: "#f3efe8", lineHeight: 1 }),
            text("@yourhandle", [90, 1200, 500], { size: 30, fill: "#b9b2a6" }),
          ],
        },
      ]),
  },
  {
    id: "editorial-issue",
    name: "Editorial Issue",
    category: "Editorial",
    build: () =>
      independent("Editorial Issue", W, H, [
        {
          bg: solid("#ebe6dd"),
          els: [
            photo([140, 240, 800, 1110], { mask: "arch" }),
            text("THE EDIT", [0, 70, W], { size: 190, fontFamily: "Bodoni Moda", fontWeight: 700, align: "center", fill: "#111111", letterSpacing: 4 }),
            text("Issue 07 — Autumn", [0, 300, W], { size: 30, align: "center", fontFamily: "Instrument Serif", italic: true, fill: "#111111" }),
          ],
        },
        {
          bg: solid("#111111"),
          els: [
            text("“", [80, 120, 300], { size: 320, fontFamily: "Bodoni Moda", fill: "#c9a46a" }),
            text("Style is a way to say who you are without having to speak.", [90, 420, 900], { size: 84, fontFamily: "Instrument Serif", fill: "#ebe6dd", lineHeight: 1.15 }),
            text("YOUR NAME", [90, 1180, 600], { size: 26, letterSpacing: 8, fill: "#c9a46a" }),
          ],
        },
        {
          bg: solid("#ebe6dd"),
          els: [
            photo([0, 0, 540, H]),
            text("The\nlook", [590, 160, 440], { size: 130, fontFamily: "Bodoni Moda", fontWeight: 700, fill: "#111111", lineHeight: 0.95 }),
            text("Describe the pieces, the place and the mood in two or three lines.", [590, 520, 420], { size: 32, fill: "#3b3833", lineHeight: 1.45 }),
            shape("line", [590, 760, 200, 20], "#111111", { strokeWidth: 3 }),
          ],
        },
        {
          bg: solid("#c9a46a"),
          els: [
            text("Next\nissue", [90, 380, 900], { size: 210, fontFamily: "Bodoni Moda", fontWeight: 700, fill: "#111111", lineHeight: 0.9 }),
            text("Follow for more →", [90, 1180, 600], { size: 34, fontFamily: "Instrument Serif", italic: true, fill: "#111111" }),
          ],
        },
      ]),
  },
  {
    id: "travel-panorama",
    name: "Travel Panorama",
    category: "Travel",
    build: () =>
      seamless("Travel Panorama", W, H, 4, linear(90, "#f7e7ce", "#f4c9a1", "#e8a07a", "#7a4e6b"), [
        photo([120, 180, 1380, 760], { cornerRadius: 24, shadow }),
        photo([1640, 420, 1000, 760], { cornerRadius: 24, shadow, rotation: 357 }),
        photo([2800, 160, 1400, 820], { cornerRadius: 24, shadow }),
        text("Seven days in", [130, 1000, 1200], { size: 54, fontFamily: "DM Sans", fill: "#3a2a22" }),
        text("the islands", [120, 1050, 1500], { size: 190, fontFamily: "Pacifico", fill: "#3a2a22" }),
        sticker("sun", [1420, 90, 220], "#3a2a22"),
        sticker("arrow-curved", [2560, 200, 260], "#ffffff"),
        text("Day 3 · the hidden beach", [1650, 1210, 900], { size: 44, fontFamily: "Caveat", fontWeight: 700, fill: "#3a2a22" }),
        text("Save this for\nyour next trip", [2820, 1040, 1300], { size: 96, fontFamily: "DM Sans", fontWeight: 700, fill: "#ffffff", lineHeight: 1.05 }),
      ]),
  },
  {
    id: "photo-dump",
    name: "Photo Dump",
    category: "Photo Dump",
    build: () => {
      const frame = (box: Box, rotation: number) => photo(box, { rotation, borderColor: "#ffffff", borderWidth: 22, shadow });
      return independent("Photo Dump", W, H, [
        {
          bg: solid("#e9e4da"),
          els: [
            frame([120, 150, 620, 760], 355),
            frame([420, 480, 560, 700], 6),
            sticker("tape", [330, 110, 260], "#d9c9a3", { rotation: 352, opacity: 0.85 }),
            text("lately ✦", [100, 1150, 700], { size: 110, fontFamily: "Caveat", fontWeight: 700, fill: "#222222" }),
          ],
        },
        ...[0, 1].map((i) => ({
          bg: solid("#e9e4da"),
          els: [
            frame([110, 120, 860, 980], i === 0 ? 2 : 358),
            sticker("tape", [410, 70, 260], "#d9c9a3", { opacity: 0.85 }),
            text(i === 0 ? "write a tiny caption" : "another little moment", [110, 1160, 860], { size: 62, fontFamily: "Caveat", fill: "#222222", align: "center" }),
          ] as DesignElement[],
        })),
        {
          bg: solid("#222222"),
          els: [
            frame([90, 140, 430, 520], 354),
            frame([560, 200, 430, 520], 5),
            frame([320, 640, 440, 520], 358),
            text("that's the dump.", [0, 1200, W], { size: 70, fontFamily: "Caveat", fontWeight: 700, fill: "#e9e4da", align: "center" }),
          ],
        },
      ]);
    },
  },
  {
    id: "bold-launch",
    name: "Bold Launch",
    category: "Marketing",
    build: () =>
      independent("Bold Launch", W, H, [
        {
          bg: linear(160, "#1b1464", "#5b2be0", "#ff5f8f"),
          els: [
            text("NEW", [80, 110, 300], { size: 30, fontFamily: "Sora", fontWeight: 700, fill: "#111111", letterSpacing: 6, background: { color: "#d7ff3e", padding: 16, radius: 40 } }),
            text("Something\nbig is\ncoming", [80, 330, 920], { size: 150, fontFamily: "Sora", fontWeight: 700, fill: "#ffffff", lineHeight: 1 }),
            text("Swipe to see what we built →", [80, 1190, 900], { size: 36, fontFamily: "Sora", fill: "#ffffff" }),
            sticker("sparkle", [820, 120, 170], "#d7ff3e"),
          ],
        },
        ...["Faster", "Simpler", "Yours"].map((word, i) => ({
          bg: solid("#111111"),
          els: [
            text(`0${i + 1}`, [80, 100, 300], { size: 120, fontFamily: "Sora", fontWeight: 700, fill: "#5b2be0" }),
            text(word, [80, 300, 920], { size: 170, fontFamily: "Sora", fontWeight: 700, fill: "#ffffff" }),
            text("Explain this benefit in one or two short, concrete sentences.", [80, 540, 880], { size: 40, fontFamily: "Sora", fill: "#b8b8c4", lineHeight: 1.4 }),
            photo([80, 780, 920, 480], { cornerRadius: 36 }),
          ] as DesignElement[],
        })),
        {
          bg: solid("#d7ff3e"),
          els: [
            text("Get early\naccess", [80, 400, 920], { size: 170, fontFamily: "Sora", fontWeight: 700, fill: "#111111", lineHeight: 1 }),
            text("Link in bio", [80, 1150, 400], { size: 40, fontFamily: "Sora", fontWeight: 700, fill: "#d7ff3e", background: { color: "#111111", padding: 26, radius: 60 } }),
          ],
        },
      ]),
  },
  {
    id: "step-by-step",
    name: "Step by Step",
    category: "Tutorial",
    build: () =>
      independent("Step by Step", W, H, [
        {
          bg: solid("#fff8ec"),
          els: [
            text("HOW TO", [90, 140, 500], { size: 32, fontFamily: "Poppins", fontWeight: 700, letterSpacing: 8, fill: "#e4572e" }),
            text("Do the thing\nin 3 steps", [90, 230, 900], { size: 130, fontFamily: "Poppins", fontWeight: 700, fill: "#17202a", lineHeight: 1.02 }),
            photo([90, 620, 900, 560], { cornerRadius: 40 }),
            sticker("arrow-doodle", [700, 1220, 280], "#e4572e"),
          ],
        },
        ...[1, 2, 3].map((n) => ({
          bg: solid("#fff8ec"),
          els: [
            shape("ellipse", [90, 110, 190, 190], "#e4572e"),
            text(String(n), [90, 135, 190], { size: 120, fontFamily: "Poppins", fontWeight: 700, fill: "#fff8ec", align: "center" }),
            text(`Name step ${n}`, [90, 370, 900], { size: 92, fontFamily: "Poppins", fontWeight: 700, fill: "#17202a" }),
            text("Tell people exactly what to do here. Keep it to a sentence or two.", [90, 520, 880], { size: 40, fontFamily: "Poppins", fill: "#4a5560", lineHeight: 1.45 }),
            photo([90, 780, 900, 460], { cornerRadius: 40 }),
          ] as DesignElement[],
        })),
        {
          bg: solid("#e4572e"),
          els: [
            sticker("check", [90, 240, 260], "#fff8ec"),
            text("That's it!", [90, 560, 900], { size: 170, fontFamily: "Poppins", fontWeight: 700, fill: "#fff8ec" }),
            text("Save this post so you can find it later.", [90, 800, 800], { size: 44, fontFamily: "Poppins", fill: "#fff8ec", lineHeight: 1.4 }),
          ],
        },
      ]),
  },
  {
    id: "type-poster",
    name: "Type Poster",
    category: "Typography",
    build: () =>
      independent("Type Poster", W, H, [
        { bg: solid("#f2f0e6"), els: [text("MAKE", [60, 120, 960], { size: 430, fontFamily: "Anton", fill: "#111111", lineHeight: 0.9 }), text("IT", [60, 520, 960], { size: 430, fontFamily: "Anton", fill: "#ff4b1f", lineHeight: 0.9 }), text("LOUD", [60, 920, 960], { size: 430, fontFamily: "Anton", fill: "#111111", lineHeight: 0.9 })] },
        { bg: solid("#ff4b1f"), els: [text("Say the one thing that matters.", [70, 300, 940], { size: 150, fontFamily: "Anton", fill: "#f2f0e6", lineHeight: 1, transform: "uppercase" }), sticker("asterisk", [780, 1050, 220], "#111111")] },
        { bg: solid("#111111"), els: [text("THEN STOP.", [60, 520, 960], { size: 250, fontFamily: "Anton", fill: "#f2f0e6", align: "center" }), text("@yourhandle", [0, 1200, W], { size: 34, fontFamily: "Space Mono", fill: "#ff4b1f", align: "center" })] },
      ]),
  },
  {
    id: "moodboard-grid",
    name: "Moodboard Grid",
    category: "Moodboard",
    build: () =>
      independent("Moodboard Grid", 1080, 1080, [
        {
          bg: solid("#f5f2ed"),
          els: [
            photo([60, 60, 470, 600]),
            photo([550, 60, 470, 290]),
            photo([550, 370, 225, 290]),
            photo([795, 370, 225, 290], { mask: "ellipse" }),
            photo([60, 680, 300, 340]),
            ...["#c8553d", "#f28f3b", "#588b8b", "#2d3047"].map((c, i) => shape("ellipse", [400 + i * 110, 700, 90, 90], c)),
            text("MOOD — 01", [400, 840, 600], { size: 28, letterSpacing: 8, fill: "#2d3047" }),
            text("warm, textured, a little nostalgic", [400, 890, 620], { size: 52, fontFamily: "Instrument Serif", italic: true, fill: "#2d3047" }),
          ],
        },
        { bg: solid("#2d3047"), els: [photo([60, 60, 960, 640]), text("Textures", [60, 760, 960], { size: 150, fontFamily: "Instrument Serif", fill: "#f5f2ed" }), text("Collect details that share a feeling.", [60, 950, 900], { size: 36, fill: "#c9c6d4" })] },
        { bg: solid("#f5f2ed"), els: [photo([60, 60, 470, 960], { mask: "arch" }), photo([550, 60, 470, 470]), photo([550, 550, 470, 470], { mask: "ellipse" })] },
      ]),
  },
  {
    id: "product-drop",
    name: "Product Drop",
    category: "Product Showcase",
    build: () =>
      independent("Product Drop", W, H, [
        {
          bg: { type: "radial", stops: [{ offset: 0, color: "#ffe9d6" }, { offset: 1, color: "#f6b89a" }] },
          els: [
            photo([190, 250, 700, 700], { mask: "ellipse", borderColor: "#ffffff", borderWidth: 14, shadow }),
            text("Just dropped", [0, 90, W], { size: 34, letterSpacing: 8, align: "center", fill: "#5a2d1c", transform: "uppercase" }),
            text("Product name", [0, 1000, W], { size: 110, fontFamily: "DM Serif Display", align: "center", fill: "#3a1c10" }),
            text("$49", [440, 1170, 200], { size: 48, fontWeight: 700, align: "center", fill: "#ffe9d6", background: { color: "#3a1c10", padding: 22, radius: 60 } }),
            sticker("sparkle", [820, 220, 130], "#ffffff"),
            sticker("sparkle", [150, 820, 80], "#ffffff"),
          ],
        },
        ...["Why you'll love it", "What's inside"].map((t) => ({
          bg: solid("#fff6ee"),
          els: [
            photo([0, 0, W, 760]),
            text(t, [80, 830, 920], { size: 84, fontFamily: "DM Serif Display", fill: "#3a1c10" }),
            text("• First benefit in plain words\n• Second benefit\n• Third benefit", [80, 970, 900], { size: 40, fill: "#5a2d1c", lineHeight: 1.6 }),
          ] as DesignElement[],
        })),
        { bg: solid("#3a1c10"), els: [text("Shop now", [0, 520, W], { size: 200, fontFamily: "DM Serif Display", align: "center", fill: "#ffe9d6" }), text("Link in bio · Free shipping this week", [0, 800, W], { size: 36, align: "center", fill: "#f6b89a" })] },
      ]),
  },
  {
    id: "film-roll",
    name: "Film Roll",
    category: "Film Aesthetic",
    build: () => {
      const frames = [0, 1, 2].flatMap((i) => {
        const x = 90 + i * 1080;
        return [
          photo([x + 72, 314, 756, 462], { adjustments: { brightness: 0, exposure: 0, contrast: 12, saturation: -6, temperature: 12, tint: 6, highlights: 0, shadows: 0, fade: 18, grayscale: 0, sharpness: 0, blur: 0, vignette: 0, grain: 28 }, filter: "Analog film" }),
          sticker("film-frame", [x, 210, 900], "#0b0b0b"),
          text(`${String(i + 12).padStart(2, "0")}A`, [x + 80, 900, 400], { size: 30, fontFamily: "Space Mono", fill: "#e8a33d" }),
        ] as DesignElement[];
      });
      const p = seamless("Film Roll", W, H, 3, solid("#1a1816"), [
        ...frames,
        text("KODAK MOMENTS, MORE OR LESS", [90, 110, 2000], { size: 30, fontFamily: "Space Mono", fill: "#e8a33d", letterSpacing: 6 }),
        text("shot on a weekend", [90, 1030, 2400], { size: 130, fontFamily: "Special Elite", fill: "#efe9dd" }),
      ]);
      // One grain layer over the whole strip keeps the texture continuous across slides.
      const grain = { ...createOverlay("grain", P), x: 0, y: 0, width: W * 3, height: H, opacity: 0.35 };
      return addElements(p, PANORAMA_ID, [grain]);
    },
  },
];
