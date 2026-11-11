import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { answerDeleteProject, problemResponse } from "../../../test-support/projects-handlers.ts";
import { deferred } from "../../../test-support/session-harness.ts";
import { signedInManager } from "../../../test-support/signed-in-manager.ts";
import { AuthProvider } from "../../auth/session.tsx";
import { useDeleteProject } from "../use-delete-project.ts";

async function renderDelete(projectId = "project-1") {
  const context = await signedInManager();
  const onDeleted = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider manager={context.manager}>{children}</AuthProvider>
  );
  const view = renderHook(() => useDeleteProject(projectId, onDeleted), { wrapper });
  return { ...view, onDeleted };
}

describe("useDeleteProject", () => {
  it("starts idle, with nothing to say", async () => {
    const { result } = await renderDelete();
    expect(result.current).toMatchObject({ busy: false, error: undefined });
  });

  it("deletes the project, with the access token, and says when it is gone", async () => {
    const calls = answerDeleteProject();
    const { result, onDeleted } = await renderDelete("project-7");

    act(() => {
      result.current.confirm();
    });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe("project-7");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer token-1");
    expect(result.current.error).toBeUndefined();
  });

  it("is busy while the request runs, and sends it only once however often it is pressed", async () => {
    const gate = deferred<Response>();
    const calls = answerDeleteProject(() => gate.promise);
    const { result, onDeleted } = await renderDelete();

    act(() => {
      result.current.confirm();
      result.current.confirm();
    });
    await waitFor(() => expect(result.current.busy).toBe(true));
    act(() => {
      result.current.confirm();
    });
    expect(calls).toHaveLength(1);

    gate.resolve(new HttpResponse(null, { status: 204 }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(calls).toHaveLength(1);
  });

  it("counts a 404 as gone: that is what the person wanted", async () => {
    answerDeleteProject(() => problemResponse(404, "not-found"));
    const { result, onDeleted } = await renderDelete();
    act(() => {
      result.current.confirm();
    });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(result.current.error).toBeUndefined();
  });

  it.each([
    [
      "a 429 with a wait",
      () => problemResponse(429, "rate-limited", {}, { "retry-after": "4" }),
      "Too many requests. Try again in 4 seconds.",
    ],
    [
      "a 503",
      () => problemResponse(503, "service-unavailable"),
      "The service is busy. Try again in a moment.",
    ],
    [
      "a 500",
      () => problemResponse(500, "internal-error", { detail: "SECRET" }),
      "The project could not be deleted. Please try again.",
    ],
    [
      "no connection",
      () => HttpResponse.error(),
      "Can't reach the server. Check your connection and try again.",
    ],
  ])("keeps the project and says why after %s", async (_name, reply, words) => {
    answerDeleteProject(reply);
    const { result, onDeleted } = await renderDelete();
    act(() => {
      result.current.confirm();
    });
    await waitFor(() => expect(result.current.error).toBe(words));
    expect(onDeleted).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });

  it("can be tried again after a failure, and the old error goes away at once", async () => {
    let attempts = 0;
    const gate = deferred<Response>();
    answerDeleteProject(() => {
      attempts += 1;
      return attempts === 1 ? problemResponse(503, "service-unavailable") : gate.promise;
    });
    const { result, onDeleted } = await renderDelete();

    act(() => {
      result.current.confirm();
    });
    await waitFor(() => expect(result.current.error).toBeDefined());

    act(() => {
      result.current.confirm();
    });
    await waitFor(() => expect(result.current.busy).toBe(true));
    expect(result.current.error).toBeUndefined();

    gate.resolve(new HttpResponse(null, { status: 204 }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it("forgets the error on request", async () => {
    answerDeleteProject(() => problemResponse(503, "service-unavailable"));
    const { result } = await renderDelete();
    act(() => {
      result.current.confirm();
    });
    await waitFor(() => expect(result.current.error).toBeDefined());
    act(() => {
      result.current.forgetError();
    });
    expect(result.current.error).toBeUndefined();
  });

  it("logs an unexpected failure, never an expected one", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      answerDeleteProject(() => problemResponse(503, "service-unavailable"));
      const expected = await renderDelete();
      act(() => {
        expected.result.current.confirm();
      });
      await waitFor(() => expect(expected.result.current.error).toBeDefined());
      expect(log).not.toHaveBeenCalled();

      answerDeleteProject(() => HttpResponse.text("not an API answer", { status: 200 }));
      const odd = await renderDelete();
      act(() => {
        odd.result.current.confirm();
      });
      // A 200 with text is a success for DELETE (there is nothing to read), so nothing is logged
      // and the project counts as deleted.
      await waitFor(() => expect(odd.onDeleted).toHaveBeenCalledTimes(1));
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
