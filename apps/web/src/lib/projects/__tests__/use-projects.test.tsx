import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { type ReactNode, StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../../test-support/msw-server.ts";
import {
  answerProjectList,
  makeProject,
  problemResponse,
  projectPage,
} from "../../../test-support/projects-handlers.ts";
import { deferred, session } from "../../../test-support/session-harness.ts";
import { signedInManager } from "../../../test-support/signed-in-manager.ts";
import { AuthProvider } from "../../auth/session.tsx";
import { type UseProjects, useProjects } from "../use-projects.ts";

async function renderProjects(options: { strict?: boolean; renewedToken?: string } = {}) {
  const context = await signedInManager();
  // Must be set before the first render: the first request starts at once.
  if (options.renewedToken !== undefined) {
    context.api.refresh.mockResolvedValue(session(options.renewedToken));
  }
  const wrapper = ({ children }: { children: ReactNode }) => {
    const tree = <AuthProvider manager={context.manager}>{children}</AuthProvider>;
    return options.strict === true ? <StrictMode>{tree}</StrictMode> : tree;
  };
  return { ...renderHook(() => useProjects(), { wrapper }), context };
}

/** The view, narrowed to "ready". Fails the test with a clear message when it is not. */
function ready(result: { readonly current: UseProjects }) {
  const view = result.current.view;
  if (view.status !== "ready")
    throw new Error(`Expected the view to be ready, it is ${view.status}.`);
  return view;
}

const titles = (result: { readonly current: UseProjects }) =>
  ready(result).items.map((project) => project.title);

describe("useProjects: the first page", () => {
  it("is loading first, then shows the projects with the API's order", async () => {
    const [a, b] = [makeProject({ title: "A" }), makeProject({ title: "B" })];
    answerProjectList(projectPage([a, b], "cursor-2"));
    const { result } = await renderProjects();

    expect(result.current.view).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.view.status).toBe("ready"));

    const view = ready(result);
    expect(view.items).toEqual([a, b]);
    expect(view.hasMore).toBe(true);
    expect(view.loadingMore).toBe(false);
    expect(view.moreError).toBeUndefined();
    expect(view.justLoaded).toBeUndefined();
  });

  it("is ready with nothing in it for a person without projects", async () => {
    answerProjectList(projectPage([]));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    expect(ready(result)).toMatchObject({ items: [], hasMore: false });
  });

  it("asks for the first page without a cursor, with the access token", async () => {
    const calls = answerProjectList(projectPage([]));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.search).toBe("");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer token-1");
  });

  it("says why it failed, in words, and loads again on retry", async () => {
    const calls = answerProjectList(
      () => problemResponse(503, "service-unavailable"),
      projectPage([makeProject({ title: "After retry" })]),
    );
    const { result } = await renderProjects();

    await waitFor(() => expect(result.current.view.status).toBe("failed"));
    expect(result.current.view).toEqual({
      status: "failed",
      message: "The service is busy. Try again in a moment.",
    });

    act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    expect(titles(result)).toEqual(["After retry"]);
    expect(calls).toHaveLength(2);
  });

  it("says that the server cannot be reached when there is no answer", async () => {
    answerProjectList(() => HttpResponse.error());
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("failed"));
    expect(result.current.view).toMatchObject({
      message: "Can't reach the server. Check your connection and try again.",
    });
  });

  it("does not log an expected failure, but does log an unexpected one", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      answerProjectList(() => problemResponse(503, "service-unavailable"));
      const expected = await renderProjects();
      await waitFor(() => expect(expected.result.current.view.status).toBe("failed"));
      expect(log).not.toHaveBeenCalled();

      answerProjectList(() => HttpResponse.json({ nonsense: true }));
      const unexpected = await renderProjects();
      await waitFor(() => expect(unexpected.result.current.view.status).toBe("failed"));
      expect(log).toHaveBeenCalledTimes(1);
      expect(unexpected.result.current.view).toMatchObject({
        message: "Your projects could not be loaded. Please try again.",
      });
    } finally {
      log.mockRestore();
    }
  });

  it("works under React's StrictMode, which runs effects twice while developing", async () => {
    answerProjectList(projectPage([makeProject({ title: "Once" })]));
    const { result } = await renderProjects({ strict: true });
    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    expect(titles(result)).toEqual(["Once"]);
  });
});

describe("useProjects: renewing the login", () => {
  it("renews an expired token once and asks again with the new one", async () => {
    const calls = answerProjectList(
      () => problemResponse(401, "unauthorized"),
      projectPage([makeProject({ title: "Renewed" })]),
    );
    const { result, context } = await renderProjects({ renewedToken: "token-2" });

    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    expect(titles(result)).toEqual(["Renewed"]);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer token-1");
    expect(calls[1]?.headers.get("authorization")).toBe("Bearer token-2");
    expect(context.api.refresh).toHaveBeenCalledTimes(1);
  });

  it("gives up after one renewal instead of asking again and again", async () => {
    const calls = answerProjectList(() => problemResponse(401, "unauthorized"));
    const { result, context } = await renderProjects({ renewedToken: "token-2" });
    await waitFor(() => expect(result.current.view.status).toBe("failed"));
    // One request, one renewal, one more request: two requests, never a loop.
    expect(calls).toHaveLength(2);
    expect(context.api.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("useProjects: loading more", () => {
  it("asks for the next page with the cursor and adds what comes back", async () => {
    const [a, b, c] = [
      makeProject({ title: "A" }),
      makeProject({ title: "B" }),
      makeProject({ title: "C" }),
    ];
    const calls = answerProjectList(projectPage([a, b], "cursor-2"), projectPage([c], null));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(titles(result)).toEqual(["A", "B", "C"]));

    expect(calls).toHaveLength(2);
    expect(calls[1]?.url.searchParams.get("cursor")).toBe("cursor-2");
    const view = ready(result);
    expect(view.hasMore).toBe(false);
    expect(view.loadingMore).toBe(false);
    expect(view.justLoaded).toEqual({ firstId: c.id, count: 1, serial: 1 });
  });

  it("shows a project that comes back on a later page only once", async () => {
    const [a, b, c] = [
      makeProject({ title: "A" }),
      makeProject({ title: "B" }),
      makeProject({ title: "C" }),
    ];
    answerProjectList(projectPage([a, b], "cursor-2"), projectPage([b, c, c], null));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(ready(result).hasMore).toBe(false));

    expect(titles(result)).toEqual(["A", "B", "C"]);
    expect(ready(result).justLoaded).toEqual({ firstId: c.id, count: 1, serial: 1 });
  });

  it("reports nothing new when a page holds only projects that are already shown", async () => {
    const a = makeProject({ title: "A" });
    answerProjectList(projectPage([a], "cursor-2"), projectPage([a], null));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(ready(result).hasMore).toBe(false));
    expect(titles(result)).toEqual(["A"]);
    expect(ready(result).justLoaded).toBeUndefined();
  });

  it("counts every load, so two loads of the same size can be told apart", async () => {
    answerProjectList(
      projectPage([makeProject()], "c2"),
      projectPage([makeProject()], "c3"),
      projectPage([makeProject()], null),
    );
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(ready(result).justLoaded?.serial).toBe(1));
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(ready(result).justLoaded?.serial).toBe(2));
  });

  it("sends one request when the button is pressed twice before the answer comes", async () => {
    const gate = deferred<Response>();
    const calls = answerProjectList(projectPage([makeProject()], "cursor-2"), () => gate.promise);
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));

    act(() => {
      result.current.loadMore();
      result.current.loadMore();
    });
    await waitFor(() => expect(ready(result).loadingMore).toBe(true));
    act(() => {
      result.current.loadMore();
    });
    expect(calls).toHaveLength(2);

    gate.resolve(HttpResponse.json(projectPage([makeProject()], null)));
    await waitFor(() => expect(ready(result).loadingMore).toBe(false));
    expect(ready(result).items).toHaveLength(2);
  });

  it("keeps what is shown when a page fails, says why, and tries again on the next press", async () => {
    const [a, b] = [makeProject({ title: "A" }), makeProject({ title: "B" })];
    answerProjectList(
      projectPage([a], "cursor-2"),
      () => problemResponse(503, "service-unavailable"),
      projectPage([b], null),
    );
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(ready(result).moreError).toBeDefined());
    expect(ready(result)).toMatchObject({
      moreError: "The service is busy. Try again in a moment.",
      loadingMore: false,
      hasMore: true,
    });
    expect(titles(result)).toEqual(["A"]);

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(titles(result)).toEqual(["A", "B"]));
    expect(ready(result).moreError).toBeUndefined();
  });

  it("does nothing on the last page", async () => {
    const calls = answerProjectList(projectPage([makeProject()], null));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    act(() => {
      result.current.loadMore();
    });
    expect(calls).toHaveLength(1);
  });

  it("does nothing while the first page is still loading", async () => {
    const gate = deferred<Response>();
    const calls = answerProjectList(() => gate.promise);
    const { result } = await renderProjects();
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => {
      result.current.loadMore();
    });
    expect(calls).toHaveLength(1);
    gate.resolve(HttpResponse.json(projectPage([])));
    await waitFor(() => expect(result.current.view.status).toBe("ready"));
  });

  it("does nothing after the first page failed", async () => {
    const calls = answerProjectList(() => problemResponse(503, "service-unavailable"));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("failed"));
    act(() => {
      result.current.loadMore();
    });
    expect(calls).toHaveLength(1);
  });
});

describe("useProjects: a project that was just created", () => {
  it("goes to the top of a list that is already shown", async () => {
    const [a, b] = [makeProject({ title: "A" }), makeProject({ title: "B" })];
    answerProjectList(projectPage([a, b]));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));

    act(() => {
      result.current.add(makeProject({ title: "New" }));
    });
    expect(titles(result)).toEqual(["New", "A", "B"]);
  });

  it("is shown once however many times it is added", async () => {
    answerProjectList(projectPage([makeProject({ title: "A" })]));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));

    const fresh = makeProject({ title: "New" });
    act(() => {
      result.current.add(fresh);
      result.current.add({ ...fresh, title: "New, renamed" });
    });
    expect(titles(result)).toEqual(["New, renamed", "A"]);
  });

  it("puts the newest on top of the older new ones", async () => {
    answerProjectList(projectPage([makeProject({ title: "A" })]));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));

    act(() => {
      result.current.add(makeProject({ title: "First new" }));
    });
    act(() => {
      result.current.add(makeProject({ title: "Second new" }));
    });
    expect(titles(result)).toEqual(["Second new", "First new", "A"]);
  });

  it("is not lost, nor doubled, when the first page arrives after it was created", async () => {
    const gate = deferred<Response>();
    const older = makeProject({ title: "Older" });
    const fresh = makeProject({ title: "New" });
    const calls = answerProjectList(() => gate.promise);
    const { result } = await renderProjects();
    await waitFor(() => expect(calls).toHaveLength(1));

    act(() => {
      result.current.add(fresh);
    });
    // The page was made after the project was created, so it already holds it.
    gate.resolve(HttpResponse.json(projectPage([fresh, older])));

    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    expect(titles(result)).toEqual(["New", "Older"]);
  });

  it("is kept when the first page arrives without it", async () => {
    const gate = deferred<Response>();
    const calls = answerProjectList(() => gate.promise);
    const { result } = await renderProjects();
    await waitFor(() => expect(calls).toHaveLength(1));

    act(() => {
      result.current.add(makeProject({ title: "New" }));
    });
    gate.resolve(HttpResponse.json(projectPage([makeProject({ title: "Older" })])));

    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    expect(titles(result)).toEqual(["New", "Older"]);
  });

  it("is kept when the list has to be loaded again after a failure", async () => {
    answerProjectList(
      () => problemResponse(503, "service-unavailable"),
      projectPage([makeProject({ title: "Older" })]),
    );
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("failed"));

    act(() => {
      result.current.add(makeProject({ title: "New" }));
      result.current.retry();
    });
    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    expect(titles(result)).toEqual(["New", "Older"]);
  });

  it("clears the note about the last page that was loaded", async () => {
    answerProjectList(projectPage([makeProject()], "c2"), projectPage([makeProject()], null));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(ready(result).justLoaded).toBeDefined());

    act(() => {
      result.current.add(makeProject());
    });
    expect(ready(result).justLoaded).toBeUndefined();
  });

  it("is not shown again when a later page returns it", async () => {
    const fresh = makeProject({ title: "New" });
    answerProjectList(
      projectPage([makeProject({ title: "A" })], "c2"),
      projectPage([fresh, makeProject({ title: "B" })], null),
    );
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));

    act(() => {
      result.current.add(fresh);
    });
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(ready(result).hasMore).toBe(false));
    expect(titles(result)).toEqual(["New", "A", "B"]);
  });
});

describe("useProjects: leaving the screen", () => {
  it("cancels the first request", async () => {
    let signal: AbortSignal | undefined;
    server.use(
      http.get("/projects", ({ request }) => {
        signal = request.signal;
        return new Promise<Response>(() => undefined);
      }),
    );
    const { unmount } = await renderProjects();
    await waitFor(() => expect(signal).toBeDefined());
    expect(signal?.aborted).toBe(false);

    unmount();
    await waitFor(() => expect(signal?.aborted).toBe(true));
  });

  it("cancels a request for more projects", async () => {
    let signal: AbortSignal | undefined;
    let calls = 0;
    server.use(
      http.get("/projects", ({ request }) => {
        calls += 1;
        if (calls === 1) return HttpResponse.json(projectPage([makeProject()], "cursor-2"));
        signal = request.signal;
        return new Promise<Response>(() => undefined);
      }),
    );
    const { result, unmount } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(signal).toBeDefined());

    unmount();
    await waitFor(() => expect(signal?.aborted).toBe(true));
  });

  it("does not log an error for the request it cancelled", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      let seen = false;
      server.use(
        http.get("/projects", () => {
          seen = true;
          return new Promise<Response>(() => undefined);
        }),
      );
      const { unmount } = await renderProjects();
      await waitFor(() => expect(seen).toBe(true));
      unmount();
      // Let any late rejection arrive.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe("useProjects: a project that was changed", () => {
  const [a, b, c] = [
    makeProject({ title: "A" }),
    makeProject({ title: "B" }),
    makeProject({ title: "C" }),
  ];

  async function shown() {
    answerProjectList(projectPage([a, b, c], "cursor-2"));
    const rendered = await renderProjects();
    await waitFor(() => expect(rendered.result.current.view.status).toBe("ready"));
    return rendered;
  }

  it("goes to the top of the list, in place of its old version, and is announced", async () => {
    const { result } = await shown();
    act(() => {
      result.current.replace({ ...b, title: "B, renamed" }, "Project “B, renamed” saved.");
    });
    expect(titles(result)).toEqual(["B, renamed", "A", "C"]);
    expect(ready(result).announcement).toEqual({ text: "Project “B, renamed” saved.", serial: 1 });
  });

  it("is shown once however many times it is changed", async () => {
    const { result } = await shown();
    act(() => {
      result.current.replace({ ...c, title: "C1" }, "first");
    });
    act(() => {
      result.current.replace({ ...c, title: "C2" }, "second");
    });
    expect(titles(result)).toEqual(["C2", "A", "B"]);
  });

  it("tells two announcements with the same words apart", async () => {
    const { result } = await shown();
    act(() => {
      result.current.replace({ ...a }, "Same words.");
    });
    expect(ready(result).announcement?.serial).toBe(1);
    act(() => {
      result.current.replace({ ...a }, "Same words.");
    });
    expect(ready(result).announcement).toEqual({ text: "Same words.", serial: 2 });
  });

  it("is not shown twice when a later page returns its old version", async () => {
    const x = makeProject({ title: "X, on page two" });
    answerProjectList(projectPage([a], "cursor-2"), projectPage([x], null));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));

    act(() => {
      result.current.replace({ ...x, title: "X, renamed" }, "saved");
    });
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(ready(result).hasMore).toBe(false));
    expect(titles(result)).toEqual(["X, renamed", "A"]);
  });

  it("clears the note about the last page that was loaded", async () => {
    answerProjectList(projectPage([a], "c2"), projectPage([b], null));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(ready(result).justLoaded).toBeDefined());

    act(() => {
      result.current.replace({ ...a, title: "A2" }, "saved");
    });
    expect(ready(result).justLoaded).toBeUndefined();
  });
});

describe("useProjects: a project that was deleted", () => {
  const [a, b, c] = [
    makeProject({ title: "A" }),
    makeProject({ title: "B" }),
    makeProject({ title: "C" }),
  ];

  it("leaves the list, wherever it was, and is announced", async () => {
    answerProjectList(projectPage([a, b, c], "cursor-2"));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));

    act(() => {
      result.current.remove(b.id, "Project “B” deleted.");
    });
    expect(titles(result)).toEqual(["A", "C"]);
    expect(ready(result).announcement).toEqual({ text: "Project “B” deleted.", serial: 1 });
  });

  it("leaves the list when it was created on this screen", async () => {
    answerProjectList(projectPage([a]));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    const fresh = makeProject({ title: "Fresh" });
    act(() => {
      result.current.add(fresh);
    });
    expect(titles(result)).toEqual(["Fresh", "A"]);

    act(() => {
      result.current.remove(fresh.id, "deleted");
    });
    expect(titles(result)).toEqual(["A"]);
  });

  it("empties the list when the last project is deleted", async () => {
    answerProjectList(projectPage([a]));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    act(() => {
      result.current.remove(a.id, "deleted");
    });
    expect(ready(result)).toMatchObject({ items: [], hasMore: false });
  });

  it("does not change the list for an id it does not know, but still announces", async () => {
    answerProjectList(projectPage([a, b]));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    act(() => {
      result.current.remove("unknown", "gone");
    });
    expect(titles(result)).toEqual(["A", "B"]);
    expect(ready(result).announcement?.text).toBe("gone");
  });

  it("keeps the place in the pages: the next page is asked for with the same cursor", async () => {
    const calls = answerProjectList(projectPage([a, b], "cursor-2"), projectPage([c], null));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));

    act(() => {
      result.current.remove(a.id, "deleted");
    });
    expect(ready(result).hasMore).toBe(true);
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(titles(result)).toEqual(["B", "C"]));
    expect(calls[1]?.url.searchParams.get("cursor")).toBe("cursor-2");
  });
});

describe("useProjects: announcing without a change", () => {
  it("announces and leaves the list as it is", async () => {
    const a = makeProject({ title: "A" });
    answerProjectList(projectPage([a]));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));

    act(() => {
      result.current.announce("No changes to save.");
    });
    expect(titles(result)).toEqual(["A"]);
    expect(ready(result).announcement).toEqual({ text: "No changes to save.", serial: 1 });
  });

  it("is forgotten when more projects are loaded", async () => {
    answerProjectList(projectPage([makeProject()], "c2"), projectPage([makeProject()], null));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    act(() => {
      result.current.announce("Something.");
    });
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(ready(result).justLoaded).toBeDefined());
    expect(ready(result).announcement).toBeUndefined();
  });

  it("is forgotten when a project is created", async () => {
    answerProjectList(projectPage([]));
    const { result } = await renderProjects();
    await waitFor(() => expect(result.current.view.status).toBe("ready"));
    act(() => {
      result.current.announce("Something.");
    });
    act(() => {
      result.current.add(makeProject());
    });
    expect(ready(result).announcement).toBeUndefined();
  });
});
