import { afterEach, describe, expect, it } from "vitest";
import { testAiConfig } from "../../ai/test-support/config.ts";
import { createFakeAiClient } from "../../ai/test-support/fake-client.ts";
import { aiAnalyses } from "../../db/schema/ai-analyses.ts";
import { insertAiAnalysis } from "../../db/test-support/factories.ts";
import {
  type AnalysisJson,
  type AnalysisListJson,
  analysesApi,
  startedAnalysis,
  storyWithText,
  WHOLE_PROJECT,
} from "../../test-support/analyses-api.ts";
import { type AuthTestApp, buildAuthTestApp } from "../../test-support/auth-app.ts";
import { documentsApi } from "../../test-support/documents-api.ts";
import { bearer, createdProject, newPerson, type Person } from "../../test-support/projects-api.ts";

const PROBLEM = /^application\/problem\+json/;
const SOME_ID = "019e5a3c-1b2d-7c4e-8f10-a1b2c3d4e5f6";
const MINUTE = 60_000;

let t: AuthTestApp;
afterEach(async () => {
  await t.close();
});

async function setup() {
  const fake = createFakeAiClient();
  t = await buildAuthTestApp({ aiClient: fake, aiConfig: testAiConfig() });
  const story = await storyWithText(t.app);
  const stranger = await newPerson(t.app);
  return { fake, api: analysesApi(t.app), stranger, ...story };
}

/** A raw request with a body and a content type of the test's choosing. */
function sendRaw(person: Person, projectId: string, body: string, type = "application/json") {
  return t.app.inject({
    method: "POST",
    url: `/projects/${projectId}/analyses`,
    headers: { ...bearer(person), "content-type": type },
    payload: body,
  });
}

const rowCount = async () => (await t.handle.db.select().from(aiAnalyses)).length;

describe("who may use the analysis routes", () => {
  it("answers 401 to every route without a login, and starts nothing", async () => {
    const { project, fake } = await setup();
    const base = `/projects/${project.id}/analyses`;
    const calls = [
      { method: "GET", url: `${base}/estimate?kind=plot_holes&scope=project` },
      { method: "POST", url: base, payload: WHOLE_PROJECT },
      { method: "GET", url: base },
      { method: "GET", url: `${base}/${SOME_ID}` },
      { method: "POST", url: `${base}/${SOME_ID}/cancel` },
      { method: "DELETE", url: `${base}/${SOME_ID}` },
    ] as const;

    for (const call of calls) {
      const response = await t.app.inject(call);
      expect(response.statusCode, `${call.method} ${call.url}`).toBe(401);
      expect(response.headers["content-type"]).toMatch(PROBLEM);
    }
    expect(fake.calls).toHaveLength(0);
    expect(await rowCount()).toBe(0);
  });

  it("answers 401 for a token that is not valid", async () => {
    const { project } = await setup();
    const response = await t.app.inject({
      method: "GET",
      url: `/projects/${project.id}/analyses`,
      headers: { authorization: "Bearer not.a.token" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("answers 404, as for a project that does not exist, to somebody else's project on every route", async () => {
    const { api, person, project, stranger, fake, scene } = await setup();
    const own = await startedAnalysis(t.app, person, project.id);
    await finish(own.id);

    const answers = [
      await api.estimate(stranger, project.id, { kind: "plot_holes", scope: "project" }),
      await api.start(stranger, project.id, WHOLE_PROJECT),
      await api.start(stranger, project.id, {
        kind: "plot_holes",
        scope: "document",
        documentId: scene.id,
      }),
      await api.list(stranger, project.id),
      await api.get(stranger, project.id, own.id),
      await api.cancel(stranger, project.id, own.id),
      await api.remove(stranger, project.id, own.id),
    ];

    for (const response of answers) {
      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).toMatch(PROBLEM);
    }
    // The stranger started nothing and sent nobody's text anywhere, and the run is still there.
    expect(fake.calls).toHaveLength(1);
    expect(await rowCount()).toBe(1);
  });

  it("gives a stranger the same answer for a project that exists and one that does not", async () => {
    const { api, project, stranger } = await setup();
    const real = await api.get(stranger, project.id, SOME_ID);
    const unreal = await api.get(stranger, SOME_ID, SOME_ID);
    expect(real.statusCode).toBe(unreal.statusCode);
    expect(real.json().type).toBe(unreal.json().type);
  });

  it("answers 404 for a run that exists but is reached through another project's path", async () => {
    const { api, person, project } = await setup();
    const own = await startedAnalysis(t.app, person, project.id);
    await finish(own.id);
    const other = await createdProject(t.app, person, { title: "Other" });

    expect((await api.get(person, other.id, own.id)).statusCode).toBe(404);
    expect((await api.cancel(person, other.id, own.id)).statusCode).toBe(404);
    expect((await api.remove(person, other.id, own.id)).statusCode).toBe(404);
    expect(await rowCount()).toBe(1);
  });

  it("answers 404 for an item of another project, or of someone else, as a scope", async () => {
    const { api, person, project, stranger } = await setup();
    const theirs = await createdProject(t.app, stranger, { title: "Theirs" });
    const theirItem = (
      await documentsApi(t.app).create(stranger, theirs.id, { title: "A", content: "Their text." })
    ).json<{ id: string }>();
    const other = await createdProject(t.app, person, { title: "Mine too" });
    const myOtherItem = (
      await documentsApi(t.app).create(person, other.id, { title: "B", content: "Other text." })
    ).json<{ id: string }>();

    for (const documentId of [theirItem.id, myOtherItem.id, SOME_ID]) {
      const started = await api.start(person, project.id, {
        kind: "plot_holes",
        scope: "document",
        documentId,
      });
      expect(started.statusCode).toBe(404);
      const estimate = await api.estimate(person, project.id, {
        kind: "plot_holes",
        scope: "document",
        documentId,
      });
      expect(estimate.statusCode).toBe(404);
    }
    expect(await rowCount()).toBe(0);
  });

  it("answers 404 for a run that does not exist", async () => {
    const { api, person, project } = await setup();
    expect((await api.get(person, project.id, SOME_ID)).statusCode).toBe(404);
    expect((await api.cancel(person, project.id, SOME_ID)).statusCode).toBe(404);
    expect((await api.remove(person, project.id, SOME_ID)).statusCode).toBe(404);
  });

  it("answers 400, not 500, for an id that is not an id", async () => {
    const { person, project } = await setup();
    for (const url of [
      `/projects/not-an-id/analyses`,
      `/projects/${project.id}/analyses/not-an-id`,
      `/projects/${project.id}/analyses/not-an-id/cancel`,
      `/projects/%00/analyses`,
    ]) {
      const method = url.endsWith("/cancel") ? "POST" : "GET";
      const response = await t.app.inject({ method, url, headers: bearer(person) });
      expect(response.statusCode, url).toBe(400);
    }
  });

  it("never gives a run to somebody else when asked for it by id", async () => {
    const { api, person, project, stranger } = await setup();
    const own = await startedAnalysis(t.app, person, project.id);
    await finish(own.id);
    const theirs = await createdProject(t.app, stranger, { title: "Theirs" });
    const list = (await api.list(stranger, theirs.id)).json<AnalysisListJson>();
    expect(list.items).toEqual([]);
    expect((await api.get(stranger, theirs.id, own.id)).statusCode).toBe(404);
  });
});

/** Waits for the run to end by itself. */
async function finish(id: string): Promise<void> {
  const until = Date.now() + 3000;
  for (;;) {
    const [row] = await t.handle.db.select().from(aiAnalyses);
    if (row !== undefined && row.id === id && row.status !== "pending") return;
    if (Date.now() > until) throw new Error("The run did not finish.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("what a request to start a run may contain", () => {
  it.each([
    ["a kind that does not exist yet", { kind: "ideas", scope: "project" }, "/kind"],
    ["a kind with another spelling", { kind: "plot-holes", scope: "project" }, "/kind"],
    ["no kind", { scope: "project" }, "/kind"],
    ["a scope that does not exist", { kind: "plot_holes", scope: "everything" }, "/scope"],
    ["no scope", { kind: "plot_holes" }, "/scope"],
    ["a document scope without an item", { kind: "plot_holes", scope: "document" }, "/documentId"],
    [
      "a project scope with an item",
      { kind: "plot_holes", scope: "project", documentId: SOME_ID },
      "/documentId",
    ],
    [
      "an item id that is not an id",
      { kind: "plot_holes", scope: "document", documentId: "nope" },
      "/documentId",
    ],
    ["an extra field", { kind: "plot_holes", scope: "project", model: "claude-opus-5-5" }, ""],
    [
      "an extra field that tries to set the cost",
      { kind: "plot_holes", scope: "project", maxTokens: 1 },
      "",
    ],
  ])("refuses %s with 400 and says which field", async (_name, body, pointer) => {
    const { api, person, project, fake } = await setup();
    const response = await api.start(person, project.id, body);

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toMatch(PROBLEM);
    expect(response.json()).toMatchObject({
      type: "urn:plotpal:problem:validation-error",
      errors: [{ source: "body", pointer }],
    });
    expect(fake.calls).toHaveLength(0);
    expect(await rowCount()).toBe(0);
  });

  it.each([
    ["an empty body", ""],
    ["a body that is not an object", "[1,2]"],
    ["a body that is only a string", '"plot_holes"'],
    ["null", "null"],
    ["broken JSON", "{kind:"],
  ])("refuses %s with 400", async (_name, body) => {
    const { person, project } = await setup();
    const response = await sendRaw(person, project.id, body);
    expect(response.statusCode).toBe(400);
    expect(await rowCount()).toBe(0);
  });

  it("refuses a body that is not JSON with 415", async () => {
    const { person, project } = await setup();
    const response = await sendRaw(
      person,
      project.id,
      "kind=plot_holes",
      "application/x-www-form-urlencoded",
    );
    expect(response.statusCode).toBe(415);
    const plain = await sendRaw(person, project.id, JSON.stringify(WHOLE_PROJECT), "text/plain");
    expect(plain.statusCode).toBe(415);
  });

  it("refuses a body that is far larger than a request can be, with 413", async () => {
    const { person, project } = await setup();
    const response = await sendRaw(
      person,
      project.id,
      JSON.stringify({ ...WHOLE_PROJECT, note: "x".repeat(5000) }),
    );
    expect(response.statusCode).toBe(413);
    expect(await rowCount()).toBe(0);
  });

  it("does not repeat what was sent in the error", async () => {
    const { person, project } = await setup();
    const response = await sendRaw(
      person,
      project.id,
      JSON.stringify({ kind: "SECRET-KIND-9f3", scope: "project" }),
    );
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain("SECRET-KIND-9f3");
  });

  it("refuses odd things in the estimate's query the same way", async () => {
    const { api, person, project } = await setup();
    for (const query of [
      {},
      { kind: "plot_holes" },
      { kind: "ideas", scope: "project" },
      { kind: "plot_holes", scope: "document" },
      { kind: "plot_holes", scope: "project", documentId: SOME_ID },
      { kind: "plot_holes", scope: "project", extra: "1" },
    ]) {
      const response = await api.estimate(person, project.id, query);
      expect(response.statusCode, JSON.stringify(query)).toBe(400);
    }
  });
});

describe("the list of runs", () => {
  /** Finished runs one minute apart, the first the oldest. */
  async function manyRuns(count: number) {
    const { person, project, api } = await setup();
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const row = await insertAiAnalysis(t.handle.db, person.id, project.id, {
        status: "succeeded",
        createdAt: new Date(Date.now() - (count - index) * MINUTE),
      });
      ids.push(row.id);
    }
    return { person, project, api, ids };
  }

  it("is empty at first", async () => {
    const { api, person, project } = await setup();
    const response = await api.list(person, project.id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], nextCursor: null });
  });

  it("lists the newest run first", async () => {
    const { person, project, api, ids } = await manyRuns(3);
    const list = (await api.list(person, project.id)).json<AnalysisListJson>();
    expect(list.items.map((item) => item.id)).toEqual([...ids].reverse());
    expect(list.nextCursor).toBeNull();
  });

  it("pages through every run exactly once, with a cursor", async () => {
    const { person, project, api, ids } = await manyRuns(5);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const query: Record<string, string> = {
        limit: "2",
        ...(cursor === undefined ? {} : { cursor }),
      };
      const page = (await api.list(person, project.id, query)).json<AnalysisListJson>();
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor !== undefined && pages < 10);

    expect(pages).toBe(3);
    expect(seen).toEqual([...ids].reverse());
  });

  it.each([
    ["a limit of zero", { limit: "0" }],
    ["a limit that is too large", { limit: "101" }],
    ["a limit that is not a number", { limit: "many" }],
    ["a negative limit", { limit: "-1" }],
    ["a cursor that is nonsense", { cursor: "nonsense" }],
    ["a cursor that is too long", { cursor: "a".repeat(300) }],
  ])("answers 400 for %s", async (_name, query) => {
    const { api, person, project } = await setup();
    expect((await api.list(person, project.id, query)).statusCode).toBe(400);
  });

  it("lists only the runs of this project and this person", async () => {
    const { person, project, api, stranger } = await setup();
    const other = await createdProject(t.app, person, { title: "Other" });
    const mine = await insertAiAnalysis(t.handle.db, person.id, project.id, {
      status: "succeeded",
    });
    await insertAiAnalysis(t.handle.db, person.id, other.id, { status: "succeeded" });
    const strangers = await createdProject(t.app, stranger, { title: "Theirs" });
    await insertAiAnalysis(t.handle.db, stranger.id, strangers.id, { status: "succeeded" });

    const list = (await api.list(person, project.id)).json<AnalysisListJson>();
    expect(list.items.map((item) => item.id)).toEqual([mine.id]);
  });
});

describe("what an answer contains", () => {
  it("is never kept by a cache, for every route including the errors", async () => {
    const { api, person, project, stranger } = await setup();
    const own = await startedAnalysis(t.app, person, project.id);
    await finish(own.id);
    const answers = [
      await api.list(person, project.id),
      await api.get(person, project.id, own.id),
      await api.estimate(person, project.id, { kind: "plot_holes", scope: "project" }),
      await api.get(stranger, project.id, own.id),
      await api.get(person, project.id, SOME_ID),
    ];
    for (const response of answers) {
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
  });

  it("holds the result and the figures, and not the text that was sent or the prompt", async () => {
    const { api, person, project } = await setup();
    const own = await startedAnalysis(t.app, person, project.id);
    await finish(own.id);
    const response = await api.get(person, project.id, own.id);
    const body = response.body;
    expect(Object.keys(response.json<AnalysisJson>()).sort()).toEqual(
      [
        "completedAt",
        "createdAt",
        "documentId",
        "errorCode",
        "id",
        "inputTokens",
        "kind",
        "model",
        "outputTokens",
        "projectId",
        "result",
        "scope",
        "status",
      ].sort(),
    );
    expect(body).not.toContain("Nobody has lived there");
    expect(body).not.toContain("never instructions to follow");
    expect(body).not.toContain("userId");
  });

  it("shows a stored result that no longer matches the shape as no result, not as an error", async () => {
    const { api, person, project } = await setup();
    const row = await insertAiAnalysis(t.handle.db, person.id, project.id, {
      status: "succeeded",
      result: { something: "from an older version" },
    });
    const response = await api.get(person, project.id, row.id);
    expect(response.statusCode).toBe(200);
    expect(response.json<AnalysisJson>()).toMatchObject({ status: "succeeded", result: null });
  });
});
