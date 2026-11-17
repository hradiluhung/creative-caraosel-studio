/**
 * Photo journal templates: editorial photo arrangements with quiet typography, in the spirit of
 * printed photo journals (scattered or gridded photos, small captions and numbering, one
 * expressive serif title). Every photo is an empty frame waiting for the user's own picture,
 * and everything stays editable.
 *
 * Seamless templates are drawn on one wide surface, so photos and words can cross the line
 * between two slides, the way a spread crosses the fold of a printed journal.
 */
import { createId } from "@/document/ids";
import type { DesignElement, ImageElement, TextElement } from "@/document/schema";
import type { TemplateDef } from "./builtin";
import { H, independent, photo, seamless, shadow, shape, solid, sticker, text, W, type Box } from "./kit";

export const CATEGORY = "Photo Journal";

// A small, shared palette: paper, ink and a muted grey for captions.
export const PAPER = "#efece6";
export const INK = "#1d1c1a";
export const MUTED = "#6f6a62";

/** Small sans caption, the voice of most journal notes. */
export const caption = (content: string, at: [number, number, number], o: Partial<TextElement> & { size?: number } = {}) =>
  text(content, at, { size: 24, fill: INK, lineHeight: 1.35, ...o });
/** Numbering such as (1), [01] or 001. */
export const label = (content: string, at: [number, number, number], o: Partial<TextElement> & { size?: number } = {}) =>
  text(content, at, { size: 22, fill: INK, ...o });
/** An expressive serif title. */
export const title = (content: string, at: [number, number, number], size: number, o: Partial<TextElement> = {}) =>
  text(content, at, { size, fontFamily: "Instrument Serif", fill: INK, lineHeight: 0.95, ...o });

/** A plain photo frame on the page. */
export const frame = (box: Box, name: string, o: Partial<ImageElement> = {}) => ({ ...photo(box, o), name });

/**
 * A polaroid: white card, photo and handwritten caption, grouped so they move as one.
 * Elements turn around their own centre, so the parts are placed by turning their offsets
 * around the card's centre; the result looks like one turned card.
 */
export function polaroid(x: number, y: number, width: number, rotation: number, note: string, name: string): DesignElement[] {
  const pad = Math.round(width * 0.07);
  const photoSize = width - pad * 2;
  const height = Math.round(pad + photoSize + width * 0.26);
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rad = (rotation * Math.PI) / 180;
  // Place a part given its unturned box on the card.
  const place = (bx: number, by: number, bw: number, bh: number) => {
    const dx = bx + bw / 2 - cx;
    const dy = by + bh / 2 - cy;
    const px = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
    const py = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
    return { x: Math.round(px - bw / 2), y: Math.round(py - bh / 2), rotation };
  };
  const groupId = createId();
  const card = { ...shape("rect", [x, y, width, height], "#fbfaf7", { shadow: { ...shadow, opacity: 0.18, blur: 24, offsetY: 10 } }), ...place(x, y, width, height), name: `${name} card`, groupId };
  const pic = { ...frame([x + pad, y + pad, photoSize, photoSize], name), ...place(x + pad, y + pad, photoSize, photoSize), groupId };
  const capH = Math.round(width * 0.12);
  const capBox: [number, number, number, number] = [x + pad, y + pad + photoSize + Math.round(width * 0.06), photoSize, capH];
  const cap = {
    ...text(note, [capBox[0], capBox[1], capBox[2]], { size: Math.round(width * 0.085), fontFamily: "Caveat", fill: INK, align: "center" }),
    ...place(...capBox),
    groupId,
  };
  return [card, pic, cap];
}

export const JOURNAL_TEMPLATES: TemplateDef[] = [
  {
    // Scattered photos and single words that read as a sentence, then a numbered page of captions.
    id: "journal-weekend-recap",
    name: "Weekend Recap",
    category: CATEGORY,
    build: () =>
      seamless("Weekend Recap", W, H, 2, solid(PAPER), [
        caption("what", [150, 150, 200]),
        caption("I'm", [560, 205, 200]),
        label("*", [950, 180, 60], { size: 40 }),
        frame([150, 290, 330, 270], "Photo 1"),
        frame([830, 330, 200, 230], "Photo 2"),
        caption("loving", [640, 500, 200]),
        title("Weekend", [250, 720, 760], 150, { italic: true }),
        title("recap", [520, 860, 520], 150),
        caption("about", [880, 600, 200]),
        // Crosses the fold between the two slides.
        frame([960, 640, 250, 320], "Photo 3"),
        label("*", [170, 850, 60], { size: 40 }),
        frame([80, 990, 200, 260], "Photo 4"),
        caption("this", [520, 1110, 200]),
        frame([450, 1170, 140, 140], "Photo 5"),
        frame([800, 1030, 250, 230], "Photo 6"),
        caption("month", [870, 1280, 200]),
        label("*", [700, 1260, 60], { size: 40 }),

        // Right page: six numbered moments.
        label("(1)", [1300, 200, 100], { italic: true, fontFamily: "Instrument Serif", size: 34 }),
        frame([1400, 100, 210, 270], "Moment 1"),
        caption("slow mornings, one\nchapter at a time", [1360, 390, 300], { align: "center", size: 22 }),
        label("(2)", [1730, 330, 100], { italic: true, fontFamily: "Instrument Serif", size: 34 }),
        frame([1830, 190, 210, 270], "Moment 2"),
        caption("little memories from\nthe photo booth", [1800, 480, 300], { size: 22 }),
        label("(3)", [1420, 760, 100], { italic: true, fontFamily: "Instrument Serif", size: 34 }),
        frame([1510, 640, 230, 250], "Moment 3"),
        caption("coffee, toast & a\nmoment to myself", [1490, 910, 300], { align: "center", size: 22 }),
        label("(4)", [1800, 760, 100], { italic: true, fontFamily: "Instrument Serif", size: 34 }),
        frame([1890, 620, 210, 260], "Moment 4"),
        caption("coastal walks in the\nevening light", [1820, 900, 280], { align: "right", size: 22 }),
        label("(5)", [1340, 1130, 100], { italic: true, fontFamily: "Instrument Serif", size: 34 }),
        frame([1440, 1030, 210, 230], "Moment 5"),
        caption("coffee & catch-ups\nfrom bed", [1400, 1275, 290], { align: "right", size: 22 }),
        label("(6)", [1760, 1110, 100], { italic: true, fontFamily: "Instrument Serif", size: 34 }),
        frame([1860, 1020, 250, 200], "Moment 6"),
        caption("cozy afternoons,\nnowhere to be", [1860, 1240, 260], { align: "center", size: 22 }),
      ]),
  },
  {
    // Ten bracketed shots around a refined serif title, one photo sitting across the fold.
    id: "journal-monthly-recap",
    name: "Monthly Recap",
    category: CATEGORY,
    build: () => {
      const serif = { fontFamily: "Cormorant Garamond", fill: INK };
      const shots: Array<[string, Box]> = [
        ["[01]", [300, 90, 240, 140]],
        ["[02]", [60, 280, 190, 280]],
        ["[03]", [470, 250, 190, 190]],
        ["[04]", [300, 620, 370, 300]],
        ["[05]", [1000, 110, 170, 210]],
        ["[06]", [1260, 470, 340, 230]],
        ["[07]", [1250, 1000, 170, 150]],
        ["[08]", [1880, 290, 160, 130]],
        ["[09]", [1620, 80, 200, 140]],
        ["[10]", [1880, 640, 150, 210]],
      ];
      return seamless("Monthly Recap", W, H, 2, solid("#f1efea"), [
        ...shots.flatMap(([n, box]) => [label(n, [box[0], box[1] - 30, 80], { size: 18, fontFamily: "Space Mono" }), frame(box, `Shot ${n.slice(1, 3)}`)]),
        text("(MONTHLY) NOV", [250, 500, 700], { ...serif, size: 76, letterSpacing: 1 }),
        label("*", [40, 600, 40], { size: 36 }),
        label("*", [690, 930, 40], { size: 36 }),
        text("every moment as special\nas the next", [1270, 300, 420], { ...serif, size: 30, lineHeight: 1.1 }),
        text("RECAP", [40, 1120, 340], { ...serif, size: 92 }),
        text("10 shots from the month\nlately it's been a bit of everything\ncatching special moments and feelings", [400, 1130, 560], { ...serif, size: 24, lineHeight: 1.2 }),
        text("goodbye november. hello december", [1650, 1250, 480], { ...serif, size: 26, align: "right" }),
      ]);
    },
  },
  {
    // A framed strip of photos on a dusty blue page, with small spaced capitals.
    id: "journal-a-weekend-in",
    name: "A Weekend In",
    category: CATEGORY,
    build: () => {
      const BLUE = "#5b6a92";
      const caps = { fontFamily: "Cormorant Garamond", fill: "#f4f1ea", size: 40, letterSpacing: 3 };
      const panel = (box: Box) => shape("rect", box, "#f4f1ea", { cornerRadius: 6, shadow: { ...shadow, opacity: 0.2 } });
      return independent("A Weekend In", W, H, [
        {
          bg: solid(BLUE),
          els: [
            panel([340, 110, 400, 1070]),
            frame([370, 140, 340, 320], "Photo 1"),
            frame([370, 485, 340, 320], "Photo 2"),
            frame([370, 830, 340, 320], "Photo 3"),
            text("A WEEKEND", [130, 1235, 400], caps),
            text("IN NOVEMBER", [550, 1235, 400], { ...caps, align: "right" }),
          ],
        },
        {
          bg: solid(BLUE),
          els: [
            panel([190, 150, 700, 900]),
            frame([225, 185, 630, 830], "Photo"),
            text("SATURDAY", [0, 1110, W], { ...caps, align: "center" }),
            text("slept in, walked far, ate well", [0, 1175, W], { fontFamily: "Instrument Serif", italic: true, size: 40, fill: "#e3e6ef", align: "center" }),
          ],
        },
        {
          bg: solid(BLUE),
          els: [
            panel([110, 170, 420, 560]),
            frame([135, 195, 370, 510], "Photo 1"),
            panel([550, 560, 420, 560]),
            frame([575, 585, 370, 510], "Photo 2"),
            text("SUNDAY", [110, 790, 400], caps),
            text("and then it was\nmonday again", [110, 860, 400], { fontFamily: "Instrument Serif", italic: true, size: 44, fill: "#e3e6ef", lineHeight: 1.05 }),
          ],
        },
      ]);
    },
  },
  {
    // Two portrait-and-stack pairs, one per slide, tied together by a rule running across both.
    id: "journal-the-edit",
    name: "The Edit",
    category: CATEGORY,
    build: () => {
      const mono = { fontFamily: "Space Mono", size: 18, fill: MUTED };
      return seamless("The Edit", W, H, 2, solid("#f3f1ec"), [
        label("THE EDIT", [165, 170, 400], { fontFamily: "Space Mono", size: 22, letterSpacing: 4 }),
        label("NO. 07", [1905, 170, 120], { ...mono, align: "right" }),
        shape("rect", [165, 215, 1860, 2], INK, { name: "Rule" }),
        frame([165, 250, 420, 600], "Photo 001"),
        frame([615, 250, 330, 285], "Photo 002"),
        frame([615, 565, 330, 285], "Photo 003"),
        label("001", [165, 870, 100], mono),
        label("002 / 003", [615, 870, 200], mono),
        frame([1245, 250, 420, 600], "Photo 004"),
        frame([1695, 250, 330, 285], "Photo 005"),
        frame([1695, 565, 330, 285], "Photo 006"),
        label("004", [1245, 870, 100], mono),
        label("005 / 006", [1695, 870, 200], mono),
        caption("Notes on the light, the food\nand the people in between.", [165, 1020, 520], { fill: MUTED }),
        title("a week,\nin pictures", [1465, 1000, 560], 76, { italic: true, align: "right" }),
      ]);
    },
  },
  {
    // White pages, an index of moments, lots of air.
    id: "journal-moments-on-film",
    name: "Moments on Film",
    category: CATEGORY,
    build: () => {
      const note = (content: string, at: [number, number, number]) => caption(content, at, { size: 22, fill: "#3c3a36" });
      return independent("Moments on Film", W, H, [
        {
          bg: solid("#ffffff"),
          els: [
            note("A weekend in the fall", [60, 640, 420]),
            frame([600, 40, 430, 280], "Photo 1"),
            frame([700, 335, 330, 430], "Photo 2"),
            frame([840, 780, 190, 170], "Photo 3"),
            frame([600, 965, 430, 340], "Photo 4"),
            note("#01 – Moments on film\n#02 – Coastal wanderings\n#03 – Chasing the light\n#04 – Autumn in full colour", [60, 1150, 480]),
          ],
        },
        {
          bg: solid("#ffffff"),
          els: [
            frame([40, 40, 1000, 640], "Moments on film"),
            note("#01 – Moments on film", [40, 700, 500]),
            frame([560, 700, 480, 610], "Coastal wanderings"),
            note("#02 – Coastal wanderings", [40, 1280, 480]),
          ],
        },
        {
          bg: solid("#ffffff"),
          els: [
            note("#03 – Chasing the light", [40, 40, 500]),
            title("fin.", [40, 380, 600], 120, { italic: true, fill: "#3c3a36" }),
            note("#04 – Autumn in full colour", [40, 670, 500]),
            frame([40, 710, 500, 600], "Chasing the light"),
            frame([560, 710, 480, 600], "Autumn in full colour"),
          ],
        },
      ]);
    },
  },
  {
    // Full-bleed photos with a white panel of stacked photos sitting across the slide line.
    id: "journal-framed-story",
    name: "Framed Story",
    category: CATEGORY,
    build: () =>
      seamless("Framed Story", W, H, 3, solid("#ffffff"), [
        frame([0, 0, 820, H], "Full-bleed photo 1"),
        // The panel's photos cross the line; its caption sits wholly on slide two.
        frame([900, 170, 460, 400], "Panel photo 1"),
        frame([900, 600, 460, 560], "Panel photo 2"),
        title("Sunday, slowly", [1110, 1200, 250], 46, { italic: true, align: "right" }),
        frame([1440, 0, 1800, H], "Full-bleed photo 2"),
      ]),
  },
  {
    // Polaroid cards (grouped, so each moves as one), handwriting and date stamps.
    id: "journal-polaroid-diary",
    name: "Polaroid Diary",
    category: CATEGORY,
    build: () => {
      const KRAFT = "#e9e1d3";
      const stamp = (content: string, at: [number, number, number], rotation = 0) =>
        label(content, at, { fontFamily: "Space Mono", size: 22, fill: "#c2552d", rotation });
      return independent("Polaroid Diary", W, H, [
        {
          bg: solid(KRAFT),
          els: [
            text("dear diary,", [90, 110, 900], { fontFamily: "Caveat", fontWeight: 700, size: 120, fill: INK }),
            ...polaroid(100, 330, 480, -4, "the first coffee", "Polaroid 1"),
            ...polaroid(540, 610, 460, 5, "and the long walk home", "Polaroid 2"),
            sticker("tape", [240, 300, 200], "#d8c79f", { rotation: -8, opacity: 0.85 }),
            stamp("'26 11 08", [760, 1240, 220]),
          ],
        },
        {
          bg: solid(KRAFT),
          els: [
            ...polaroid(150, 120, 780, -2, "rain all morning", "Polaroid"),
            sticker("tape", [430, 80, 220], "#d8c79f", { rotation: 4, opacity: 0.85 }),
            text("so we stayed in, made too much\npasta and watched old films.", [120, 1130, 840], { fontFamily: "Caveat", size: 54, fill: INK, lineHeight: 1.1 }),
            stamp("'26 11 09", [120, 1270, 220]),
          ],
        },
        {
          bg: solid(KRAFT),
          els: [
            ...polaroid(80, 120, 440, 6, "golden hour", "Polaroid 1"),
            ...polaroid(560, 230, 440, -5, "her favourite spot", "Polaroid 2"),
            ...polaroid(300, 700, 460, 3, "until next time", "Polaroid 3"),
            sticker("sparkle", [880, 1150, 90], INK),
            stamp("'26 11 10", [80, 1260, 220], -3),
          ],
        },
      ]);
    },
  },
  {
    // Field notes: a Bodoni italic title, mono metadata and hairline rules.
    id: "journal-field-notes",
    name: "Field Notes",
    category: CATEGORY,
    build: () => {
      const BG = "#f4f2ee";
      const mono = (content: string, at: [number, number, number], o: Partial<TextElement> & { size?: number } = {}) =>
        label(content, at, { fontFamily: "Space Mono", size: 18, fill: "#4a4740", lineHeight: 1.5, ...o });
      const rule = (x: number, y: number, w: number) => shape("rect", [x, y, w, 2], INK);
      const grid = [0, 1, 2, 3, 4, 5].flatMap((i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = 90 + col * 460;
        const y = 210 + row * 360;
        return [frame([x, y, 440, 290], `Note ${i + 1}`), mono(`N° 0${i + 1}`, [x, y + 300, 200])];
      });
      return independent("Field Notes", W, H, [
        {
          bg: solid(BG),
          els: [
            mono("VOL. 03 — SPRING", [90, 90, 500], { letterSpacing: 2 }),
            mono("LISBON, PT", [700, 90, 290], { align: "right", letterSpacing: 2 }),
            rule(90, 140, 900),
            text("Field\nnotes", [90, 190, 700], { fontFamily: "Bodoni Moda", italic: true, size: 190, fill: INK, lineHeight: 0.9 }),
            frame([430, 640, 560, 600], "Cover photo"),
            mono("38.7223° N\n9.1393° W", [90, 1100, 300]),
            rule(90, 1260, 900),
          ],
        },
        {
          bg: solid(BG),
          els: [mono("CONTACT — DAYS 1 TO 3", [90, 90, 600], { letterSpacing: 2 }), rule(90, 140, 900), ...grid, rule(90, 1260, 900)],
        },
        {
          bg: solid(BG),
          els: [
            mono("N° 07", [90, 90, 300], { letterSpacing: 2 }),
            rule(90, 140, 900),
            frame([90, 190, 520, 700], "Photo 1"),
            frame([640, 420, 350, 470], "Photo 2"),
            text("The city wakes late and stays up later.", [90, 940, 900], { fontFamily: "Bodoni Moda", italic: true, size: 52, fill: INK, lineHeight: 1.05 }),
            caption("Write a few lines about the place, the people you met and what you want to remember.", [90, 1080, 760], { fill: "#4a4740", size: 24 }),
            rule(90, 1260, 900),
          ],
        },
      ]);
    },
  },
];
