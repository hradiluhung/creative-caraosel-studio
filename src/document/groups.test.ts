import { describe, expect, it } from "vitest";
import { createProject, createShape } from "./factory";
import { PANORAMA_ID } from "./geometry";
import { expandToGroups, groupElements, groupMembers, groupState, normalizeGroups, remapGroups, reorderMany, ungroupElements } from "./groups";
import { parseProject } from "./migrations";
import * as ops from "./operations";
import { projectSchema, type DesignElement } from "./schema";

const P = { centerX: 0, centerY: 0, maxWidth: 1000, maxHeight: 1000 };
const el = (id: string, extra: Partial<DesignElement> = {}): DesignElement => ({ ...createShape("rect", P), id, name: id, x: 0, y: 0, width: 100, height: 100, ...extra }) as DesignElement;
const ids = (els: DesignElement[]) => els.map((e) => e.id);
const groupsOf = (els: DesignElement[]) => els.map((e) => e.groupId ?? "-");

describe("grouping", () => {
  const base = [el("a"), el("b"), el("c"), el("d"), el("e")];

  it("gathers the members at the topmost one, keeping their order, and keeps everything else", () => {
    const g = groupElements(base, ["d", "a"], "G");
    expect(ids(g)).toEqual(["b", "c", "a", "d", "e"]);
    expect(groupsOf(g)).toEqual(["-", "-", "G", "G", "-"]);
    // Each member keeps its own properties.
    expect(g.find((e) => e.id === "a")).toEqual({ ...base[0], groupId: "G" });
  });

  it("needs two elements, and merges groups instead of nesting them", () => {
    expect(groupElements(base, ["a"], "G")).toBe(base);
    const first = groupElements(base, ["a", "b"], "G1");
    const merged = groupElements(first, ["a", "b", "e"], "G2");
    expect(groupsOf(merged)).toEqual(["-", "-", "G2", "G2", "G2"]);
  });

  it("takes an element out of its old group, and a group of one is dissolved", () => {
    const g1 = groupElements(base, ["a", "b"], "G1");
    const g2 = groupElements(g1, ["b", "c"], "G2");
    expect(g2.find((e) => e.id === "a")!.groupId).toBeUndefined();
    expect(groupsOf(g2).filter((x) => x === "G2")).toHaveLength(2);
    expect(normalizeGroups([el("x", { groupId: "Z" }), el("y")]).every((e) => e.groupId === undefined)).toBe(true);
  });

  it("finds the members and expands a selection to whole groups", () => {
    const g = groupElements(base, ["b", "d"], "G");
    expect(groupMembers(g, "d")).toEqual(["b", "d"]);
    expect(groupMembers(g, "a")).toEqual(["a"]);
    expect(groupMembers(g, "nope")).toEqual([]);
    expect(expandToGroups(g, ["a", "d"])).toEqual(["a", "b", "d"]);
  });

  it("says when grouping and ungrouping make sense", () => {
    const g = groupElements(base, ["a", "b"], "G");
    expect(groupState(g, ["a"])).toEqual({ canGroup: false, canUngroup: true });
    expect(groupState(g, ["a", "b"])).toEqual({ canGroup: false, canUngroup: true }); // already exactly one group
    expect(groupState(g, ["a", "b", "c"])).toEqual({ canGroup: true, canUngroup: true });
    expect(groupState(g, ["c", "d"])).toEqual({ canGroup: true, canUngroup: false });
    expect(groupState(g, ["c"])).toEqual({ canGroup: false, canUngroup: false });
  });

  it("ungroups every group the selection touches and nothing else", () => {
    let g = groupElements(base, ["a", "b"], "G1");
    g = groupElements(g, ["d", "e"], "G2");
    const u = ungroupElements(g, ["a"]);
    expect(groupsOf(u)).toEqual(["-", "-", "-", "G2", "G2"]);
    expect(ungroupElements(base, ["a"])).toBe(base);
  });

  it("gives copies of a group their own new group", () => {
    const g = groupElements(base, ["a", "b"], "G");
    const copies = remapGroups(g.slice(0, 2).map((e) => ({ ...e, id: `${e.id}2` })));
    expect(copies[0].groupId).toBe(copies[1].groupId);
    expect(copies[0].groupId).not.toBe("G");
  });
});

describe("reordering several elements", () => {
  const base = [el("a"), el("b"), el("c"), el("d"), el("e")];
  it("moves the selection one step, as a block, keeping its order", () => {
    expect(ids(reorderMany(base, ["b", "c"], "forward"))).toEqual(["a", "d", "b", "c", "e"]);
    expect(ids(reorderMany(base, ["c", "d"], "backward"))).toEqual(["a", "c", "d", "b", "e"]);
    expect(ids(reorderMany(base, ["a", "c"], "forward"))).toEqual(["b", "a", "d", "c", "e"]);
    expect(ids(reorderMany(base, ["b", "e"], "backward"))).toEqual(["b", "a", "c", "e", "d"]);
  });
  it("brings to the front and sends to the back", () => {
    expect(ids(reorderMany(base, ["d", "b"], "front"))).toEqual(["a", "c", "e", "b", "d"]);
    expect(ids(reorderMany(base, ["d", "b"], "back"))).toEqual(["b", "d", "a", "c", "e"]);
  });
  it("changes nothing when there is nowhere to go", () => {
    expect(reorderMany(base, ["d", "e"], "forward")).toBe(base);
    expect(reorderMany(base, ["a"], "backward")).toBe(base);
    expect(reorderMany(base, ["x"], "front")).toBe(base);
  });
});

describe("groups in the document", () => {
  const project = () => {
    const p = createProject({ name: "t", width: 1000, height: 1000, slideCount: 2, mode: "independent" }, new Date(0));
    return ops.addElements(p, p.slides[0].id, [el("a"), el("b"), el("c")]);
  };

  it("are saved, validated and opened like any other field", () => {
    const p = project();
    const g = ops.groupOnSurface(p, p.slides[0].id, ["a", "c"]);
    expect(projectSchema.safeParse(JSON.parse(JSON.stringify(g))).success).toBe(true);
    const reopened = parseProject(JSON.parse(JSON.stringify(g)));
    expect(groupsOf(reopened.slides[0].elements).filter((x) => x !== "-")).toHaveLength(2);
    expect(parseProject({ ...JSON.parse(JSON.stringify(p)), schemaVersion: 6 }).schemaVersion).toBe(7);
  });

  it("dissolves when deleting leaves a single member", () => {
    const p = project();
    const g = ops.groupOnSurface(p, p.slides[0].id, ["a", "b"]);
    const after = ops.removeElements(g, p.slides[0].id, ["a"]);
    expect(after.slides[0].elements.every((e) => e.groupId === undefined)).toBe(true);
  });

  it("duplicates into a new group", () => {
    const p = project();
    const g = ops.groupOnSurface(p, p.slides[0].id, ["a", "b"]);
    const { project: d, newIds } = ops.duplicateElements(g, p.slides[0].id, ["a", "b"]);
    const copies = d.slides[0].elements.filter((e) => newIds.includes(e.id));
    const original = d.slides[0].elements.find((e) => e.id === "a")!.groupId;
    expect(copies[0].groupId).toBe(copies[1].groupId);
    expect(copies[0].groupId).not.toBe(original);
  });
});

describe("deleting any slide", () => {
  it("removes exactly that slide in an independent project", () => {
    const p = createProject({ name: "t", width: 1080, height: 1350, slideCount: 3, mode: "independent" }, new Date(0));
    const withContent = p.slides.reduce((acc, s, i) => ops.addElements(acc, s.id, [el(`on${i + 1}`)]), p);
    const after = ops.removeSlide(withContent, p.slides[1].id);
    expect(after.slides.map((s) => s.id)).toEqual([p.slides[0].id, p.slides[2].id]);
    expect(after.slides.map((s) => ids(s.elements))).toEqual([["on1"], ["on3"]]);
    expect(ops.removeSlide(after, "nope")).toBe(after);
  });

  it("cuts a slide out of a seamless panorama and closes the gap", () => {
    const p = createProject({ name: "t", width: 1000, height: 1000, slideCount: 3, mode: "seamless" }, new Date(0));
    const els = [
      el("left", { x: 100 }), // on slide 1
      el("middle", { x: 1400 }), // on slide 2
      el("right", { x: 2300 }), // on slide 3
      el("crossing", { x: 1900, width: 300 }), // centre 2050: slide 3, crosses into it from slide 2
      el("g1", { x: 900, width: 150, groupId: "G" }), // group centre (900..1150) = 1025: slide 2
      el("g2", { x: 1000, width: 150, groupId: "G" }),
    ];
    const withContent = ops.addElements(p, PANORAMA_ID, els);
    const after = ops.removeSlide(withContent, p.slides[1].id);
    expect(after.slides.map((s) => s.id)).toEqual([p.slides[0].id, p.slides[2].id]);
    const byId = new Map(after.panorama.elements.map((e) => [e.id, e]));
    expect([...byId.keys()].sort()).toEqual(["crossing", "left", "right"]);
    expect(byId.get("left")!.x).toBe(100);
    expect(byId.get("right")!.x).toBe(1300);
    expect(byId.get("crossing")!.x).toBe(900);
  });

  it("keeps a group together when it moves", () => {
    const p = createProject({ name: "t", width: 1000, height: 1000, slideCount: 3, mode: "seamless" }, new Date(0));
    const withContent = ops.addElements(p, PANORAMA_ID, [el("g1", { x: 2050, groupId: "G" }), el("g2", { x: 2600, groupId: "G" })]);
    const after = ops.removeSlide(withContent, p.slides[0].id);
    expect(after.panorama.elements.map((e) => e.x)).toEqual([1050, 1600]);
    expect(groupsOf(after.panorama.elements)).toEqual(["G", "G"]);
  });

  it("never removes the only slide", () => {
    const p = createProject({ name: "t", width: 1000, height: 1000, slideCount: 1, mode: "seamless" }, new Date(0));
    expect(ops.removeSlide(p, p.slides[0].id)).toBe(p);
  });
});
