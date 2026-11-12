import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  answerSave,
  makeDocument,
  makeOutlineItem,
  saved,
} from "../../../test-support/documents-handlers.ts";
import { server } from "../../../test-support/msw-server.ts";
import { problemResponse } from "../../../test-support/projects-handlers.ts";
import { deferred } from "../../../test-support/session-harness.ts";
import { signedInManager } from "../../../test-support/signed-in-manager.ts";
import { ApiError } from "../../api/problem.ts";
import { AuthProvider } from "../../auth/session.tsx";
import { createDocumentSaver, type DocumentSaver } from "../document-saver.ts";
import { useItemActions } from "../use-item-actions.ts";
import { buildTree, type OutlineNode } from "../use-outline.ts";

// The outline used by every test: Act 1 holds scenes 1a, 1b, 1c; Act 2 holds 2a; Chapter 3 is empty.
const act1 = makeOutlineItem({ title: "Act 1", position: 0 });
const s1a = makeOutlineItem({ title: "Scene 1a", parentId: act1.id, position: 0 });
const s1b = makeOutlineItem({ title: "Scene 1b", parentId: act1.id, position: 1 });
const s1c = makeOutlineItem({ title: "Scene 1c", parentId: act1.id, position: 2 });
const act2 = makeOutlineItem({ title: "Act 2", position: 1 });
const s2a = makeOutlineItem({ title: "Scene 2a", parentId: act2.id, position: 0 });
const ch3 = makeOutlineItem({ title: "Chapter 3", position: 2 });
const items = [act1, s1a, s1b, s1c, act2, s2a, ch3];
const nodes: readonly OutlineNode[] = buildTree(items);

function realSaver(version = 3): DocumentSaver {
  return createDocumentSaver(
    { text: "text", version, wordCount: 1 },
    {
      save: vi.fn().mockResolvedValue({ version: version + 1, wordCount: 1 }),
      load: vi.fn().mockResolvedValue({ version }),
      setTimer: (callback, ms) => {
        const id = setTimeout(callback, ms);
        return () => {
          clearTimeout(id);
        };
      },
      reportError: vi.fn(),
    },
  );
}

async function renderActions(
  itemId: string,
  extra: {
    saver?: DocumentSaver;
    refresh?: () => Promise<readonly OutlineNode[] | undefined>;
    tree?: readonly OutlineNode[];
  } = {},
) {
  const context = await signedInManager();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider manager={context.manager}>{children}</AuthProvider>
  );
  const saver = extra.saver ?? realSaver();
  const refresh = vi.fn(extra.refresh ?? (() => Promise.resolve(extra.tree ?? nodes)));
  const onDeleted = vi.fn();
  const announce = vi.fn();
  const view = renderHook(
    () =>
      useItemActions({
        projectId: "project-1",
        itemId,
        nodes: extra.tree ?? nodes,
        saver,
        refresh,
        onDeleted,
        announce,
      }),
    { wrapper },
  );
  return { ...view, saver, refresh, onDeleted, announce };
}

function answerDelete(reply: () => Response | Promise<Response>) {
  const calls: { path: string; ifMatch: string | null }[] = [];
  server.use(
    http.delete("/projects/:projectId/documents/:id", ({ request }) => {
      calls.push({
        path: new URL(request.url).pathname,
        ifMatch: request.headers.get("if-match"),
      });
      return reply();
    }),
  );
  return calls;
}

const document = (id: string, version = 3) => makeDocument({ id, version, projectId: "project-1" });

describe("useItemActions: rename", () => {
  it("sends the new title with the version the autosave holds, and reads the outline again", async () => {
    const calls = answerSave(saved(document(s1b.id)));
    const { result, refresh, announce } = await renderActions(s1b.id);

    let done = false;
    await act(async () => {
      done = await result.current.rename("A better name");
    });

    expect(done).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe(s1b.id);
    expect(calls[0]?.ifMatch).toBe('"3"');
    expect(calls[0]?.body).toEqual({ title: "A better name" });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("Renamed to “A better name”.");
    expect(result.current.problem).toBeUndefined();
    expect(result.current.busy).toBe(false);
  });

  it("trims the title, as the API does", async () => {
    const calls = answerSave(saved(document(s1b.id)));
    const { result } = await renderActions(s1b.id);
    await act(async () => {
      await result.current.rename("  Spaced out  ");
    });
    expect(calls[0]?.body).toEqual({ title: "Spaced out" });
  });

  it("keeps the new version, so the next text save does not conflict with the rename", async () => {
    answerSave(saved(document(s1b.id)));
    const { result, saver } = await renderActions(s1b.id);
    await act(async () => {
      await result.current.rename("New");
    });
    expect(saver.getSnapshot().version).toBe(4);
  });

  it("asks for a title when it is empty or only spaces, and sends nothing", async () => {
    const calls = answerSave(saved(document(s1b.id)));
    const { result, refresh } = await renderActions(s1b.id);

    for (const title of ["", "   ", "\t\n"]) {
      let done = true;
      await act(async () => {
        done = await result.current.rename(title);
      });
      expect(done).toBe(false);
      expect(result.current.problem).toEqual({ title: "Enter a title.", general: [] });
    }
    expect(calls).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does nothing, and says it is done, when the title is the one it already has", async () => {
    const calls = answerSave(saved(document(s1b.id)));
    const { result, refresh, announce } = await renderActions(s1b.id);

    let done = false;
    await act(async () => {
      done = await result.current.rename("  Scene 1b ");
    });

    expect(done).toBe(true);
    expect(calls).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it("shows the API's words under the title when it refuses the title, and changes nothing else", async () => {
    answerSave(() =>
      problemResponse(400, "validation", {
        errors: [{ pointer: "/title", message: "The title can be at most 200 characters." }],
      }),
    );
    const { result, refresh, announce, saver } = await renderActions(s1b.id);

    let done = true;
    await act(async () => {
      done = await result.current.rename("x".repeat(201));
    });

    expect(done).toBe(false);
    expect(result.current.problem?.title).toBe("The title can be at most 200 characters.");
    expect(refresh).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
    // The text is fine: a refused title must not make it look unsaved or invalid.
    expect(saver.getSnapshot().status.kind).toBe("saved");
    expect(saver.getSnapshot().version).toBe(3);
  });

  it("says that the server cannot be reached", async () => {
    server.use(http.patch("*", () => HttpResponse.error()));
    const { result } = await renderActions(s1b.id);
    await act(async () => {
      await result.current.rename("New");
    });
    expect(result.current.problem?.general).toEqual([
      "Can't reach the server. Check your connection and try again.",
    ]);
    expect(result.current.busy).toBe(false);
  });

  it("logs an answer in the wrong shape and shows a general message", async () => {
    answerSave(() => HttpResponse.json({ nonsense: true }));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = await renderActions(s1b.id);

    await act(async () => {
      await result.current.rename("New");
    });

    expect(log).toHaveBeenCalledTimes(1);
    expect(result.current.problem?.general).toEqual(["Something went wrong. Please try again."]);
    log.mockRestore();
  });

  it("does not log an expected failure", async () => {
    answerSave(() => problemResponse(503, "unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = await renderActions(s1b.id);
    await act(async () => {
      await result.current.rename("New");
    });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("on a 412 puts the text in conflict and says nothing was renamed", async () => {
    answerSave(() => problemResponse(412, "precondition-failed"));
    const { result, saver, refresh } = await renderActions(s1b.id);

    await act(async () => {
      await result.current.rename("New");
    });

    expect(saver.getSnapshot().status.kind).toBe("conflict");
    expect(result.current.problem?.general[0]).toContain("nothing was renamed");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("sends nothing while the text is in conflict", async () => {
    const calls = answerSave(saved(document(s1b.id)));
    const conflicted = createDocumentSaver(
      { text: "a", version: 3, wordCount: 1 },
      {
        save: vi.fn().mockRejectedValue(
          new ApiError({
            status: 412,
            code: undefined,
            detail: undefined,
            issues: [],
            retryAfterSeconds: undefined,
          }),
        ),
        load: vi.fn(),
        setTimer: () => () => undefined,
        reportError: vi.fn(),
      },
    );
    conflicted.change("b");
    await conflicted.flush();
    expect(conflicted.getSnapshot().status.kind).toBe("conflict");

    const { result } = await renderActions(s1b.id, { saver: conflicted });
    await act(async () => {
      await result.current.rename("New");
    });

    expect(calls).toEqual([]);
    expect(result.current.problem?.general[0]).toContain("nothing was renamed");
  });

  it("on a 404 says the item is gone and reads the outline again", async () => {
    answerSave(() => problemResponse(404, "not-found"));
    const { result, saver, refresh } = await renderActions(s1b.id);

    await act(async () => {
      await result.current.rename("New");
    });

    expect(saver.getSnapshot().status.kind).toBe("gone");
    expect(result.current.problem?.general).toEqual(["This item does not exist any more."]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("ignores a second press while the first request runs", async () => {
    const gate = deferred<Response>();
    const calls = answerSave(() => gate.promise);
    const { result } = await renderActions(s1b.id);

    let first: Promise<boolean> = Promise.resolve(false);
    act(() => {
      first = result.current.rename("One");
    });
    await waitFor(() => expect(result.current.busy).toBe(true));
    let second = true;
    await act(async () => {
      second = await result.current.rename("Two");
    });
    expect(second).toBe(false);

    gate.resolve(HttpResponse.json({ ...document(s1b.id), title: "One", version: 4 }));
    await act(async () => {
      await first;
    });
    expect(calls).toHaveLength(1);
  });

  it("clears an old problem when the next attempt starts, and when it is forgotten", async () => {
    answerSave(() => problemResponse(503, "unavailable"));
    const { result } = await renderActions(s1b.id);
    await act(async () => {
      await result.current.rename("New");
    });
    expect(result.current.problem).toBeDefined();

    act(() => {
      result.current.forgetProblem();
    });
    expect(result.current.problem).toBeUndefined();
  });
});

describe("useItemActions: move", () => {
  it("moves up by one place, and says where the item is now", async () => {
    const calls = answerSave(saved(document(s1b.id)));
    const after = buildTree([act1, s1b, s1a, s1c, act2, s2a, ch3]);
    const { result, refresh, announce } = await renderActions(s1b.id, {
      refresh: () => Promise.resolve(after),
    });

    await act(async () => {
      await result.current.move("up");
    });

    expect(calls[0]?.body).toEqual({ position: 0 });
    expect(calls[0]?.ifMatch).toBe('"3"');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("“Scene 1b” moved. It is now 1 of 3 in “Act 1”.");
  });

  it("moves down by one place", async () => {
    const calls = answerSave(saved(document(s1b.id)));
    const { result } = await renderActions(s1b.id);
    await act(async () => {
      await result.current.move("down");
    });
    expect(calls[0]?.body).toEqual({ position: 2 });
  });

  it("moves a top-level item among the top-level items", async () => {
    const calls = answerSave(saved(document(act2.id)));
    const after = buildTree([act2, s2a, act1, s1a, s1b, s1c, ch3]);
    const { result, announce } = await renderActions(act2.id, {
      refresh: () => Promise.resolve(after),
    });

    await act(async () => {
      await result.current.move("up");
    });

    expect(calls[0]?.body).toEqual({ position: 0 });
    expect(announce).toHaveBeenCalledWith("“Act 2” moved. It is now 1 of 3 at the top level.");
  });

  it("sends nothing at the edge of the list", async () => {
    const calls = answerSave(saved(document(s1a.id)));
    const { result, refresh } = await renderActions(s1a.id);

    let done = true;
    await act(async () => {
      done = await result.current.move("up");
    });

    expect(done).toBe(false);
    expect(calls).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
    expect(result.current.problem).toBeUndefined();
  });

  it("moves a scene to another act, at its end, and says where it is", async () => {
    const calls = answerSave(saved(document(s1b.id)));
    const moved = { ...s1b, parentId: act2.id, position: 1 };
    const after = buildTree([act1, s1a, s1c, act2, s2a, moved, ch3]);
    const { result, announce } = await renderActions(s1b.id, {
      refresh: () => Promise.resolve(after),
    });

    await act(async () => {
      await result.current.moveTo(act2.id);
    });

    expect(calls[0]?.body).toEqual({ parentId: act2.id });
    expect(announce).toHaveBeenCalledWith("“Scene 1b” moved. It is now 2 of 2 in “Act 2”.");
  });

  it("moves a scene to the top level, which is null and not a missing parent", async () => {
    const calls = answerSave(saved(document(s1b.id)));
    const moved = { ...s1b, parentId: null, position: 3 };
    const after = buildTree([act1, s1a, s1c, act2, s2a, ch3, moved]);
    const { result, announce } = await renderActions(s1b.id, {
      refresh: () => Promise.resolve(after),
    });

    await act(async () => {
      await result.current.moveTo(null);
    });

    expect(calls[0]?.body).toEqual({ parentId: null });
    expect(announce).toHaveBeenCalledWith("“Scene 1b” moved. It is now 4 of 4 at the top level.");
  });

  it("still says it was moved when the outline could not be read again", async () => {
    answerSave(saved(document(s1b.id)));
    const { result, announce } = await renderActions(s1b.id, {
      refresh: () => Promise.resolve(undefined),
    });
    await act(async () => {
      await result.current.move("down");
    });
    expect(announce).toHaveBeenCalledWith("“Scene 1b” was moved.");
  });

  it("explains a refused move and announces nothing", async () => {
    answerSave(() => problemResponse(400, "validation"));
    const { result, announce, refresh } = await renderActions(s1b.id);

    let done = true;
    await act(async () => {
      done = await result.current.moveTo(act2.id);
    });

    expect(done).toBe(false);
    expect(result.current.problem?.general).toEqual([
      "That is not possible here. Check the outline and try again.",
    ]);
    expect(announce).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps the version of the move, so that the next text save follows it", async () => {
    answerSave(saved(document(s1b.id)));
    const { result, saver } = await renderActions(s1b.id);
    await act(async () => {
      await result.current.move("down");
    });
    expect(saver.getSnapshot().version).toBe(4);
  });
});

describe("useItemActions: delete", () => {
  it("deletes the item with no version, closes it, announces it and reads the outline again", async () => {
    const calls = answerDelete(() => new HttpResponse(null, { status: 204 }));
    const { result, onDeleted, announce, refresh } = await renderActions(s1b.id);

    let done = false;
    await act(async () => {
      done = await result.current.remove();
    });

    expect(done).toBe(true);
    expect(calls).toEqual([{ path: `/projects/project-1/documents/${s1b.id}`, ifMatch: null }]);
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("“Scene 1b” was deleted.");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops the autosave for good once the item is gone: nothing is saved into it any more", async () => {
    answerDelete(() => new HttpResponse(null, { status: 204 }));
    const save = vi.fn().mockResolvedValue({ version: 4, wordCount: 1 });
    const saver = createDocumentSaver(
      { text: "text", version: 3, wordCount: 1 },
      {
        save,
        load: vi.fn(),
        setTimer: (callback, ms) => {
          const id = setTimeout(callback, ms);
          return () => {
            clearTimeout(id);
          };
        },
        reportError: vi.fn(),
      },
    );
    const { result } = await renderActions(s1b.id, { saver });
    saver.change("typed just before the delete");

    await act(async () => {
      await result.current.remove();
    });

    // What a blur or a page hide would do while the editor goes away.
    await saver.flush();
    expect(save).not.toHaveBeenCalled();
    expect(await saver.exclusive(() => Promise.reject(new Error("never")))).toEqual({
      ok: false,
      reason: "left",
    });
  });

  it("counts a 404 as done: the item was already gone", async () => {
    answerDelete(() => problemResponse(404, "not-found"));
    const { result, onDeleted, announce } = await renderActions(s1b.id);

    let done = false;
    await act(async () => {
      done = await result.current.remove();
    });

    expect(done).toBe(true);
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("“Scene 1b” was deleted.");
    expect(result.current.problem).toBeUndefined();
  });

  it("keeps the item, and the autosave working, when the delete fails", async () => {
    answerDelete(() => problemResponse(503, "unavailable"));
    const { result, onDeleted, announce, saver } = await renderActions(s1b.id);

    let done = true;
    await act(async () => {
      done = await result.current.remove();
    });

    expect(done).toBe(false);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
    expect(result.current.problem?.general).toEqual([
      "The service is busy. Try again in a moment.",
    ]);
    // The text is still being looked after.
    expect(await saver.exclusive(() => Promise.resolve({ version: 4, wordCount: 1 }))).toEqual({
      ok: true,
    });
  });

  it("says that the server cannot be reached", async () => {
    server.use(http.delete("*", () => HttpResponse.error()));
    const { result, onDeleted } = await renderActions(s1b.id);
    await act(async () => {
      await result.current.remove();
    });
    expect(onDeleted).not.toHaveBeenCalled();
    expect(result.current.problem?.general).toEqual([
      "Can't reach the server. Check your connection and try again.",
    ]);
  });

  it("names an item whose title has markup in it as plain text", async () => {
    answerDelete(() => new HttpResponse(null, { status: 204 }));
    const odd = makeOutlineItem({ title: "<b>Odd</b>" });
    const { result, announce } = await renderActions(odd.id, { tree: buildTree([odd]) });
    await act(async () => {
      await result.current.remove();
    });
    expect(announce).toHaveBeenCalledWith("“<b>Odd</b>” was deleted.");
  });

  it("encodes the id in the address", async () => {
    const calls = answerDelete(() => new HttpResponse(null, { status: 204 }));
    const tricky = makeOutlineItem({ id: "a/../b", title: "Tricky" });
    const { result } = await renderActions(tricky.id, { tree: buildTree([tricky]) });
    await act(async () => {
      await result.current.remove();
    });
    expect(calls[0]?.path).toBe("/projects/project-1/documents/a%2F..%2Fb");
  });

  it("ignores a second press while the delete runs", async () => {
    const gate = deferred<Response>();
    const calls = answerDelete(() => gate.promise);
    const { result } = await renderActions(s1b.id);

    let first: Promise<boolean> = Promise.resolve(false);
    act(() => {
      first = result.current.remove();
    });
    await waitFor(() => expect(result.current.busy).toBe(true));
    let second = true;
    await act(async () => {
      second = await result.current.remove();
    });
    expect(second).toBe(false);

    gate.resolve(new HttpResponse(null, { status: 204 }));
    await act(async () => {
      await first;
    });
    expect(calls).toHaveLength(1);
  });
});
