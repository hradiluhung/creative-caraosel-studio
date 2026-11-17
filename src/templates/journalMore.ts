/**
 * More photo journal templates. Same visual family as journal.ts (paper tones, ink, one
 * expressive serif, small sans or mono captions, numbering), with different arrangements:
 * contact sheets, diptychs, big numerals, a magazine cover, a film strip, a scrapbook, an index,
 * postcards, a panorama, a mosaic, arches, one line a day, and square and story formats.
 *
 * Every photo is an empty frame that takes a photo or a video; everything stays editable.
 */
import { createId } from "@/document/ids";
import type { ImageElement, TextElement } from "@/document/schema";
import type { TemplateDef } from "./builtin";
import { CATEGORY, INK, MUTED, PAPER, caption, frame, label, title } from "./journal";
import { H, independent, seamless, shadow, shape, solid, sticker, text, W, type Box } from "./kit";

const WHITE = "#ffffff";
const BONE = "#f4f2ee";
const KRAFT = "#e9e1d3";
const RUST = "#c2552d";
const FILM = "#1a1816";

/** Small mono metadata: roll numbers, dates, coordinates. */
const mono = (content: string, at: [number, number, number], o: Partial<TextElement> & { size?: number } = {}) =>
  label(content, at, { fontFamily: "Space Mono", size: 18, fill: "#4a4740", lineHeight: 1.4, ...o });
/** Handwriting. */
const hand = (content: string, at: [number, number, number], size: number, o: Partial<TextElement> = {}) =>
  text(content, at, { size, fontFamily: "Caveat", fill: INK, lineHeight: 1.1, ...o });
/** A hairline rule. */
const rule = (x: number, y: number, w: number, fill = INK) => shape("rect", [x, y, w, 2], fill, { name: "Rule" });
/** A printed photo: white border and a soft shadow. */
const print = (box: Box, name: string, o: Partial<ImageElement> = {}) =>
  frame(box, name, { borderWidth: 14, borderColor: "#fbfaf7", shadow: { ...shadow, opacity: 0.18, blur: 22, offsetY: 8 }, ...o });

export const MORE_JOURNAL_TEMPLATES: TemplateDef[] = [
  {
    // A 3 x 4 contact sheet with frame numbers and one circled keeper, then the selects.
    id: "journal-contact-sheet",
    name: "Contact Sheet",
    category: CATEGORY,
    build: () => {
      const cells = Array.from({ length: 12 }, (_, i) => {
        const c = i % 3;
        const r = Math.floor(i / 3);
        const x = 70 + c * 320;
        const y = 140 + r * 265;
        return [frame([x, y, 300, 225], `Frame ${i + 1}`), mono(`${String(i + 1).padStart(2, "0")}A`, [x, y + 232, 100], { size: 16 })];
      }).flat();
      return independent("Contact Sheet", W, H, [
        {
          bg: solid(BONE),
          els: [
            mono("CONTACT SHEET — ROLL 14", [70, 70, 600], { letterSpacing: 2 }),
            mono("ISO 400 · 36 EXP", [610, 70, 400], { align: "right", letterSpacing: 2 }),
            rule(70, 110, 940),
            ...cells,
            sticker("scribble-circle", [680, 380, 360], RUST, { name: "Keeper mark" }),
            title("the keepers", [70, 1215, 600], 64, { italic: true }),
            mono("circled = printed", [640, 1240, 370], { align: "right" }),
          ],
        },
        {
          bg: solid(BONE),
          els: [
            mono("SELECTS", [70, 70, 400], { letterSpacing: 2 }),
            mono("06A", [70, 110, 200], { size: 16 }),
            frame([70, 140, 940, 630], "Select 06"),
            frame([70, 800, 455, 420], "Select 11"),
            frame([555, 800, 455, 420], "Select 23"),
            mono("11A", [70, 1232, 100], { size: 16 }),
            mono("23A", [555, 1232, 100], { size: 16 }),
            caption("Three frames from roll 14, printed on matte paper.", [70, 1270, 800], { size: 22, fill: MUTED }),
          ],
        },
        {
          bg: solid(BONE),
          els: [
            frame([70, 140, 600, 800], "Print"),
            mono("NOTES", [710, 140, 300], { letterSpacing: 2 }),
            rule(710, 180, 300),
            caption("Overcast all day.\nShot wide open,\npushed one stop.\nThe light finally\nbroke at five.", [710, 200, 300], { size: 22 }),
            title("roll 14,\nprinted.", [70, 990, 900], 120, { italic: true }),
            mono("TRI-X 400 · HC-110 (B) · 7 MIN", [70, 1270, 900]),
          ],
        },
      ]);
    },
  },
  {
    // Pairs of photos that talk to each other: side by side, stacked, then offset.
    id: "journal-diptych",
    name: "Diptych",
    category: CATEGORY,
    build: () => {
      const roman = (content: string, at: [number, number, number]) => label(content, at, { fontFamily: "Instrument Serif", italic: true, size: 34 });
      return independent("Diptych", W, H, [
        {
          bg: solid("#f6f4f0"),
          els: [
            roman("i.", [60, 100, 100]),
            roman("ii.", [550, 100, 100]),
            frame([60, 160, 470, 700], "Left"),
            frame([550, 160, 470, 700], "Right"),
            title("left, right\n& in between", [60, 920, 960], 96),
            caption("A study in pairs: two frames that answer each other.", [60, 1200, 700], { size: 22, fill: MUTED }),
          ],
        },
        {
          bg: solid("#f6f4f0"),
          els: [
            frame([60, 100, 960, 520], "Morning"),
            frame([60, 640, 960, 520], "Night"),
            roman("iii.", [60, 1190, 100]),
            caption("the same street, morning and night", [180, 1198, 600], { size: 24 }),
            mono("07:12 / 23:40", [720, 1200, 300], { align: "right" }),
          ],
        },
        {
          bg: solid("#f6f4f0"),
          els: [
            frame([60, 120, 520, 780], "Near", { shadow: { ...shadow, opacity: 0.16 } }),
            frame([500, 500, 520, 700], "Far", { shadow: { ...shadow, opacity: 0.22 } }),
            roman("iv.", [60, 940, 100]),
            title("fin.", [60, 1000, 400], 110, { italic: true }),
            caption("near and far, in one frame", [60, 1250, 420], { size: 22, fill: MUTED }),
          ],
        },
      ]);
    },
  },
  {
    // One day per slide: an oversized numeral behind the photo and a date running up the side.
    id: "journal-day-by-day",
    name: "Day by Day",
    category: CATEGORY,
    build: () => {
      const numeral = (n: string, at: [number, number, number], align: "left" | "right" | "center") =>
        text(n, at, { size: 360, fontFamily: "Bodoni Moda", fill: "#d9d3c7", lineHeight: 0.95, align, name: `Day ${n}` });
      const side = (content: string, centerX: number) => mono(content, [centerX - 300, 749, 600], { rotation: -90, letterSpacing: 6, size: 20, align: "center" });
      return independent("Day by Day", W, H, [
        {
          bg: solid(PAPER),
          els: [
            numeral("01", [60, 60, 700], "left"),
            frame([380, 300, 640, 820], "Day 1"),
            side("MONDAY · 03 NOV", 330),
            caption("Write one line about today, and why it mattered.", [60, 1170, 760], { size: 26 }),
            mono("01 / 03", [820, 1180, 200], { align: "right" }),
          ],
        },
        {
          bg: solid(PAPER),
          els: [
            numeral("02", [380, 60, 640], "right"),
            frame([60, 300, 640, 820], "Day 2"),
            side("TUESDAY · 04 NOV", 750),
            caption("Rain in the morning, sun by noon.", [60, 1170, 760], { size: 26 }),
            mono("02 / 03", [820, 1180, 200], { align: "right" }),
          ],
        },
        {
          bg: solid(PAPER),
          els: [
            numeral("03", [0, 60, W], "center"),
            frame([60, 420, 470, 640], "Day 3, left"),
            frame([550, 420, 470, 640], "Day 3, right"),
            mono("WEDNESDAY · 05 NOV", [0, 1100, W], { align: "center", letterSpacing: 6, size: 20 }),
            title("and that was the week", [0, 1170, W], 56, { italic: true, align: "center" }),
          ],
        },
      ]);
    },
  },
  {
    // A magazine cover, a contents page and a pull quote.
    id: "journal-cover-story",
    name: "Cover Story",
    category: CATEGORY,
    build: () => {
      const entries: Array<[string, string, string]> = [
        ["04", "The slow weekend", "Two days, no plans,\none very long breakfast."],
        ["12", "Coast road", "Forty kilometres of sea\non the left."],
        ["20", "At the market", "Figs, flowers and the\nman who sells both."],
        ["28", "Home again", "Unpacking, slowly,\nand the first coffee."],
      ];
      return independent("Cover Story", W, H, [
        {
          bg: solid(INK),
          els: [
            frame([0, 0, W, H], "Cover photo"),
            text("JOURNAL", [40, 40, 1000], { size: 200, fontFamily: "Bodoni Moda", fill: WHITE, align: "center", lineHeight: 0.95, letterSpacing: 4 }),
            mono("ISSUE 07 — NOVEMBER 2026", [40, 250, 1000], { align: "center", fill: WHITE, letterSpacing: 4, size: 20 }),
            title("The slow\nweekend issue", [60, 1010, 760], 76, { italic: true, fill: WHITE }),
            caption("12 photographs, 3 cafés,\n1 long walk by the sea", [60, 1190, 600], { fill: WHITE }),
          ],
        },
        {
          bg: solid(PAPER),
          els: [
            mono("CONTENTS", [70, 80, 500], { letterSpacing: 4, size: 20 }),
            mono("ISSUE 07", [610, 80, 400], { align: "right", letterSpacing: 4, size: 20 }),
            rule(70, 125, 940),
            ...entries.flatMap(([page, head, body], i) => {
              const y = 170 + i * 270;
              return [
                text(page, [70, y, 160], { size: 90, fontFamily: "Bodoni Moda", fill: INK, lineHeight: 0.95 }),
                text(head, [250, y + 6, 430], { size: 40, fontFamily: "Instrument Serif", fill: INK }),
                caption(body, [250, y + 66, 430], { size: 20, fill: MUTED }),
                frame([720, y, 290, 230], head),
              ];
            }),
            rule(70, 1250, 940),
          ],
        },
        {
          bg: solid(PAPER),
          els: [
            frame([70, 70, 940, 760], "Feature photo"),
            title("“We stayed until the\nlights came on.”", [70, 880, 940], 72, { italic: true }),
            caption("— page 12, Coast road", [70, 1060, 600], { size: 22, fill: MUTED }),
            mono("12", [900, 1270, 110], { align: "right" }),
          ],
        },
      ]);
    },
  },
  {
    // A strip of film running across three slides, sprocket holes and all.
    id: "journal-filmstrip",
    name: "Filmstrip",
    category: CATEGORY,
    build: () => {
      const BG = "#f1efea";
      const total = W * 3;
      const holes = Array.from({ length: 27 }, (_, i) => 30 + i * 120).flatMap((x) => [
        shape("rect", [x, 378, 34, 20], BG, { cornerRadius: 4, name: "Sprocket" }),
        shape("rect", [x, 902, 34, 20], BG, { cornerRadius: 4, name: "Sprocket" }),
      ]);
      // The frames sit on the strip; two of them cross the line between slides.
      const frames = [0, 1, 2, 3, 4].flatMap((i) => {
        const x = 60 + i * 640;
        return [frame([x, 420, 560, 420], `Frame ${12 + i}`), mono(`${12 + i}  ▸`, [x, 856, 200], { fill: "#e8a33d", size: 18 })];
      });
      return seamless("Filmstrip", W, H, 3, solid(BG), [
        shape("rect", [0, 360, total, 580], FILM, { name: "Film strip" }),
        ...holes,
        ...frames,
        mono("ROLL 03 — PORTRA 400 — 36 EXP", [80, 200, 900], { letterSpacing: 3 }),
        title("a strip of\nsummer", [80, 990, 900], 150),
        mono("FRAMES 12—16", [1240, 200, 760], { align: "center", letterSpacing: 3 }),
        caption("developed at home,\nscanned on a Sunday.", [2300, 1150, 860], { align: "right", size: 26 }),
      ]);
    },
  },
  {
    // Taped prints, a torn-paper note, handwriting and doodles.
    id: "journal-scrapbook",
    name: "Scrapbook",
    category: CATEGORY,
    build: () => {
      const tape = (x: number, y: number, rotation: number) => sticker("tape", [x, y, 200], "#d8c79f", { rotation, opacity: 0.85 });
      return independent("Scrapbook", W, H, [
        {
          bg: solid(KRAFT),
          els: [
            sticker("torn-paper", [80, 90, 600], "#f6f1e7", { name: "Note paper" }),
            hand("things I want\nto remember", [120, 130, 520], 64, { fontWeight: 700 }),
            print([120, 400, 420, 520], "Print 1", { rotation: -6 }),
            tape(230, 380, -4),
            print([560, 520, 440, 560], "Print 2", { rotation: 5 }),
            tape(680, 500, 6),
            sticker("arrow-curved", [400, 1130, 160], INK),
            hand("this one!", [600, 1150, 300], 48),
            sticker("check", [120, 1210, 70], RUST),
          ],
        },
        {
          bg: solid(KRAFT),
          els: [
            print([90, 120, 900, 700], "Big print", { rotation: -2 }),
            tape(440, 95, 3),
            sticker("torn-paper", [140, 880, 800], "#f6f1e7", { name: "Note paper" }),
            hand("we got lost on purpose,\nfound a bakery, and stayed\nuntil they closed.", [200, 940, 680], 46),
            sticker("sparkle", [900, 1200, 80], INK),
          ],
        },
        {
          bg: solid(KRAFT),
          els: [
            print([90, 140, 400, 480], "Print 1", { rotation: -3 }),
            tape(190, 120, -6),
            print([590, 180, 400, 480], "Print 2", { rotation: 4 }),
            tape(690, 160, 5),
            print([110, 700, 400, 480], "Print 3", { rotation: 3 }),
            tape(210, 680, 2),
            print([600, 740, 400, 480], "Print 4", { rotation: -4 }),
            tape(700, 720, -3),
            mono("'26 · 11", [840, 1270, 180], { fill: RUST, size: 20, align: "right" }),
          ],
        },
      ]);
    },
  },
  {
    // An index of places on one side, the photos lined up on the other.
    id: "journal-quiet-index",
    name: "Quiet Index",
    category: CATEGORY,
    build: () => {
      const entry = (n: number, name: string, x: number, y: number) => [
        mono(String(n).padStart(2, "0"), [x, y + 12, 60]),
        text(name, [x + 70, y, 330], { size: 40, fontFamily: "Instrument Serif", fill: INK }),
      ];
      const names = ["Harbour", "Old town", "The market", "Hill road", "Lighthouse", "Last light"];
      return independent("Quiet Index", W, H, [
        {
          bg: solid(WHITE),
          els: [
            mono("INDEX", [70, 90, 300], { letterSpacing: 4 }),
            rule(70, 135, 340),
            ...names.flatMap((name, i) => entry(i + 1, name, 70, 200 + i * 150)),
            frame([480, 90, 530, 380], names[0]),
            frame([480, 490, 530, 380], names[1]),
            frame([480, 890, 530, 380], names[2]),
            mono("1 — 2", [70, 1250, 200]),
          ],
        },
        {
          bg: solid(WHITE),
          els: [
            frame([70, 90, 530, 380], names[3]),
            frame([70, 490, 530, 380], names[4]),
            frame([70, 890, 530, 380], names[5]),
            ...[3, 4, 5].flatMap((i, k) => [
              ...entry(i + 1, names[i], 640, 120 + k * 400),
              caption(["A steep climb and a\nbench at the top.", "Walked there at dusk,\nthe lamp already on.", "Every evening the\nsame orange, never dull."][k], [710, 190 + k * 400, 330], { size: 20, fill: MUTED }),
            ]),
            mono("2 — 2", [810, 1250, 200], { align: "right" }),
          ],
        },
      ]);
    },
  },
  {
    // Postcards: the picture side, the writing side, and two cards on the table.
    id: "journal-postcards",
    name: "Postcards From",
    category: CATEGORY,
    build: () => {
      const BG = "#e7e2d8";
      const CARD = "#fbfaf7";
      const card = (box: Box) => shape("rect", box, CARD, { shadow: { ...shadow, opacity: 0.16 }, name: "Card" });
      const stamp = (box: Box) => frame(box, "Stamp", { borderWidth: 6, borderColor: WHITE, shadow: { ...shadow, opacity: 0.12, blur: 6, offsetY: 2 } });
      const g1 = createId();
      const g2 = createId();
      return independent("Postcards From", W, H, [
        {
          bg: solid(BG),
          els: [
            card([70, 140, 940, 1070]),
            frame([110, 180, 860, 620], "Postcard photo"),
            title("Greetings from", [110, 840, 520], 64, { italic: true }),
            text("LISBON", [110, 910, 560], { size: 110, fontFamily: "Cormorant Garamond", fill: INK, letterSpacing: 8 }),
            stamp([800, 840, 160, 190]),
            sticker("scribble-circle", [700, 990, 150], MUTED, { opacity: 0.6, name: "Postmark" }),
            hand("wish you were here — A.", [110, 1080, 600], 44),
            rule(110, 1160, 560, MUTED),
          ],
        },
        {
          bg: solid(BG),
          els: [
            card([70, 140, 940, 1070]),
            shape("rect", [540, 200, 2, 950], MUTED, { name: "Divider" }),
            hand("Dear M,\nthe trams are yellow,\nthe tiles are blue and\nthe custard tarts are\nstill warm at nine.\nI'm keeping a list\nof places for when\nyou come.", [110, 220, 400], 40),
            frame([110, 700, 400, 460], "Small photo"),
            stamp([820, 200, 150, 180]),
            mono("PAR AVION", [580, 440, 300], { fill: "#3b5ba5", letterSpacing: 4, size: 20 }),
            rule(580, 600, 390, MUTED),
            rule(580, 680, 390, MUTED),
            rule(580, 760, 390, MUTED),
            rule(580, 840, 390, MUTED),
          ],
        },
        {
          bg: solid(BG),
          els: [
            { ...card([90, 150, 700, 520]), rotation: -4, groupId: g1 },
            { ...frame([120, 180, 640, 460], "Postcard 1"), rotation: -4, groupId: g1 },
            { ...card([290, 640, 700, 520]), rotation: 3, groupId: g2 },
            { ...frame([320, 670, 640, 460], "Postcard 2"), rotation: 3, groupId: g2 },
            title("until next\ntime", [90, 1190, 600], 70, { italic: true }),
          ],
        },
      ]);
    },
  },
  {
    // One wide photo across all three slides, words at the start, middle and end.
    id: "journal-panorama-diary",
    name: "Panorama Diary",
    category: CATEGORY,
    build: () =>
      seamless("Panorama Diary", W, H, 3, solid(WHITE), [
        frame([0, 380, W * 3, 700], "Panorama"),
        mono("DAY 04 — THE COAST ROAD", [70, 120, 700], { letterSpacing: 3 }),
        title("the long\nway round", [70, 1110, 900], 100),
        caption("kilometre 12 to 48", [1240, 160, 760], { align: "center" }),
        frame([1480, 1120, 440, 180], "Inset"),
        mono("38.7° N  9.4° W", [2700, 120, 470], { align: "right", letterSpacing: 3 }),
        title("and back\nagain", [2240, 1110, 930], 100, { italic: true, align: "right" }),
      ]),
  },
  {
    // A mosaic of photos with a small colour palette, like a page of collected things.
    id: "journal-collected",
    name: "Collected",
    category: CATEGORY,
    build: () => {
      const swatches = ["#c9b8a3", "#8a9a86", "#d9a48f", "#3c4a5c"].flatMap((color, i) => {
        const x = 60 + i * 100;
        return [shape("ellipse", [x, 1150, 70, 70], color, { name: `Swatch ${color}` }), mono(color, [x - 10, 1232, 90], { size: 14, align: "center" })];
      });
      return independent("Collected", W, H, [
        {
          bg: solid(PAPER),
          els: [
            frame([60, 60, 620, 520], "Photo 1"),
            frame([700, 60, 320, 250], "Photo 2"),
            frame([700, 330, 320, 250], "Photo 3"),
            frame([60, 600, 300, 380], "Photo 4"),
            frame([380, 600, 300, 380], "Photo 5"),
            frame([700, 600, 320, 640], "Photo 6"),
            title("collected", [60, 1010, 600], 110, { italic: true }),
            ...swatches,
          ],
        },
        {
          bg: solid(PAPER),
          els: [
            mono("N° 1 — 5", [60, 20, 400], { size: 16 }),
            frame([60, 60, 960, 600], "Photo 1"),
            frame([60, 680, 470, 610], "Photo 2"),
            frame([550, 680, 470, 300], "Photo 3"),
            frame([550, 1000, 230, 290], "Photo 4"),
            frame([800, 1000, 220, 290], "Photo 5"),
            mono("palette no. 2", [620, 20, 400], { size: 16, align: "right" }),
          ],
        },
      ]);
    },
  },
  {
    // Arched and round frames, centred type and words running up the sides.
    id: "journal-arches",
    name: "Arches",
    category: CATEGORY,
    build: () => {
      const BG = "#f3ede4";
      const arch = (box: Box, name: string) => frame(box, name, { mask: "arch" });
      const round = (box: Box, name: string) => frame(box, name, { mask: "ellipse" });
      const side = (content: string, centerX: number) => mono(content, [centerX - 150, 560, 300], { rotation: -90, letterSpacing: 6, size: 20, align: "center" });
      return independent("Arches", W, H, [
        {
          bg: solid(BG),
          els: [
            title("soft light", [0, 110, W], 110, { italic: true, align: "center" }),
            arch([60, 380, 300, 520], "Arch 1"),
            arch([390, 300, 300, 600], "Arch 2"),
            arch([720, 380, 300, 520], "Arch 3"),
            caption("notes from a slow week at home", [140, 1000, 800], { align: "center", size: 26 }),
            mono("VOL. 02", [0, 1250, W], { align: "center", letterSpacing: 6 }),
          ],
        },
        {
          bg: solid(BG),
          els: [
            arch([260, 120, 560, 900], "Arch"),
            side("SUNDAY MORNING", 170),
            side("N° 14 — 2026", 910),
            title("the light came in sideways", [100, 1080, 880], 52, { italic: true, align: "center" }),
          ],
        },
        {
          bg: solid(BG),
          els: [
            round([90, 160, 440, 440], "Circle 1"),
            round([550, 420, 440, 440], "Circle 2"),
            title("until\nsoon", [90, 920, 600], 120, { italic: true }),
            caption("one more coffee, then we go", [90, 1200, 600], { fill: MUTED }),
          ],
        },
      ]);
    },
  },
  {
    // One photo and one line a day, with a lot of white around them.
    id: "journal-one-line-a-day",
    name: "One Line a Day",
    category: CATEGORY,
    build: () => {
      const days: Array<[string, string]> = [
        ["MON 03", "the first cold morning"],
        ["TUE 04", "soup, and a book I can't put down"],
        ["WED 05", "a walk that went on too long"],
        ["THU 06", "flowers for no reason"],
        ["FRI 07", "everyone at the table, finally"],
      ];
      return independent(
        "One Line a Day",
        W,
        H,
        days.map(([date, line], i) => ({
          bg: solid(WHITE),
          els: [
            mono(date, [0, 120, W], { align: "center", letterSpacing: 6 }),
            frame([240, 220, 600, 760], `Day ${i + 1}`),
            title(line, [100, 1040, 880], 48, { italic: true, align: "center" }),
            mono(`${i + 1} / ${days.length}`, [0, 1250, W], { align: "center", size: 16, fill: MUTED }),
          ],
        })),
      );
    },
  },
  {
    // Square format: a tall photo and a column of notes, then a quiet grid.
    id: "journal-square-notes",
    name: "Square Notes",
    category: CATEGORY,
    build: () =>
      independent("Square Notes", 1080, 1080, [
        {
          bg: solid(BONE),
          els: [
            frame([60, 60, 600, 960], "Photo 1"),
            mono("NOTE 01", [700, 60, 320], { letterSpacing: 4 }),
            title("small\nthings", [700, 110, 320], 80, { italic: true }),
            frame([700, 300, 320, 480], "Photo 2"),
            caption("The good cup, the\nwindow seat, ten\nminutes of nothing\nbefore the day.", [700, 820, 320], { size: 20, fill: MUTED }),
          ],
        },
        {
          bg: solid(BONE),
          els: [
            frame([60, 60, 470, 470], "Photo 1"),
            frame([550, 60, 470, 470], "Photo 2"),
            frame([60, 550, 470, 470], "Photo 3"),
            frame([550, 550, 470, 370], "Photo 4"),
            caption("four small things,\nall from one Saturday", [550, 940, 470], { size: 22 }),
          ],
        },
      ]),
  },
  {
    // Story format (9:16): a big title, a hero photo and room for words.
    id: "journal-story",
    name: "Story Journal",
    category: CATEGORY,
    build: () => {
      const SH = 1920;
      return independent("Story Journal", W, SH, [
        {
          bg: solid(PAPER),
          els: [
            mono("SATURDAY — 08.11.26", [80, 120, 920], { letterSpacing: 4 }),
            title("today\nin pictures", [80, 190, 920], 130),
            frame([80, 520, 920, 1100], "Hero"),
            caption("Nowhere to be, so we went everywhere.\nThe whole day, in a few frames.", [80, 1670, 920], { size: 28 }),
          ],
        },
        {
          bg: solid(PAPER),
          els: [
            frame([80, 120, 920, 520], "Photo 1"),
            frame([80, 670, 440, 560], "Photo 2"),
            frame([560, 670, 440, 560], "Photo 3"),
            title("noon, then\nthe long lunch", [80, 1290, 920], 56, { italic: true }),
            mono("2 / 3", [80, 1760, 920], { align: "right" }),
          ],
        },
        {
          bg: solid(PAPER),
          els: [
            frame([0, 0, W, 1300], "Full bleed"),
            title("see you\ntomorrow", [80, 1380, 920], 110, { italic: true }),
            mono("3 / 3", [80, 1760, 920], { align: "right" }),
          ],
        },
      ]);
    },
  },
];
