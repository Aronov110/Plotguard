import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  answerOutline,
  itemOf,
  makeDocument,
  makeOutlineItem,
} from "../../../test-support/documents-handlers.ts";
import { problemResponse } from "../../../test-support/projects-handlers.ts";
import { signedInManager } from "../../../test-support/signed-in-manager.ts";
import { AuthProvider } from "../../auth/session.tsx";
import { buildTree, countNodes, findNode, type OutlineView, useOutline } from "../use-outline.ts";

describe("buildTree", () => {
  it("is empty for an empty outline", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("puts each scene under its act, in the order given", () => {
    const act1 = makeOutlineItem({ title: "Act 1" });
    const a = makeOutlineItem({ title: "1a", parentId: act1.id });
    const b = makeOutlineItem({ title: "1b", parentId: act1.id });
    const act2 = makeOutlineItem({ title: "Act 2" });
    const c = makeOutlineItem({ title: "2a", parentId: act2.id });

    const tree = buildTree([act1, a, b, act2, c]);

    expect(tree.map((node) => node.title)).toEqual(["Act 1", "Act 2"]);
    expect(tree[0]?.children.map((node) => node.title)).toEqual(["1a", "1b"]);
    expect(tree[1]?.children.map((node) => node.title)).toEqual(["2a"]);
  });

  it("copies what the screen shows into each node", () => {
    const item = makeOutlineItem({ title: "T", wordCount: 42, updatedAt: "2026-01-02T03:04:05Z" });
    expect(buildTree([item])).toEqual([
      {
        id: item.id,
        parentId: null,
        title: "T",
        wordCount: 42,
        updatedAt: "2026-01-02T03:04:05Z",
        children: [],
      },
    ]);
  });

  it("works even when the children come before their parent in the list", () => {
    const act = makeOutlineItem({ title: "Act" });
    const scene = makeOutlineItem({ title: "Scene", parentId: act.id });
    const tree = buildTree([scene, act]);
    expect(tree.map((node) => node.title)).toEqual(["Act"]);
    expect(tree[0]?.children.map((node) => node.title)).toEqual(["Scene"]);
  });

  it("shows an item whose parent is missing at the top level instead of losing it", () => {
    const orphan = makeOutlineItem({ title: "Orphan", parentId: "no-such-parent" });
    const tree = buildTree([makeOutlineItem({ title: "Act" }), orphan]);
    expect(tree.map((node) => node.title)).toEqual(["Act", "Orphan"]);
  });

  it("keeps scenes without a parent act separate from the acts' scenes", () => {
    const act = makeOutlineItem({ title: "Act" });
    const tree = buildTree([
      act,
      makeOutlineItem({ title: "In", parentId: act.id }),
      makeOutlineItem({ title: "Loose" }),
    ]);
    expect(tree.map((node) => [node.title, node.children.length])).toEqual([
      ["Act", 1],
      ["Loose", 0],
    ]);
  });
});

describe("findNode and countNodes", () => {
  const act = makeOutlineItem({ title: "Act" });
  const scene = makeOutlineItem({ title: "Scene", parentId: act.id });
  const tree = buildTree([act, scene, makeOutlineItem({ title: "Other act" })]);

  it("finds a top-level item without a parent", () => {
    const found = findNode(tree, act.id);
    expect(found?.node.title).toBe("Act");
    expect(found?.parent).toBeUndefined();
  });

  it("finds a scene with its parent", () => {
    const found = findNode(tree, scene.id);
    expect(found?.node.title).toBe("Scene");
    expect(found?.parent?.title).toBe("Act");
  });

  it("finds nothing for an unknown id", () => {
    expect(findNode(tree, "nope")).toBeUndefined();
  });

  it("counts every item, scenes included", () => {
    expect(countNodes(tree)).toBe(3);
    expect(countNodes([])).toBe(0);
  });
});

async function renderOutline(projectId = "project-1") {
  const context = await signedInManager();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider manager={context.manager}>{children}</AuthProvider>
  );
  return {
    ...renderHook(({ id }) => useOutline(id), { wrapper, initialProps: { id: projectId } }),
    context,
  };
}

function ready(result: { readonly current: { readonly view: OutlineView } }) {
  const view = result.current.view;
  if (view.status !== "ready") throw new Error(`Expected ready, got ${view.status}.`);
  return view;
}

describe("useOutline", () => {
  it("is loading first, then shows the tree", async () => {
    const act = makeOutlineItem({ title: "Act" });
    const scene = makeOutlineItem({ title: "Scene", parentId: act.id });
    answerOutline([act, scene]);
    const { result } = await renderOutline();

    expect(result.current.view).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    expect(ready(result).nodes.map((node) => node.title)).toEqual(["Act"]);
    expect(ready(result).nodes[0]?.children.map((node) => node.title)).toEqual(["Scene"]);
  });

  it("asks for the right project's outline, with the access token", async () => {
    const calls = answerOutline([]);
    const { result } = await renderOutline("project-42");
    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    expect(calls[0]?.url.pathname).toBe("/projects/project-42/documents");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer token-1");
  });

  it("is ready with nothing in it for a project without items", async () => {
    answerOutline([]);
    const { result } = await renderOutline();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    expect(ready(result).nodes).toEqual([]);
  });

  it("says why it failed, and loads again on retry", async () => {
    const calls = answerOutline(
      () => problemResponse(503, "service-unavailable"),
      [makeOutlineItem({ title: "After retry" })],
    );
    const { result } = await renderOutline();
    await waitFor(() => expect(result.current.view.status).toBe("failed"));
    expect(result.current.view).toEqual({
      status: "failed",
      message: "The service is busy. Try again in a moment.",
    });

    act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    expect(ready(result).nodes.map((node) => node.title)).toEqual(["After retry"]);
    expect(calls).toHaveLength(2);
  });

  it("says that the project is not there after a 404", async () => {
    answerOutline(() => problemResponse(404, "not-found"));
    const { result } = await renderOutline();
    await waitFor(() => expect(result.current.view.status).toBe("failed"));
    expect(result.current.view).toMatchObject({
      message: "This project does not exist, or it is not yours.",
    });
  });

  it("logs an unexpected failure, never an expected one", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      answerOutline(() => problemResponse(503, "service-unavailable"));
      const expected = await renderOutline();
      await waitFor(() => expect(expected.result.current.view.status).toBe("failed"));
      expect(log).not.toHaveBeenCalled();

      answerOutline(() => HttpResponse.json({ nonsense: true }));
      const unexpected = await renderOutline();
      await waitFor(() => expect(unexpected.result.current.view.status).toBe("failed"));
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it("loads the new project's outline when the project changes", async () => {
    answerOutline([makeOutlineItem({ title: "Only here" })]);
    const { result, rerender } = await renderOutline("project-1");
    await waitFor(() => expect(result.current.view.status).toBe("ready"));

    answerOutline([makeOutlineItem({ title: "Over there" })]);
    rerender({ id: "project-2" });
    await waitFor(() =>
      expect(ready(result).nodes.map((node) => node.title)).toEqual(["Over there"]),
    );
  });

  describe("adding", () => {
    it("puts a new top-level item at the end", async () => {
      answerOutline([makeOutlineItem({ title: "First" })]);
      const { result } = await renderOutline();
      await waitFor(() => expect(result.current.view.status).toBe("ready"));

      act(() => {
        result.current.add(makeDocument({ title: "Second" }));
      });
      expect(ready(result).nodes.map((node) => node.title)).toEqual(["First", "Second"]);
    });

    it("puts a new scene at the end of its act, and nowhere else", async () => {
      const act = makeOutlineItem({ title: "Act" });
      const other = makeOutlineItem({ title: "Other act" });
      answerOutline([act, makeOutlineItem({ title: "Existing", parentId: act.id }), other]);
      const { result } = await renderOutline();
      await waitFor(() => expect(result.current.view.status).toBe("ready"));

      act_(() => result.current.add(makeDocument({ title: "New scene", parentId: act.id })));

      const nodes = ready(result).nodes;
      expect(nodes[0]?.children.map((node) => node.title)).toEqual(["Existing", "New scene"]);
      expect(nodes[1]?.children).toEqual([]);
    });

    it("shows a scene whose act is unknown at the top level", async () => {
      answerOutline([]);
      const { result } = await renderOutline();
      await waitFor(() => expect(result.current.view.status).toBe("ready"));
      act_(() => result.current.add(makeDocument({ title: "Lost", parentId: "unknown" })));
      expect(ready(result).nodes.map((node) => node.title)).toEqual(["Lost"]);
    });

    it("does not show the same document twice", async () => {
      const first = makeDocument({ title: "Once" });
      answerOutline([]);
      const { result } = await renderOutline();
      await waitFor(() => expect(result.current.view.status).toBe("ready"));
      act_(() => {
        result.current.add(first);
        result.current.add(first);
      });
      expect(ready(result).nodes).toHaveLength(1);
    });

    it("does not change an item that was already in the loaded outline", async () => {
      const document = makeDocument({ title: "Known" });
      answerOutline([itemOf(document)]);
      const { result } = await renderOutline();
      await waitFor(() => expect(result.current.view.status).toBe("ready"));
      act_(() => result.current.add({ ...document, title: "Changed" }));
      expect(ready(result).nodes.map((node) => node.title)).toEqual(["Known"]);
    });
  });

  describe("word counts", () => {
    it("shows the count the server gave for a top-level item and for a scene", async () => {
      const act = makeOutlineItem({ title: "Act", wordCount: 1 });
      const scene = makeOutlineItem({ title: "Scene", parentId: act.id, wordCount: 2 });
      answerOutline([act, scene]);
      const { result } = await renderOutline();
      await waitFor(() => expect(result.current.view.status).toBe("ready"));

      act_(() => result.current.setWordCount(act.id, 10));
      act_(() => result.current.setWordCount(scene.id, 20));

      const nodes = ready(result).nodes;
      expect(nodes[0]?.wordCount).toBe(10);
      expect(nodes[0]?.children[0]?.wordCount).toBe(20);
    });

    it("leaves the other items alone, and ignores an unknown id", async () => {
      const a = makeOutlineItem({ title: "A", wordCount: 1 });
      const b = makeOutlineItem({ title: "B", wordCount: 2 });
      answerOutline([a, b]);
      const { result } = await renderOutline();
      await waitFor(() => expect(result.current.view.status).toBe("ready"));
      act_(() => result.current.setWordCount(a.id, 5));
      act_(() => result.current.setWordCount("unknown", 99));
      expect(ready(result).nodes.map((node) => node.wordCount)).toEqual([5, 2]);
    });
  });

  it("cancels its request when the screen is left", async () => {
    answerOutline(() => new Promise<Response>(() => undefined));
    const { unmount } = await renderOutline();
    unmount();
    // Nothing to assert beyond not throwing: the aborted request must not report an error.
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

/** `act` for a function that returns something: its result is not needed. */
function act_(callback: () => unknown): void {
  act(() => {
    callback();
  });
}
