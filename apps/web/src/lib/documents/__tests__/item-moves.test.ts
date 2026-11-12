import { describe, expect, it } from "vitest";
import {
  canMove,
  describePlace,
  destinationsFor,
  placeOf,
  stepPosition,
  TOP_LEVEL,
} from "../item-moves.ts";
import type { OutlineNode } from "../use-outline.ts";

function node(id: string, title: string, children: readonly OutlineNode[] = []): OutlineNode {
  return {
    id,
    parentId: null,
    title,
    wordCount: 0,
    updatedAt: "2026-11-12T09:00:00.000Z",
    children: children.map((child) => ({ ...child, parentId: id })),
  };
}

// Act 1 holds scenes 1a, 1b, 1c; Act 2 holds scene 2a; Chapter 3 is empty; Act 4 holds scene 4a.
const tree: readonly OutlineNode[] = [
  node("act1", "Act 1", [node("1a", "Scene 1a"), node("1b", "Scene 1b"), node("1c", "Scene 1c")]),
  node("act2", "Act 2", [node("2a", "Scene 2a")]),
  node("ch3", "Chapter 3"),
  node("act4", "Act 4", [node("4a", "Scene 4a")]),
];

describe("placeOf", () => {
  it("finds a top-level item among the top-level items", () => {
    const place = placeOf(tree, "act2");
    expect(place?.parent).toBeUndefined();
    expect(place?.index).toBe(1);
    expect(place?.siblings).toHaveLength(4);
  });

  it("finds a scene among the scenes of its act, with the act", () => {
    const place = placeOf(tree, "1b");
    expect(place?.parent?.id).toBe("act1");
    expect(place?.index).toBe(1);
    expect(place?.siblings.map((sibling) => sibling.id)).toEqual(["1a", "1b", "1c"]);
  });

  it("finds nothing for an id that is not in the outline", () => {
    expect(placeOf(tree, "nope")).toBeUndefined();
    expect(placeOf([], "act1")).toBeUndefined();
  });
});

describe("canMove and stepPosition", () => {
  it("cannot move the first item up, but can move it down", () => {
    expect(canMove(tree, "1a", "up")).toBe(false);
    expect(canMove(tree, "1a", "down")).toBe(true);
    expect(canMove(tree, "act1", "up")).toBe(false);
    expect(canMove(tree, "act1", "down")).toBe(true);
  });

  it("cannot move the last item down, but can move it up", () => {
    expect(canMove(tree, "1c", "down")).toBe(false);
    expect(canMove(tree, "1c", "up")).toBe(true);
    expect(canMove(tree, "act4", "down")).toBe(false);
    expect(canMove(tree, "act4", "up")).toBe(true);
  });

  it("can move an item in the middle both ways", () => {
    expect(canMove(tree, "1b", "up")).toBe(true);
    expect(canMove(tree, "1b", "down")).toBe(true);
    expect(canMove(tree, "ch3", "up")).toBe(true);
    expect(canMove(tree, "ch3", "down")).toBe(true);
  });

  it("cannot move an only child anywhere", () => {
    expect(canMove(tree, "2a", "up")).toBe(false);
    expect(canMove(tree, "2a", "down")).toBe(false);
    expect(canMove(tree, "4a", "up")).toBe(false);
    expect(canMove(tree, "4a", "down")).toBe(false);
  });

  it("cannot move an item that is not in the outline", () => {
    expect(canMove(tree, "nope", "up")).toBe(false);
    expect(canMove(tree, "nope", "down")).toBe(false);
  });

  it("counts a step up as the index before, and a step down as the index after", () => {
    expect(stepPosition(tree, "1b", "up")).toBe(0);
    expect(stepPosition(tree, "1b", "down")).toBe(2);
    expect(stepPosition(tree, "act2", "up")).toBe(0);
    expect(stepPosition(tree, "act2", "down")).toBe(2);
    expect(stepPosition(tree, "ch3", "down")).toBe(3);
  });

  it("gives no position when there is no step that way", () => {
    expect(stepPosition(tree, "1a", "up")).toBeUndefined();
    expect(stepPosition(tree, "1c", "down")).toBeUndefined();
    expect(stepPosition(tree, "2a", "down")).toBeUndefined();
    expect(stepPosition(tree, "nope", "up")).toBeUndefined();
  });
});

describe("destinationsFor", () => {
  it("offers a scene the top level and every other act or chapter, but not the one it is in", () => {
    const destinations = destinationsFor(tree, "1b");
    expect(destinations.map((destination) => destination.label)).toEqual([
      "Top level",
      "Inside “Act 2”",
      "Inside “Chapter 3”",
      "Inside “Act 4”",
    ]);
    expect(destinations.map((destination) => destination.parentId)).toEqual([
      null,
      "act2",
      "ch3",
      "act4",
    ]);
  });

  it("uses the top-level value for the top level and the id for an act", () => {
    const [top, first] = destinationsFor(tree, "1b");
    expect(top?.value).toBe(TOP_LEVEL);
    expect(first?.value).toBe("act2");
  });

  it("offers an item without scenes every other act or chapter, never itself and never the top level", () => {
    const destinations = destinationsFor(tree, "ch3");
    expect(destinations.map((destination) => destination.parentId)).toEqual([
      "act1",
      "act2",
      "act4",
    ]);
  });

  it("offers nothing to an act that has scenes: the outline has one level only", () => {
    expect(destinationsFor(tree, "act1")).toEqual([]);
    expect(destinationsFor(tree, "act2")).toEqual([]);
  });

  it("offers a scene the top level even when it is the only act", () => {
    const only = [node("a", "Only act", [node("s", "Only scene")])];
    expect(destinationsFor(only, "s").map((destination) => destination.parentId)).toEqual([null]);
  });

  it("offers a lone empty top-level item nothing at all", () => {
    expect(destinationsFor([node("a", "Alone")], "a")).toEqual([]);
  });

  it("offers nothing for an item that is not in the outline", () => {
    expect(destinationsFor(tree, "nope")).toEqual([]);
  });

  it("puts the title in the label as it is, whatever it contains", () => {
    const odd = [node("a", "<b>Act</b>"), node("b", "B", [node("s", "S")])];
    expect(destinationsFor(odd, "s")[1]?.label).toBe("Inside “<b>Act</b>”");
  });
});

describe("describePlace", () => {
  it("counts from 1 and says how many there are", () => {
    const place = placeOf(tree, "1b");
    expect(place === undefined ? "" : describePlace(place)).toBe("2 of 3");
    const first = placeOf(tree, "act1");
    expect(first === undefined ? "" : describePlace(first)).toBe("1 of 4");
  });
});
