import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import {
  answerCancel,
  answerEstimate,
  answerRemove,
  answerRun,
  answerRunList,
  answerStart,
  makeAnalysis,
  makeEstimate,
  makeFinding,
  makeIdea,
  makeIdeasAnalysis,
  makeIdeasSucceeded,
  makeSucceeded,
  page,
} from "../../../test-support/analyses-handlers.ts";
import { server } from "../../../test-support/msw-server.ts";
import { problemResponse } from "../../../test-support/projects-handlers.ts";
import { setAccessToken } from "../../auth/token-store.ts";
import { analysesApi } from "../analyses-api.ts";
import { ApiError, ResponseShapeError } from "../problem.ts";

const WHOLE = { scope: "project" } as const;
const ITEM = { scope: "document", documentId: "0190b000-0000-7000-8000-000000000009" } as const;

describe("analysesApi.estimate", () => {
  it("asks for the whole project with the access token and returns the estimate", async () => {
    setAccessToken("access-1");
    const estimate = makeEstimate();
    const calls = answerEstimate(estimate);

    expect(await analysesApi.estimate("project-1", WHOLE)).toEqual(estimate);
    expect(calls[0]?.url.pathname).toBe("/projects/project-1/analyses/estimate");
    expect(Object.fromEntries(calls[0]?.url.searchParams ?? [])).toEqual({
      kind: "plot_holes",
      scope: "project",
    });
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer access-1");
  });

  it("names the item when asked about one item", async () => {
    const calls = answerEstimate(makeEstimate());
    await analysesApi.estimate("project-1", ITEM);
    expect(Object.fromEntries(calls[0]?.url.searchParams ?? [])).toEqual({
      kind: "plot_holes",
      scope: "document",
      documentId: ITEM.documentId,
    });
  });

  it("asks about ideas when told to", async () => {
    const calls = answerEstimate(makeEstimate());
    await analysesApi.estimate("project-1", ITEM, { kind: "ideas" });
    expect(Object.fromEntries(calls[0]?.url.searchParams ?? [])).toEqual({
      kind: "ideas",
      scope: "document",
      documentId: ITEM.documentId,
    });
  });

  it("accepts an estimate without a price", async () => {
    answerEstimate(makeEstimate({ costUsd: null }));
    expect((await analysesApi.estimate("p", WHOLE)).costUsd).toBeNull();
  });

  it("encodes the project id, so that nothing in it can change the address", async () => {
    const seen: string[] = [];
    server.use(
      http.get("*", ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return HttpResponse.json(makeEstimate());
      }),
    );
    await analysesApi.estimate("a/../b", WHOLE);
    expect(seen).toEqual(["/projects/a%2F..%2Fb/analyses/estimate"]);
  });

  it("refuses an answer of the wrong shape, without repeating it", async () => {
    answerEstimate(() => HttpResponse.json({ available: "SECRET" }));
    const failure = await analysesApi.estimate("p", WHOLE).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ResponseShapeError);
    expect((failure as Error).message).not.toContain("SECRET");
  });

  it("throws an ApiError with status 404 for a project that is not the person's", async () => {
    answerEstimate(() => problemResponse(404, "not-found"));
    const failure = await analysesApi.estimate("p", WHOLE).catch((error: unknown) => error);
    expect((failure as ApiError).status).toBe(404);
  });
});

describe("analysesApi.start", () => {
  it("posts the kind and scope for the whole project, and returns the pending run", async () => {
    setAccessToken("access-1");
    const run = makeAnalysis();
    const calls = answerStart(run);

    expect(await analysesApi.start("project-1", WHOLE)).toEqual(run);
    expect(calls[0]?.url.pathname).toBe("/projects/project-1/analyses");
    expect(calls[0]?.body).toEqual({ kind: "plot_holes", scope: "project" });
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer access-1");
    expect(calls[0]?.headers.get("content-type")).toContain("application/json");
  });

  it("posts the item for a run on one item", async () => {
    const calls = answerStart(makeAnalysis({ scope: "document", documentId: ITEM.documentId }));
    await analysesApi.start("project-1", ITEM);
    expect(calls[0]?.body).toEqual({
      kind: "plot_holes",
      scope: "document",
      documentId: ITEM.documentId,
    });
  });

  it("posts the kind ideas, with no focus key when there is none", async () => {
    const calls = answerStart(makeIdeasAnalysis());
    const run = await analysesApi.start("project-1", WHOLE, { kind: "ideas" });
    expect(run.kind).toBe("ideas");
    expect(calls[0]?.body).toEqual({ kind: "ideas", scope: "project" });
  });

  it("posts the focus for ideas on one item", async () => {
    const calls = answerStart(makeIdeasAnalysis({ focus: "a stronger ending" }));
    await analysesApi.start("project-1", ITEM, { kind: "ideas", focus: "a stronger ending" });
    expect(calls[0]?.body).toEqual({
      kind: "ideas",
      scope: "document",
      documentId: ITEM.documentId,
      focus: "a stronger ending",
    });
  });

  it("leaves a blank focus out instead of sending it empty", async () => {
    const calls = answerStart(makeIdeasAnalysis());
    await analysesApi.start("project-1", WHOLE, { kind: "ideas", focus: "" });
    expect(calls[0]?.body).toEqual({ kind: "ideas", scope: "project" });
  });

  it("sends the focus as data, so that nothing in it changes the request", async () => {
    const calls = answerStart(makeIdeasAnalysis());
    const odd = 'quote " and \\ and \n and {"kind":"plot_holes"}';
    await analysesApi.start("p", WHOLE, { kind: "ideas", focus: odd });
    expect(calls[0]?.body).toEqual({ kind: "ideas", scope: "project", focus: odd });
  });

  it("never sends a focus with a plot-hole scan, even when one is passed in by mistake", async () => {
    const calls = answerStart(makeAnalysis());
    // The type forbids this; a caller that gets round the type must still not send it.
    const options = { kind: "plot_holes", focus: "x" } as unknown as { kind: "plot_holes" };
    await analysesApi.start("p", WHOLE, options);
    expect(calls[0]?.body).toEqual({ kind: "plot_holes", scope: "project" });
  });

  it("passes on the server's refusal of a focus that is too long (400)", async () => {
    answerStart(() => problemResponse(400, "validation-error"));
    const failure = await analysesApi
      .start("p", WHOLE, { kind: "ideas", focus: "x" })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 400 });
  });

  it.each([
    [409, "run-in-progress"],
    [413, "manuscript-too-large"],
    [422, "manuscript-empty"],
    [429, "ai-daily-limit"],
    [503, "ai-unavailable"],
    [503, "ai-budget-reached"],
  ])("throws an ApiError with status %i and the code %s", async (status, code) => {
    answerStart(() => problemResponse(status, code));
    const failure = await analysesApi.start("p", WHOLE).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status, code });
  });

  it("passes on how long to wait when the allowance is used", async () => {
    answerStart(() => problemResponse(429, "ai-daily-limit", {}, { "retry-after": "1800" }));
    const failure = await analysesApi.start("p", WHOLE).catch((error: unknown) => error);
    expect((failure as ApiError).retryAfterSeconds).toBe(1800);
  });

  it("refuses a run with a status that does not exist", async () => {
    answerStart(() => HttpResponse.json({ ...makeAnalysis(), status: "done" }, { status: 202 }));
    await expect(analysesApi.start("p", WHOLE)).rejects.toBeInstanceOf(ResponseShapeError);
  });
});

describe("analysesApi.get", () => {
  it("reads one run, with its findings", async () => {
    setAccessToken("access-1");
    const run = makeSucceeded([makeFinding({ title: "Elena is alive again" })]);
    const calls = answerRun(run);

    expect(await analysesApi.get("project-1", run.id)).toEqual(run);
    expect(calls[0]?.url.pathname).toBe(`/projects/project-1/analyses/${run.id}`);
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer access-1");
  });

  it("encodes the run id", async () => {
    const seen: string[] = [];
    server.use(
      http.get("*", ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return HttpResponse.json(makeAnalysis());
      }),
    );
    await analysesApi.get("p", "a/../b");
    expect(seen).toEqual(["/projects/p/analyses/a%2F..%2Fb"]);
  });

  it("accepts a kind of problem it has no wording for", async () => {
    const run = makeSucceeded([makeFinding({ category: "a_new_category" })]);
    answerRun(run);
    const got = await analysesApi.get("p", run.id);
    expect(got.kind === "plot_holes" ? got.result?.findings[0]?.category : undefined).toBe(
      "a_new_category",
    );
  });

  it("accepts a failed run with a code it has no wording for", async () => {
    answerRun(makeAnalysis({ status: "failed", errorCode: "something_new" }));
    expect((await analysesApi.get("p", "x")).errorCode).toBe("something_new");
  });

  it("refuses a finding whose quote has no verified flag", async () => {
    const run = makeSucceeded([makeFinding()]);
    const broken = structuredClone(run) as unknown as {
      result: { findings: { evidence: Record<string, unknown>[] }[] };
    };
    delete broken.result.findings[0]?.evidence[0]?.verified;
    answerRun(() => HttpResponse.json(broken));
    await expect(analysesApi.get("p", run.id)).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("throws an ApiError with status 404 for a run that is not there", async () => {
    answerRun(() => problemResponse(404, "not-found"));
    const failure = await analysesApi.get("p", "x").catch((error: unknown) => error);
    expect((failure as ApiError).status).toBe(404);
  });

  it("stops when the caller cancels", async () => {
    answerRun(() => new Promise<Response>(() => undefined));
    const controller = new AbortController();
    const pending = analysesApi.get("p", "x", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("analysesApi, a run of ideas", () => {
  it("reads a finished idea run with its ideas, focus and where each goes", async () => {
    const run = makeIdeasSucceeded(
      [makeIdea({ title: "The stranger returns", kind: "plot_twist", goesIn: null })],
      { focus: "who the stranger was" },
    );
    answerRun(run);
    const got = await analysesApi.get("p", run.id);
    expect(got).toEqual(run);
    expect(got.focus).toBe("who the stranger was");
    expect(got.kind === "ideas" ? got.result?.ideas[0]?.goesIn : "x").toBeNull();
  });

  it("accepts an idea kind it has no wording for", async () => {
    const run = makeIdeasSucceeded([makeIdea({ kind: "a_new_kind" })]);
    answerRun(run);
    const got = await analysesApi.get("p", run.id);
    expect(got.kind === "ideas" ? got.result?.ideas[0]?.kind : undefined).toBe("a_new_kind");
  });

  it("reads a page with both kinds of run", async () => {
    const mixed = [makeAnalysis(), makeIdeasAnalysis(), makeIdeasSucceeded([makeIdea()])];
    answerRunList(page(mixed));
    const got = await analysesApi.list("p");
    expect(got.items.map((item) => item.kind)).toEqual(["plot_holes", "ideas", "ideas"]);
  });

  it("refuses a plot-hole result under the kind ideas", async () => {
    const wrong = { ...makeSucceeded([makeFinding()]), kind: "ideas" };
    answerRun(() => HttpResponse.json(wrong));
    await expect(analysesApi.get("p", "x")).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("refuses an ideas result under the kind plot_holes", async () => {
    const wrong = { ...makeIdeasSucceeded([makeIdea()]), kind: "plot_holes" };
    answerRun(() => HttpResponse.json(wrong));
    await expect(analysesApi.get("p", "x")).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("refuses a kind it does not know", async () => {
    answerRun(() => HttpResponse.json({ ...makeAnalysis(), kind: "summary" }));
    await expect(analysesApi.get("p", "x")).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("refuses a run that has no focus key at all", async () => {
    const { focus: _focus, ...without } = makeIdeasAnalysis();
    answerRun(() => HttpResponse.json(without));
    await expect(analysesApi.get("p", "x")).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("refuses an idea without a goesIn", async () => {
    const run = makeIdeasSucceeded([makeIdea()]);
    const broken = structuredClone(run) as unknown as {
      result: { ideas: Record<string, unknown>[] };
    };
    delete broken.result.ideas[0]?.goesIn;
    answerRun(() => HttpResponse.json(broken));
    await expect(analysesApi.get("p", "x")).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("refuses an idea whose quote has no verified flag", async () => {
    const run = makeIdeasSucceeded([makeIdea()]);
    const broken = structuredClone(run) as unknown as {
      result: { ideas: { evidence: Record<string, unknown>[] }[] };
    };
    delete broken.result.ideas[0]?.evidence[0]?.verified;
    answerRun(() => HttpResponse.json(broken));
    await expect(analysesApi.get("p", "x")).rejects.toBeInstanceOf(ResponseShapeError);
  });
});

describe("analysesApi.list", () => {
  it("reads the first page without a query", async () => {
    const run = makeAnalysis();
    const calls = answerRunList(page([run], "cursor-2"));

    expect(await analysesApi.list("project-1")).toEqual({ items: [run], nextCursor: "cursor-2" });
    expect(calls[0]?.url.pathname).toBe("/projects/project-1/analyses");
    expect(calls[0]?.url.search).toBe("");
  });

  it("sends the cursor and the limit", async () => {
    const calls = answerRunList(page([]));
    await analysesApi.list("project-1", { cursor: "a b&c", limit: 5 });
    expect(Object.fromEntries(calls[0]?.url.searchParams ?? [])).toEqual({
      limit: "5",
      cursor: "a b&c",
    });
  });

  it("refuses a page whose run has the wrong shape", async () => {
    answerRunList(() => HttpResponse.json({ items: [{ id: "x" }], nextCursor: null }));
    await expect(analysesApi.list("p")).rejects.toBeInstanceOf(ResponseShapeError);
  });
});

describe("analysesApi.cancel", () => {
  it("posts to the cancel address with no body and returns the run", async () => {
    setAccessToken("access-1");
    const run = makeAnalysis({ status: "failed", errorCode: "canceled" });
    const calls = answerCancel(run);

    expect(await analysesApi.cancel("project-1", run.id)).toEqual(run);
    expect(calls[0]?.url.pathname).toBe(`/projects/project-1/analyses/${run.id}/cancel`);
    expect(calls[0]?.body).toBeUndefined();
    expect(calls[0]?.headers.get("content-type")).toBeNull();
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer access-1");
  });
});

describe("analysesApi.remove", () => {
  it("sends a DELETE and resolves with nothing", async () => {
    const calls = answerRemove();
    await expect(analysesApi.remove("project-1", "run-1")).resolves.toBeUndefined();
    expect(calls[0]?.url.pathname).toBe("/projects/project-1/analyses/run-1");
  });

  it("throws an ApiError with status 404 for a run that was already deleted", async () => {
    answerRemove(() => problemResponse(404, "not-found"));
    const failure = await analysesApi.remove("p", "x").catch((error: unknown) => error);
    expect((failure as ApiError).status).toBe(404);
  });
});
