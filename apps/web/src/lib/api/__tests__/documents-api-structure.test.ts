import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { answerSave, makeDocument, saved } from "../../../test-support/documents-handlers.ts";
import { server } from "../../../test-support/msw-server.ts";
import { problemResponse } from "../../../test-support/projects-handlers.ts";
import { setAccessToken } from "../../auth/token-store.ts";
import { documentsApi } from "../documents-api.ts";
import { ApiError } from "../problem.ts";

interface DeleteCall {
  readonly path: string;
  readonly headers: Headers;
}

function answerDelete(reply: () => Response | Promise<Response>): DeleteCall[] {
  const calls: DeleteCall[] = [];
  server.use(
    http.delete("/projects/:projectId/documents/:id", ({ request }) => {
      calls.push({ path: new URL(request.url).pathname, headers: request.headers });
      return reply();
    }),
  );
  return calls;
}

describe("documentsApi.remove", () => {
  it("deletes the document at its own address, with the access token and no version", async () => {
    setAccessToken("access-1");
    const calls = answerDelete(() => new HttpResponse(null, { status: 204 }));

    await expect(documentsApi.remove("project-1", "doc-1")).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/projects/project-1/documents/doc-1");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer access-1");
    // The API takes a delete whatever the version, so none is sent.
    expect(calls[0]?.headers.has("if-match")).toBe(false);
  });

  it("encodes both ids in the address", async () => {
    const calls = answerDelete(() => new HttpResponse(null, { status: 204 }));
    await documentsApi.remove("a/b", "c?d");
    expect(calls[0]?.path).toBe("/projects/a%2Fb/documents/c%3Fd");
  });

  it("throws an ApiError with status 404 when the document is already gone", async () => {
    answerDelete(() => problemResponse(404, "not-found"));
    const error = await documentsApi
      .remove("project-1", "doc-1")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
  });

  it("throws an ApiError with status 429 and the wait the server asked for", async () => {
    answerDelete(() => problemResponse(429, "too-many-requests", {}, { "Retry-After": "7" }));
    const error = await documentsApi
      .remove("project-1", "doc-1")
      .catch((caught: unknown) => caught);
    expect((error as ApiError).status).toBe(429);
    expect((error as ApiError).retryAfterSeconds).toBe(7);
  });

  it("stops when the caller cancels", async () => {
    answerDelete(() => new HttpResponse(null, { status: 204 }));
    const controller = new AbortController();
    controller.abort();
    await expect(
      documentsApi.remove("project-1", "doc-1", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("documentsApi.update with a new title or place", () => {
  it("sends only the title, with the version", async () => {
    const document = makeDocument({ version: 3 });
    const calls = answerSave(saved(document));

    const result = await documentsApi.update(
      "project-1",
      document.id,
      { title: "New name" },
      { ifMatch: 3 },
    );

    expect(calls[0]?.ifMatch).toBe('"3"');
    expect(calls[0]?.body).toEqual({ title: "New name" });
    expect(result.version).toBe(4);
    expect(result.title).toBe("New name");
  });

  it("sends a position alone", async () => {
    const document = makeDocument();
    const calls = answerSave(saved(document));
    await documentsApi.update("project-1", document.id, { position: 2 }, { ifMatch: 1 });
    expect(calls[0]?.body).toEqual({ position: 2 });
  });

  it("sends null for the top level, which is not the same as leaving the parent out", async () => {
    const document = makeDocument();
    const calls = answerSave(saved(document));
    await documentsApi.update("project-1", document.id, { parentId: null }, { ifMatch: 1 });
    expect(calls[0]?.body).toEqual({ parentId: null });
  });

  it("sends a new parent", async () => {
    const document = makeDocument();
    const calls = answerSave(saved(document));
    await documentsApi.update("project-1", document.id, { parentId: "act-1" }, { ifMatch: 1 });
    expect(calls[0]?.body).toEqual({ parentId: "act-1" });
  });
});
