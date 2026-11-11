import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  answerDocument,
  answerSave,
  makeDocument,
  saved,
} from "../../../test-support/documents-handlers.ts";
import { server } from "../../../test-support/msw-server.ts";
import { problemResponse } from "../../../test-support/projects-handlers.ts";
import { deferred, session } from "../../../test-support/session-harness.ts";
import { signedInManager } from "../../../test-support/signed-in-manager.ts";
import { AuthProvider } from "../../auth/session.tsx";
import { type DocumentEditorLoad, useDocumentEditor } from "../use-document-editor.ts";

async function renderEditor(documentId = "doc-1", options: { renewedToken?: string } = {}) {
  const context = await signedInManager();
  if (options.renewedToken !== undefined) {
    context.api.refresh.mockResolvedValue(session(options.renewedToken));
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider manager={context.manager}>{children}</AuthProvider>
  );
  return {
    ...renderHook(({ id }) => useDocumentEditor("project-1", id), {
      wrapper,
      initialProps: { id: documentId },
    }),
    context,
  };
}

function ready(result: { readonly current: { readonly load: DocumentEditorLoad } }) {
  const load = result.current.load;
  if (load.status !== "ready") throw new Error(`Expected ready, got ${load.status}.`);
  return load;
}

describe("useDocumentEditor: loading", () => {
  it("is loading first, then has the document and its autosave", async () => {
    const document = makeDocument({ content: "Hello there.", version: 3, wordCount: 2 });
    answerDocument(document);
    const { result } = await renderEditor(document.id);

    expect(result.current.load).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.load.status).toBe("ready"));
    const load = ready(result);
    expect(load.document).toEqual(document);
    expect(load.saver.getSnapshot()).toMatchObject({
      status: { kind: "saved" },
      version: 3,
      wordCount: 2,
    });
  });

  it("asks for the right document, with the access token", async () => {
    const calls = answerDocument(makeDocument());
    const { result } = await renderEditor("doc-7");
    await waitFor(() => expect(result.current.load.status).toBe("ready"));
    expect(calls[0]?.projectId).toBe("project-1");
    expect(calls[0]?.id).toBe("doc-7");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer token-1");
  });

  it("says that the document is not there after a 404", async () => {
    answerDocument(() => problemResponse(404, "not-found"));
    const { result } = await renderEditor();
    await waitFor(() => expect(result.current.load.status).toBe("failed"));
    expect(result.current.load).toEqual({
      status: "failed",
      message: "This document does not exist any more.",
    });
  });

  it("says that the server cannot be reached, and loads again on retry", async () => {
    const document = makeDocument({ content: "After retry" });
    answerDocument(() => HttpResponse.error(), document);
    const { result } = await renderEditor();
    await waitFor(() => expect(result.current.load.status).toBe("failed"));
    expect(result.current.load).toMatchObject({
      message: "Can't reach the server. Check your connection and try again.",
    });

    act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.load.status).toBe("ready"));
    expect(ready(result).document.content).toBe("After retry");
  });

  it("logs an unexpected failure, never an expected one", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      answerDocument(() => problemResponse(404, "not-found"));
      const expected = await renderEditor();
      await waitFor(() => expect(expected.result.current.load.status).toBe("failed"));
      expect(log).not.toHaveBeenCalled();

      answerDocument(() => HttpResponse.json({ nonsense: true }));
      const unexpected = await renderEditor();
      await waitFor(() => expect(unexpected.result.current.load.status).toBe("failed"));
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it("cancels its request when the screen is left, and makes no autosave", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      let signal: AbortSignal | undefined;
      server.use(
        http.get("/projects/:projectId/documents/:id", ({ request }) => {
          signal = request.signal;
          return new Promise<Response>(() => undefined);
        }),
      );
      const { unmount } = await renderEditor();
      await waitFor(() => expect(signal).toBeDefined());
      unmount();
      await waitFor(() => expect(signal?.aborted).toBe(true));
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("renews an expired token once when loading", async () => {
    const document = makeDocument();
    const calls = answerDocument(() => problemResponse(401, "unauthorized"), document);
    const { result } = await renderEditor(document.id, { renewedToken: "token-2" });
    await waitFor(() => expect(result.current.load.status).toBe("ready"));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers.get("authorization")).toBe("Bearer token-2");
  });
});

describe("useDocumentEditor: saving", () => {
  it("saves the text with the version it was read at, and the next save on top of the new one", async () => {
    const document = makeDocument({ content: "start", version: 4 });
    answerDocument(document);
    const calls = answerSave(saved(document));
    const { result } = await renderEditor(document.id);
    await waitFor(() => expect(result.current.load.status).toBe("ready"));
    const { saver } = ready(result);

    saver.change("start, more");
    await saver.flush();
    saver.change("start, more, still more");
    await saver.flush();

    expect(calls.map((call) => call.ifMatch)).toEqual(['"4"', '"5"']);
    expect(calls.map((call) => call.body)).toEqual([
      { content: "start, more" },
      { content: "start, more, still more" },
    ]);
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer token-1");
    expect(saver.getSnapshot()).toMatchObject({
      status: { kind: "saved" },
      version: 6,
      wordCount: 4,
    });
  });

  it("renews an expired token once when saving, and saves with the new one", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document);
    let attempts = 0;
    const calls = answerSave((call) => {
      attempts += 1;
      return attempts === 1 ? problemResponse(401, "unauthorized") : saved(document)(call);
    });
    const { result } = await renderEditor(document.id, { renewedToken: "token-2" });
    await waitFor(() => expect(result.current.load.status).toBe("ready"));
    const { saver } = ready(result);

    saver.change("changed");
    await saver.flush();

    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers.get("authorization")).toBe("Bearer token-2");
    expect(saver.getSnapshot().status.kind).toBe("saved");
  });

  it("says conflict when somebody saved first, and keeps the text unsaved", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document);
    answerSave(() => problemResponse(412, "precondition-failed"));
    const { result } = await renderEditor(document.id);
    await waitFor(() => expect(result.current.load.status).toBe("ready"));
    const { saver } = ready(result);

    saver.change("mine");
    await saver.flush();
    expect(saver.getSnapshot().status.kind).toBe("conflict");
    expect(saver.hasUnsaved()).toBe(true);
  });

  it("saves the writer's text over the server's: it reads the newer version first", async () => {
    const first = makeDocument({ content: "start", version: 1 });
    const newer = { ...first, content: "their text", version: 8 };
    const reads = answerDocument(first, newer);
    let attempts = 0;
    const saves = answerSave((call) => {
      attempts += 1;
      return attempts === 1 ? problemResponse(412, "precondition-failed") : saved(newer)(call);
    });
    const { result } = await renderEditor(first.id);
    await waitFor(() => expect(result.current.load.status).toBe("ready"));
    const { saver } = ready(result);

    saver.change("mine");
    await saver.flush();
    await saver.overwrite();

    expect(reads).toHaveLength(2);
    expect(saves.map((call) => call.ifMatch)).toEqual(['"1"', '"8"']);
    expect(saves[1]?.body).toEqual({ content: "mine" });
    expect(saver.getSnapshot()).toMatchObject({ status: { kind: "saved" }, version: 9 });
  });

  it("reads the document again for 'load the newer text'", async () => {
    const first = makeDocument({ content: "start", version: 1 });
    const newer = { ...first, content: "their text", version: 8, wordCount: 2 };
    answerDocument(first, newer);
    const { result } = await renderEditor(first.id);
    await waitFor(() => expect(result.current.load.status).toBe("ready"));

    const again = await result.current.readAgain();
    expect(again).toEqual(newer);
  });
});

describe("useDocumentEditor: leaving", () => {
  it("saves what is pending when the screen is left, and does not cancel that save", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document);
    const gate = deferred<Response>();
    const calls = answerSave(() => gate.promise);
    const { result, unmount } = await renderEditor(document.id);
    await waitFor(() => expect(result.current.load.status).toBe("ready"));

    ready(result).saver.change("typed just before leaving");
    unmount();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({ content: "typed just before leaving" });
    expect(calls[0]?.ifMatch).toBe('"1"');

    // The save is still running after the screen is gone; it finishes on its own.
    gate.resolve(
      HttpResponse.json({ ...document, content: "typed just before leaving", version: 2 }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it("saves the first document before the second one is shown when the writer switches", async () => {
    const first = makeDocument({ content: "first" });
    const second = makeDocument({ content: "second" });
    answerDocument(() => HttpResponse.json(first));
    server.use(
      http.get("/projects/:projectId/documents/:id", ({ params }) =>
        HttpResponse.json(params.id === second.id ? second : first),
      ),
    );
    const calls = answerSave(saved(first));
    const { result, rerender } = await renderEditor(first.id);
    await waitFor(() => expect(result.current.load.status).toBe("ready"));

    ready(result).saver.change("first, edited");
    rerender({ id: second.id });

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.id).toBe(first.id);
    expect(calls[0]?.body).toEqual({ content: "first, edited" });
    await waitFor(() => expect(result.current.load.status).toBe("ready"));
    expect(ready(result).document.id).toBe(second.id);
    expect(ready(result).document.content).toBe("second");
  });

  it("waits for the writer's own pending save before reading a document that was just left", async () => {
    const document = makeDocument({ content: "start", version: 1 });
    const other = makeDocument({ content: "other" });
    const gate = deferred<Response>();
    const reads: string[] = [];
    server.use(
      http.get("/projects/:projectId/documents/:id", ({ params }) => {
        reads.push(String(params.id));
        return HttpResponse.json(params.id === other.id ? other : document);
      }),
    );
    answerSave(() => gate.promise);
    const { result, rerender } = await renderEditor(document.id);
    await waitFor(() => expect(result.current.load.status).toBe("ready"));
    reads.length = 0;

    ready(result).saver.change("start, edited");
    rerender({ id: other.id });
    await waitFor(() => expect(reads).toContain(other.id));
    rerender({ id: document.id }); // back to the first document while its save is still running

    // The new read of the first document must wait, or it would return the older text.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(reads.filter((id) => id === document.id)).toHaveLength(0);

    gate.resolve(HttpResponse.json({ ...document, content: "start, edited", version: 2 }));
    await waitFor(() => expect(reads.filter((id) => id === document.id)).toHaveLength(1));
  });

  it("makes no save when nothing was typed", async () => {
    const document = makeDocument();
    answerDocument(document);
    const calls = answerSave(saved(document));
    const { result, unmount } = await renderEditor(document.id);
    await waitFor(() => expect(result.current.load.status).toBe("ready"));
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toHaveLength(0);
  });
});
