/**
 * Groups. A group is nothing more than the same `groupId` on several elements of one surface:
 * the element list stays flat, so rendering, export and every other operation work unchanged,
 * and each member keeps all of its own properties. The editor selects all members together
 * when one of them is clicked on the canvas, so the group moves, resizes and rotates as one.
 *
 * Members are kept next to each other in the stacking order (grouping gathers them at the
 * position of the topmost one), so a group also moves as one block when it is reordered.
 */
import { createId } from "./ids";
import type { DesignElement } from "./schema";

type Els = readonly DesignElement[];

/** The element and everything grouped with it, in stacking order. */
export function groupMembers(elements: Els, id: string): string[] {
  const el = elements.find((e) => e.id === id);
  if (!el) return [];
  if (!el.groupId) return [id];
  return elements.filter((e) => e.groupId === el.groupId).map((e) => e.id);
}

/** The ids plus every member of the groups they belong to, in stacking order. */
export function expandToGroups(elements: Els, ids: readonly string[]): string[] {
  const want = new Set(ids);
  const groups = new Set(elements.filter((e) => want.has(e.id) && e.groupId).map((e) => e.groupId));
  return elements.filter((e) => want.has(e.id) || (e.groupId !== undefined && groups.has(e.groupId))).map((e) => e.id);
}

export interface GroupState {
  canGroup: boolean;
  canUngroup: boolean;
}

/** Group needs two or more elements that are not already exactly one group; ungroup needs a grouped element. */
export function groupState(elements: Els, ids: readonly string[]): GroupState {
  const sel = elements.filter((e) => ids.includes(e.id));
  const groups = new Set(sel.map((e) => e.groupId));
  const oneWholeGroup =
    groups.size === 1 && sel[0]?.groupId !== undefined && elements.filter((e) => e.groupId === sel[0].groupId).length === sel.length;
  return { canGroup: sel.length >= 2 && !oneWholeGroup, canUngroup: sel.some((e) => e.groupId !== undefined) };
}

/** A group of one is no group: drop the id when only a single member is left. */
export function normalizeGroups(elements: DesignElement[]): DesignElement[] {
  const counts = new Map<string, number>();
  for (const e of elements) if (e.groupId) counts.set(e.groupId, (counts.get(e.groupId) ?? 0) + 1);
  if (![...counts.values()].some((n) => n < 2)) return elements;
  return elements.map((e) => (e.groupId && counts.get(e.groupId)! < 2 ? withoutGroup(e) : e));
}

function withoutGroup(e: DesignElement): DesignElement {
  const { groupId: _gone, ...rest } = e;
  void _gone;
  return rest as DesignElement;
}

/**
 * Put the elements into one new group, gathered at the position of the topmost one in their
 * current order. Groups the selection touches are merged (no nesting).
 */
export function groupElements(elements: DesignElement[], ids: readonly string[], groupId: string = createId()): DesignElement[] {
  const want = new Set(ids);
  const chosen = elements.filter((e) => want.has(e.id));
  if (chosen.length < 2) return elements;
  const top = elements.reduce((at, e, i) => (want.has(e.id) ? i : at), -1);
  const out: DesignElement[] = [];
  elements.forEach((e, i) => {
    if (i === top) out.push(...chosen.map((c) => ({ ...c, groupId })));
    else if (!want.has(e.id)) out.push(e);
  });
  return normalizeGroups(out);
}

/** Dissolve every group that one of the ids belongs to. */
export function ungroupElements(elements: DesignElement[], ids: readonly string[]): DesignElement[] {
  const groups = new Set(elements.filter((e) => ids.includes(e.id) && e.groupId).map((e) => e.groupId));
  if (groups.size === 0) return elements;
  return elements.map((e) => (e.groupId && groups.has(e.groupId) ? withoutGroup(e) : e));
}

export type StackDirection = "forward" | "backward" | "front" | "back";

/**
 * Move several elements in the stacking order at once, keeping their order among themselves.
 * Forward and backward move each block of selected elements past one unselected neighbour.
 */
export function reorderMany(elements: DesignElement[], ids: readonly string[], direction: StackDirection): DesignElement[] {
  const want = new Set(ids);
  if (!elements.some((e) => want.has(e.id))) return elements;
  if (direction === "front" || direction === "back") {
    const chosen = elements.filter((e) => want.has(e.id));
    const rest = elements.filter((e) => !want.has(e.id));
    return direction === "front" ? [...rest, ...chosen] : [...chosen, ...rest];
  }
  const out = elements.slice();
  if (direction === "forward") {
    for (let i = out.length - 2; i >= 0; i--) {
      if (want.has(out[i].id) && !want.has(out[i + 1].id)) {
        // Lift the whole block that ends here over the next unselected element.
        let start = i;
        while (start > 0 && want.has(out[start - 1].id)) start--;
        const [above] = out.splice(i + 1, 1);
        out.splice(start, 0, above);
        i = start;
      }
    }
  } else {
    for (let i = 1; i < out.length; i++) {
      if (want.has(out[i].id) && !want.has(out[i - 1].id)) {
        let end = i;
        while (end < out.length - 1 && want.has(out[end + 1].id)) end++;
        const [below] = out.splice(i - 1, 1);
        out.splice(end, 0, below);
        i = end;
      }
    }
  }
  return out.every((e, i) => e === elements[i]) ? elements : out;
}

/** Fresh group ids for copies, so a copied group is a new group of its own. */
export function remapGroups(copies: DesignElement[]): DesignElement[] {
  const fresh = new Map<string, string>();
  return copies.map((e) => {
    if (!e.groupId) return e;
    if (!fresh.has(e.groupId)) fresh.set(e.groupId, createId());
    return { ...e, groupId: fresh.get(e.groupId)! };
  });
}
