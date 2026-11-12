import { findNode, type OutlineNode } from "./use-outline.ts";

/** Where an item stands among its siblings. */
export interface Place {
  /** The act or chapter it is in, or `undefined` at the top level. */
  readonly parent: OutlineNode | undefined;
  /** Every item at the same level, itself included, in order. */
  readonly siblings: readonly OutlineNode[];
  /** Counted from 0. */
  readonly index: number;
}

export type Direction = "up" | "down";

/** The value of the "Top level" choice. It cannot be mistaken for an id (they are UUIDs). */
export const TOP_LEVEL = "top";

/** One place an item can be moved to. */
export interface Destination {
  /** The value of the choice in the list: {@link TOP_LEVEL}, or the id of the act or chapter. */
  readonly value: string;
  /** `null` is the top level. */
  readonly parentId: string | null;
  readonly label: string;
}

/** Finds where an item stands in the outline, or `undefined` when it is not in it. */
export function placeOf(nodes: readonly OutlineNode[], id: string): Place | undefined {
  const found = findNode(nodes, id);
  if (found === undefined) return undefined;
  const siblings = found.parent === undefined ? nodes : found.parent.children;
  const index = siblings.findIndex((node) => node.id === id);
  return index === -1 ? undefined : { parent: found.parent, siblings, index };
}

/** True when the item has a neighbour on that side to change places with. */
export function canMove(nodes: readonly OutlineNode[], id: string, direction: Direction): boolean {
  const place = placeOf(nodes, id);
  if (place === undefined) return false;
  return direction === "up" ? place.index > 0 : place.index < place.siblings.length - 1;
}

/**
 * The `position` that moves the item one step. The API counts it among the siblings without the item
 * itself, so one step up is the index before and one step down is the index after. `undefined` when
 * there is no step in that direction.
 */
export function stepPosition(
  nodes: readonly OutlineNode[],
  id: string,
  direction: Direction,
): number | undefined {
  const place = placeOf(nodes, id);
  if (place === undefined || !canMove(nodes, id, direction)) return undefined;
  return direction === "up" ? place.index - 1 : place.index + 1;
}

/**
 * Where else the item may go: the top level (from inside an act or chapter), and inside each act or
 * chapter that it is not already in. The outline has one level of nesting, so an item that has items
 * of its own cannot go inside another and gets no choices. An item cannot go inside itself.
 */
export function destinationsFor(nodes: readonly OutlineNode[], id: string): readonly Destination[] {
  const place = placeOf(nodes, id);
  if (place === undefined) return [];
  const node = place.siblings[place.index];
  if (node === undefined) return [];

  if (place.parent !== undefined) {
    return [
      { value: TOP_LEVEL, parentId: null, label: "Top level" },
      ...nodes
        .filter((candidate) => candidate.id !== place.parent?.id)
        .map((candidate) => inside(candidate)),
    ];
  }

  if (node.children.length > 0) return [];
  return nodes.filter((candidate) => candidate.id !== id).map((candidate) => inside(candidate));
}

function inside(node: OutlineNode): Destination {
  return { value: node.id, parentId: node.id, label: `Inside “${node.title}”` };
}

/** "2 of 5", counted from 1, for a screen reader to say where an item now is. */
export function describePlace(place: Place): string {
  return `${place.index + 1} of ${place.siblings.length}`;
}
