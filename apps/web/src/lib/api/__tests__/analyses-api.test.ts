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
    expect((await analysesApi.get("p", run.id)).result?.findings[0]?.category).toBe(
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
