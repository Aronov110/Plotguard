import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../../test-support/msw-server.ts";
import { makeProject, problemResponse } from "../../../test-support/projects-handlers.ts";
import { signedInManager } from "../../../test-support/signed-in-manager.ts";
import { AuthProvider } from "../../auth/session.tsx";
import { useProject } from "../use-project.ts";

async function renderProject(projectId = "project-1") {
  const context = await signedInManager();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider manager={context.manager}>{children}</AuthProvider>
  );
  return renderHook(({ id }) => useProject(id), { wrapper, initialProps: { id: projectId } });
}

describe("useProject", () => {
  it("is loading first, then has the project", async () => {
    const project = makeProject({ title: "Lighthouse" });
    server.use(http.get("/projects/:id", () => HttpResponse.json(project)));
    const { result } = await renderProject(project.id);

    expect(result.current.load).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.load.status).toBe("ready"));
    expect(result.current.load).toEqual({ status: "ready", project });
  });

  it("asks for the right project, with the access token", async () => {
    const seen: { path: string; auth: string | null }[] = [];
    server.use(
      http.get("/projects/:id", ({ request }) => {
        seen.push({
          path: new URL(request.url).pathname,
          auth: request.headers.get("authorization"),
        });
        return HttpResponse.json(makeProject());
      }),
    );
    const { result } = await renderProject("project-9");
    await waitFor(() => expect(result.current.load.status).toBe("ready"));
    expect(seen).toEqual([{ path: "/projects/project-9", auth: "Bearer token-1" }]);
  });

  it("says that the project is not there after a 404, and that trying again cannot help", async () => {
    server.use(http.get("/projects/:id", () => problemResponse(404, "not-found")));
    const { result } = await renderProject();
    await waitFor(() => expect(result.current.load.status).toBe("failed"));
    expect(result.current.load).toEqual({
      status: "failed",
      message: "This project does not exist, or it is not yours.",
      notFound: true,
    });
  });

  it("says that the server cannot be reached, and that trying again can help", async () => {
    server.use(http.get("/projects/:id", () => HttpResponse.error()));
    const { result } = await renderProject();
    await waitFor(() => expect(result.current.load.status).toBe("failed"));
    expect(result.current.load).toMatchObject({
      message: "Can't reach the server. Check your connection and try again.",
      notFound: false,
    });
  });

  it("loads again on retry", async () => {
    let calls = 0;
    const project = makeProject({ title: "After retry" });
    server.use(
      http.get("/projects/:id", () => {
        calls += 1;
        return calls === 1
          ? problemResponse(503, "service-unavailable")
          : HttpResponse.json(project);
      }),
    );
    const { result } = await renderProject();
    await waitFor(() => expect(result.current.load.status).toBe("failed"));
    act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.load.status).toBe("ready"));
    expect(calls).toBe(2);
  });

  it("loads the other project when the project changes", async () => {
    server.use(
      http.get("/projects/:id", ({ params }) =>
        HttpResponse.json(makeProject({ title: `Project ${String(params.id)}` })),
      ),
    );
    const { result, rerender } = await renderProject("a");
    await waitFor(() => expect(result.current.load.status).toBe("ready"));
    rerender({ id: "b" });
    await waitFor(() =>
      expect(result.current.load).toMatchObject({ project: { title: "Project b" } }),
    );
  });

  it("logs an unexpected failure, never an expected one", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      server.use(http.get("/projects/:id", () => problemResponse(404, "not-found")));
      const expected = await renderProject();
      await waitFor(() => expect(expected.result.current.load.status).toBe("failed"));
      expect(log).not.toHaveBeenCalled();

      server.use(http.get("/projects/:id", () => HttpResponse.json({ nonsense: true })));
      const unexpected = await renderProject();
      await waitFor(() => expect(unexpected.result.current.load.status).toBe("failed"));
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it("cancels its request when the screen is left, without an error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      let signal: AbortSignal | undefined;
      server.use(
        http.get("/projects/:id", ({ request }) => {
          signal = request.signal;
          return new Promise<Response>(() => undefined);
        }),
      );
      const { unmount } = await renderProject();
      await waitFor(() => expect(signal).toBeDefined());
      unmount();
      await waitFor(() => expect(signal?.aborted).toBe(true));
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
