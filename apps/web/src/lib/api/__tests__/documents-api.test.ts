import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import {
  answerCreateDocument,
  answerDocument,
  answerOutline,
  answerSave,
  createdDocument,
  makeDocument,
  makeOutlineItem,
  saved,
} from "../../../test-support/documents-handlers.ts";
import { server } from "../../../test-support/msw-server.ts";
import { problemResponse } from "../../../test-support/projects-handlers.ts";
import { setAccessToken } from "../../auth/token-store.ts";
import { documentsApi } from "../documents-api.ts";
import { ApiError, ResponseShapeError } from "../problem.ts";

describe("documentsApi.outline", () => {
  it("gets the project's documents with the access token and returns the items in order", async () => {
    setAccessToken("access-1");
    const act = makeOutlineItem({ title: "Act 1" });
    const scene = makeOutlineItem({ title: "1a", parentId: act.id });
    const calls = answerOutline([act, scene]);

    expect(await documentsApi.outline("project-1")).toEqual([act, scene]);
    expect(calls[0]?.url.pathname).toBe("/projects/project-1/documents");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer access-1");
  });

  it("encodes the project id, so that nothing in it can change the address", async () => {
    const seen: string[] = [];
    server.use(
      http.get("*", ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return HttpResponse.json({ items: [] });
      }),
    );
    await documentsApi.outline("a/../b");
    expect(seen).toEqual(["/projects/a%2F..%2Fb/documents"]);
  });

  it("refuses an answer of the wrong shape, without repeating it", async () => {
    answerOutline(() => HttpResponse.json({ items: [{ id: "x", title: "SECRET" }] }));
    const failure = await documentsApi.outline("p").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ResponseShapeError);
    expect((failure as Error).message).not.toContain("SECRET");
  });

  it("throws an ApiError with status 404 for a project that is not the person's", async () => {
    answerOutline(() => problemResponse(404, "not-found"));
    const failure = await documentsApi.outline("p").catch((error: unknown) => error);
    expect((failure as ApiError).status).toBe(404);
  });

  it("stops when the caller cancels", async () => {
    answerOutline(() => new Promise<Response>(() => undefined));
    const controller = new AbortController();
    const pending = documentsApi.outline("p", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("documentsApi.get", () => {
  it("gets one document with its text and version", async () => {
    setAccessToken("access-1");
    const document = makeDocument({ content: "Hello.", version: 4, wordCount: 1 });
    const calls = answerDocument(document);

    expect(await documentsApi.get("project-1", document.id)).toEqual(document);
    expect(calls[0]?.projectId).toBe("project-1");
    expect(calls[0]?.id).toBe(document.id);
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer access-1");
  });

  it("keeps the text exactly as the API sent it", async () => {
    const text = "  INT. LIGHTHOUSE - NIGHT\r\n\t<b>Waves</b> 🎬 שלום  \n";
    answerDocument(makeDocument({ content: text }));
    expect((await documentsApi.get("p", "d")).content).toBe(text);
  });

  it("refuses a version that is not a positive whole number", async () => {
    answerDocument(() => HttpResponse.json({ ...makeDocument(), version: 0 }));
    await expect(documentsApi.get("p", "d")).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("throws an ApiError with status 404 for a document that is gone", async () => {
    answerDocument(() => problemResponse(404, "not-found"));
    const failure = await documentsApi.get("p", "d").catch((error: unknown) => error);
    expect((failure as ApiError).status).toBe(404);
  });
});

describe("documentsApi.update", () => {
  it("patches the document's own address with the text and the version it started from", async () => {
    setAccessToken("access-1");
    const document = makeDocument({ version: 3 });
    const calls = answerSave(saved(document));

    const result = await documentsApi.update(
      "project-1",
      document.id,
      { content: "New text." },
      { ifMatch: 3 },
    );

    expect(result).toMatchObject({ content: "New text.", version: 4, wordCount: 2 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.ifMatch).toBe('"3"');
    expect(calls[0]?.body).toEqual({ content: "New text." });
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer access-1");
    expect(calls[0]?.headers.get("content-type")).toBe("application/json");
  });

  it("sends the text exactly as it is: no trimming, line breaks kept", async () => {
    const document = makeDocument();
    const calls = answerSave(saved(document));
    const text = "  one\r\n\ttwo 🎬  \n";
    await documentsApi.update("p", document.id, { content: text }, { ifMatch: 1 });
    expect(calls[0]?.body).toEqual({ content: text });
  });

  it("throws an ApiError with status 412 when the document was changed meanwhile", async () => {
    answerSave(() => problemResponse(412, "precondition-failed"));
    const failure = await documentsApi
      .update("p", "d", { content: "x" }, { ifMatch: 1 })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(412);
  });

  it("throws an ApiError with the field message when the text is refused", async () => {
    answerSave(() =>
      problemResponse(400, "validation-error", {
        errors: [
          {
            source: "body",
            pointer: "/content",
            message: "The text contains an invalid character.",
          },
        ],
      }),
    );
    const failure = await documentsApi
      .update("p", "d", { content: "x" }, { ifMatch: 1 })
      .catch((error: unknown) => error);
    expect((failure as ApiError).issues).toEqual([
      { pointer: "/content", message: "The text contains an invalid character." },
    ]);
  });

  it("encodes both ids in the address", async () => {
    const seen: string[] = [];
    server.use(
      http.patch("*", ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return HttpResponse.json(makeDocument());
      }),
    );
    await documentsApi.update("a/b", "c?d", { content: "x" }, { ifMatch: 1 });
    expect(seen).toEqual(["/projects/a%2Fb/documents/c%3Fd"]);
  });

  it("stops when the caller cancels", async () => {
    answerSave(() => new Promise<Response>(() => undefined));
    const controller = new AbortController();
    const pending = documentsApi.update(
      "p",
      "d",
      { content: "x" },
      { ifMatch: 1, signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("documentsApi.create", () => {
  it("posts the title, and only the other details that were given", async () => {
    const calls = answerCreateDocument(createdDocument());
    await documentsApi.create("project-1", { title: "Act One" });
    expect(calls[0]?.projectId).toBe("project-1");
    expect(calls[0]?.body).toEqual({ title: "Act One" });
    expect(calls[0]?.body).not.toHaveProperty("parentId");
  });

  it("sends a parent, a position and a text when they are given", async () => {
    const calls = answerCreateDocument(createdDocument());
    await documentsApi.create("p", {
      title: "Scene",
      parentId: "act-1",
      position: 2,
      content: "Hi.",
    });
    expect(calls[0]?.body).toEqual({
      title: "Scene",
      parentId: "act-1",
      position: 2,
      content: "Hi.",
    });
  });

  it("sends null for the top level when it is asked for", async () => {
    const calls = answerCreateDocument(createdDocument());
    await documentsApi.create("p", { title: "Top", parentId: null });
    expect(calls[0]?.body).toEqual({ title: "Top", parentId: null });
  });

  it("returns the new document", async () => {
    answerCreateDocument(createdDocument({ title: "Saved title" }));
    expect(await documentsApi.create("p", { title: "x" })).toMatchObject({
      title: "Saved title",
      version: 1,
    });
  });

  it("throws an ApiError with status 409 when the outline is full", async () => {
    answerCreateDocument(() => problemResponse(409, "conflict"));
    const failure = await documentsApi.create("p", { title: "x" }).catch((error: unknown) => error);
    expect((failure as ApiError).status).toBe(409);
  });
});
