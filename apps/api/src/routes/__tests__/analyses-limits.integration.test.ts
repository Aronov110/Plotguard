import { afterEach, describe, expect, it } from "vitest";
import type { AiConfig } from "../../ai/limits.ts";
import { testAiConfig } from "../../ai/test-support/config.ts";
import { createFakeAiClient, type FakeBehavior } from "../../ai/test-support/fake-client.ts";
import { aiAnalyses } from "../../db/schema/ai-analyses.ts";
import { insertAiAnalysis } from "../../db/test-support/factories.ts";
import {
  ACT_TEXT,
  type AnalysisJson,
  analysesApi,
  type EstimateJson,
  finishedAnalysis,
  SCENE_TEXT,
  startedAnalysis,
  storyWithText,
  WHOLE_PROJECT,
} from "../../test-support/analyses-api.ts";
import { type AuthTestApp, buildAuthTestApp } from "../../test-support/auth-app.ts";
import { documentsApi } from "../../test-support/documents-api.ts";
import { createdProject, newPerson } from "../../test-support/projects-api.ts";

const PROBLEM = /^application\/problem\+json/;
const HOURS = 3_600_000;

let t: AuthTestApp;
afterEach(async () => {
  await t.close();
});

async function setup(
  options: {
    behaviors?: FakeBehavior[];
    config?: Partial<AiConfig>;
    withClient?: boolean;
    env?: Record<string, string>;
  } = {},
) {
  const fake = createFakeAiClient(...(options.behaviors ?? []));
  t = await buildAuthTestApp({
    ...(options.withClient === false ? {} : { aiClient: fake }),
    aiConfig: testAiConfig(options.config),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  const story = await storyWithText(t.app);
  return { fake, api: analysesApi(t.app), ...story };
}

/** A finished run in the past, for the daily limits to count. */
function earlier(
  personId: string,
  projectId: string,
  hoursAgo: number,
  overrides: Partial<typeof aiAnalyses.$inferInsert> = {},
) {
  return insertAiAnalysis(t.handle.db, personId, projectId, {
    status: "succeeded",
    createdAt: new Date(Date.now() - hoursAgo * HOURS),
    ...overrides,
  });
}

describe("one run at a time", () => {
  it("answers 409 while another run of the same person is still going", async () => {
    const { api, person, project, fake } = await setup({ behaviors: [{ kind: "hold" }] });
    const first = await startedAnalysis(t.app, person, project.id);

    const second = await api.start(person, project.id, WHOLE_PROJECT);

    expect(second.statusCode).toBe(409);
    expect(second.headers["content-type"]).toMatch(PROBLEM);
    expect(second.json()).toMatchObject({
      type: "urn:plotpal:problem:run-in-progress",
      status: 409,
    });
    expect((await api.get(person, project.id, first.id)).json<AnalysisJson>().status).toBe(
      "pending",
    );
    expect(fake.calls).toHaveLength(1);
    fake.release();
  });

  it("applies across the projects of one person", async () => {
    const { api, person, project, fake } = await setup({ behaviors: [{ kind: "hold" }] });
    const other = await createdProject(t.app, person, { title: "Other" });
    await documentsApi(t.app).create(person, other.id, { title: "Act", content: "Some text." });
    await startedAnalysis(t.app, person, project.id);

    expect((await api.start(person, other.id, WHOLE_PROJECT)).statusCode).toBe(409);
    fake.release();
  });

  it("lets exactly one of two requests started at the same moment through", async () => {
    const { api, person, project, fake } = await setup({
      behaviors: [{ kind: "hold" }, { kind: "hold" }],
    });
    const [one, two] = await Promise.all([
      api.start(person, project.id, WHOLE_PROJECT),
      api.start(person, project.id, WHOLE_PROJECT),
    ]);

    expect([one.statusCode, two.statusCode].sort()).toEqual([202, 409]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fake.calls).toHaveLength(1);
    fake.release();
  });

  it("does not hold up other people", async () => {
    const { api, person, project, fake } = await setup({ behaviors: [{ kind: "hold" }] });
    await startedAnalysis(t.app, person, project.id);
    const other = await newPerson(t.app);
    const otherProject = await createdProject(t.app, other, { title: "Theirs" });
    await documentsApi(t.app).create(other, otherProject.id, {
      title: "Act",
      content: "Their text.",
    });

    expect((await api.start(other, otherProject.id, WHOLE_PROJECT)).statusCode).toBe(202);
    fake.release();
  });

  it("lets the person start again once the run has finished", async () => {
    const { api, person, project } = await setup();
    const first = await startedAnalysis(t.app, person, project.id);
    await finishedAnalysis(t.app, person, project.id, first.id);
    expect((await api.start(person, project.id, WHOLE_PROJECT)).statusCode).toBe(202);
  });
});

describe("the daily allowance of one person", () => {
  it("allows the configured number of runs, then answers 429 with Retry-After", async () => {
    const { api, person, project } = await setup({ config: { userDailyRuns: 2 } });
    for (let run = 0; run < 2; run += 1) {
      const started = await startedAnalysis(t.app, person, project.id);
      await finishedAnalysis(t.app, person, project.id, started.id);
    }

    const third = await api.start(person, project.id, WHOLE_PROJECT);

    expect(third.statusCode).toBe(429);
    expect(third.headers["content-type"]).toMatch(PROBLEM);
    expect(third.json()).toMatchObject({ type: "urn:plotpal:problem:ai-daily-limit", status: 429 });
    expect(Number(third.headers["retry-after"])).toBeGreaterThanOrEqual(60);
  });

  it("counts failed and cancelled runs as runs", async () => {
    const { api, person, project } = await setup({
      config: { userDailyRuns: 2 },
      behaviors: [{ kind: "refused" }, { kind: "hold" }],
    });
    const failed = await startedAnalysis(t.app, person, project.id);
    await finishedAnalysis(t.app, person, project.id, failed.id);
    const cancelled = await startedAnalysis(t.app, person, project.id);
    await api.cancel(person, project.id, cancelled.id);

    expect((await api.start(person, project.id, WHOLE_PROJECT)).statusCode).toBe(429);
  });

  it("does not count runs older than a day", async () => {
    const { api, person, project } = await setup({ config: { userDailyRuns: 2 } });
    await earlier(person.id, project.id, 25);
    await earlier(person.id, project.id, 48);
    await earlier(person.id, project.id, 30 * 24);

    expect((await api.start(person, project.id, WHOLE_PROJECT)).statusCode).toBe(202);
  });

  it("counts runs from just inside the window", async () => {
    const { api, person, project } = await setup({ config: { userDailyRuns: 2 } });
    await earlier(person.id, project.id, 23);
    await earlier(person.id, project.id, 1);

    expect((await api.start(person, project.id, WHOLE_PROJECT)).statusCode).toBe(429);
  });

  it("says to come back when the oldest run leaves the window", async () => {
    const { api, person, project } = await setup({ config: { userDailyRuns: 1 } });
    await earlier(person.id, project.id, 23);

    const response = await api.start(person, project.id, WHOLE_PROJECT);

    expect(response.statusCode).toBe(429);
    const seconds = Number(response.headers["retry-after"]);
    // About an hour: the run is 23 hours old, and a run counts for 24.
    expect(seconds).toBeGreaterThan(3000);
    expect(seconds).toBeLessThanOrEqual(3700);
    expect(response.json()).toMatchObject({ retryAfterSeconds: seconds });
  });

  it("does not count the runs of other people", async () => {
    const { api, person, project } = await setup({ config: { userDailyRuns: 1 } });
    const other = await newPerson(t.app);
    const otherProject = await createdProject(t.app, other, { title: "Theirs" });
    await earlier(other.id, otherProject.id, 1);

    expect((await api.start(person, project.id, WHOLE_PROJECT)).statusCode).toBe(202);
  });

  it("stops at the token allowance, counting input and output of earlier runs", async () => {
    const { api, person, project } = await setup({ config: { userDailyTokens: 1000 } });
    await earlier(person.id, project.id, 1, { inputTokens: 600, outputTokens: 400 });

    const response = await api.start(person, project.id, WHOLE_PROJECT);

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ type: "urn:plotpal:problem:ai-daily-limit" });
  });

  it("allows a run when the tokens used are still below the allowance", async () => {
    const { api, person, project } = await setup({ config: { userDailyTokens: 1000 } });
    await earlier(person.id, project.id, 1, { inputTokens: 600, outputTokens: 399 });
    expect((await api.start(person, project.id, WHOLE_PROJECT)).statusCode).toBe(202);
  });
});

describe("the daily budget of everybody together", () => {
  it("answers 503 with Retry-After when the day's tokens are used up, whoever used them", async () => {
    const { api, person, project } = await setup({ config: { globalDailyTokens: 1000 } });
    const other = await newPerson(t.app);
    const otherProject = await createdProject(t.app, other, { title: "Theirs" });
    await earlier(other.id, otherProject.id, 2, { inputTokens: 800, outputTokens: 200 });

    const response = await api.start(person, project.id, WHOLE_PROJECT);

    expect(response.statusCode).toBe(503);
    expect(response.headers["content-type"]).toMatch(PROBLEM);
    expect(response.headers["retry-after"]).toBe("3600");
    expect(response.json()).toMatchObject({ type: "urn:plotpal:problem:ai-budget-reached" });
  });

  it("allows runs while it is not used up, and forgets tokens older than a day", async () => {
    const { api, person, project } = await setup({ config: { globalDailyTokens: 1000 } });
    const other = await newPerson(t.app);
    const otherProject = await createdProject(t.app, other, { title: "Theirs" });
    await earlier(other.id, otherProject.id, 30, { inputTokens: 5000, outputTokens: 5000 });
    await earlier(other.id, otherProject.id, 2, { inputTokens: 500, outputTokens: 499 });

    expect((await api.start(person, project.id, WHOLE_PROJECT)).statusCode).toBe(202);
  });
});

describe("how much text one run may send", () => {
  it("refuses a text that is longer than one run may send, with 413 and the numbers", async () => {
    const { api, person, project, fake } = await setup({ config: { maxInputTokens: 2000 } });
    await documentsApi(t.app).create(person, project.id, {
      title: "Long",
      content: "word ".repeat(4000),
    });

    const response = await api.start(person, project.id, WHOLE_PROJECT);

    expect(response.statusCode).toBe(413);
    expect(response.headers["content-type"]).toMatch(PROBLEM);
    const body = response.json<{
      type: string;
      limitTokens: number;
      estimatedTokens: number;
      detail: string;
    }>();
    expect(body.type).toBe("urn:plotpal:problem:manuscript-too-large");
    expect(body.limitTokens).toBe(2000);
    expect(body.estimatedTokens).toBeGreaterThan(2000);
    expect(body.detail).toContain("Choose a smaller part");
    // Nothing was started, and nothing was sent.
    expect(await t.handle.db.select().from(aiAnalyses)).toHaveLength(0);
    expect(fake.calls).toHaveLength(0);
  });

  it("allows a smaller part of the same project", async () => {
    const { api, person, project, scene } = await setup({ config: { maxInputTokens: 2000 } });
    await documentsApi(t.app).create(person, project.id, {
      title: "Long",
      content: "word ".repeat(4000),
    });

    const response = await api.start(person, project.id, {
      kind: "plot_holes",
      scope: "document",
      documentId: scene.id,
    });
    expect(response.statusCode).toBe(202);
  });

  it("measures the text without loading it all: a project of many items is refused at once", async () => {
    const { api, person, project, fake } = await setup({ config: { maxInputTokens: 5000 } });
    for (let index = 0; index < 30; index += 1) {
      await documentsApi(t.app).create(person, project.id, {
        title: `Scene ${index}`,
        content: "x".repeat(2000),
      });
    }
    const response = await api.start(person, project.id, WHOLE_PROJECT);
    expect(response.statusCode).toBe(413);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("when there is no text to read", () => {
  it("answers 422 for a project with no items", async () => {
    const { api, person } = await setup();
    const empty = await createdProject(t.app, person, { title: "Empty" });
    const response = await api.start(person, empty.id, WHOLE_PROJECT);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ type: "urn:plotpal:problem:manuscript-empty" });
  });

  it("answers 422 when every item is empty or only white space", async () => {
    const { api, person } = await setup();
    const blank = await createdProject(t.app, person, { title: "Blank" });
    await documentsApi(t.app).create(person, blank.id, { title: "One" });
    await documentsApi(t.app).create(person, blank.id, { title: "Two", content: "  \n\t \n " });
    expect((await api.start(person, blank.id, WHOLE_PROJECT)).statusCode).toBe(422);
  });

  it("answers 422 for an item without text, even in a project that has text elsewhere", async () => {
    const { api, person, project } = await setup();
    const empty = (await documentsApi(t.app).create(person, project.id, { title: "Empty" })).json<{
      id: string;
    }>();
    const response = await api.start(person, project.id, {
      kind: "plot_holes",
      scope: "document",
      documentId: empty.id,
    });
    expect(response.statusCode).toBe(422);
  });

  it("is happy with an empty act as long as a scene has text", async () => {
    const { api, person } = await setup();
    const project = await createdProject(t.app, person, { title: "Mixed" });
    const act = (await documentsApi(t.app).create(person, project.id, { title: "Act" })).json<{
      id: string;
    }>();
    await documentsApi(t.app).create(person, project.id, {
      title: "Scene",
      parentId: act.id,
      content: "Some text.",
    });
    expect((await api.start(person, project.id, WHOLE_PROJECT)).statusCode).toBe(202);
  });
});

describe("when the AI features are not switched on", () => {
  it("answers 503 to a start when there is no model call set up, and creates nothing", async () => {
    const { api, person, project } = await setup({ withClient: false });
    const response = await api.start(person, project.id, WHOLE_PROJECT);
    expect(response.statusCode).toBe(503);
    expect(response.headers["content-type"]).toMatch(PROBLEM);
    expect(response.json()).toMatchObject({ type: "urn:plotpal:problem:ai-unavailable" });
    expect(await t.handle.db.select().from(aiAnalyses)).toHaveLength(0);
  });

  it("answers 503 to a start when it is switched off on purpose, key or no key", async () => {
    const { api, person, project, fake } = await setup({ env: { AI_ENABLED: "false" } });
    const response = await api.start(person, project.id, WHOLE_PROJECT);
    expect(response.statusCode).toBe(503);
    expect(fake.calls).toHaveLength(0);
  });

  it("still answers the estimate, saying that runs are not available", async () => {
    const { api, person, project } = await setup({ withClient: false });
    const response = await api.estimate(person, project.id, {
      kind: "plot_holes",
      scope: "project",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<EstimateJson>().available).toBe(false);
  });

  it("still lists and deletes the runs that were made before", async () => {
    const { api, person, project } = await setup({ withClient: false });
    const old = await earlier(person.id, project.id, 1);
    expect((await api.list(person, project.id)).json<{ items: unknown[] }>().items).toHaveLength(1);
    expect((await api.remove(person, project.id, old.id)).statusCode).toBe(204);
  });
});

describe("the estimate", () => {
  it("gives the characters, a range of tokens and of dollars, and says it fits", async () => {
    const { api, person, project, fake } = await setup();

    const response = await api.estimate(person, project.id, {
      kind: "plot_holes",
      scope: "project",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const estimate = response.json<EstimateJson>();
    expect(estimate).toMatchObject({
      available: true,
      model: "claude-opus-5-5",
      characters: ACT_TEXT.length + SCENE_TEXT.length,
      fits: true,
      maxInputTokens: 200_000,
    });
    expect(estimate.inputTokens.low).toBeLessThan(estimate.inputTokens.high);
    expect(estimate.outputTokens.low).toBeLessThanOrEqual(estimate.outputTokens.high);
    expect(estimate.costUsd?.low).toBeGreaterThan(0);
    expect(estimate.costUsd?.low).toBeLessThan(estimate.costUsd?.high ?? 0);
    // It asks nothing of the AI service and starts nothing.
    expect(fake.calls).toHaveLength(0);
    expect(await t.handle.db.select().from(aiAnalyses)).toHaveLength(0);
  });

  it("counts only the item and its own items for a scope of document", async () => {
    const { api, person, project, act, scene } = await setup();
    const forAct = await api.estimate(person, project.id, {
      kind: "plot_holes",
      scope: "document",
      documentId: act.id,
    });
    const forScene = await api.estimate(person, project.id, {
      kind: "plot_holes",
      scope: "document",
      documentId: scene.id,
    });
    expect(forAct.json<EstimateJson>().characters).toBe(ACT_TEXT.length + SCENE_TEXT.length);
    expect(forScene.json<EstimateJson>().characters).toBe(SCENE_TEXT.length);
  });

  it("says when the text is too long for one run", async () => {
    const { api, person, project } = await setup({ config: { maxInputTokens: 2000 } });
    await documentsApi(t.app).create(person, project.id, {
      title: "Long",
      content: "word ".repeat(4000),
    });
    const estimate = (
      await api.estimate(person, project.id, { kind: "plot_holes", scope: "project" })
    ).json<EstimateJson>();
    expect(estimate.fits).toBe(false);
  });

  it("says what is left of the day's allowance, and it shrinks as runs are made", async () => {
    const { api, person, project } = await setup({
      config: { userDailyRuns: 5, userDailyTokens: 10_000 },
    });
    const query = { kind: "plot_holes", scope: "project" };
    expect((await api.estimate(person, project.id, query)).json<EstimateJson>().remaining).toEqual({
      runs: 5,
      tokens: 10_000,
    });

    const started = await startedAnalysis(t.app, person, project.id);
    await finishedAnalysis(t.app, person, project.id, started.id);

    // The fake used 1,200 tokens in and 350 out.
    expect((await api.estimate(person, project.id, query)).json<EstimateJson>().remaining).toEqual({
      runs: 4,
      tokens: 10_000 - 1550,
    });
  });

  it("never goes below zero", async () => {
    const { api, person, project } = await setup({
      config: { userDailyRuns: 1, userDailyTokens: 1000 },
    });
    await earlier(person.id, project.id, 1, { inputTokens: 5000, outputTokens: 5000 });
    await earlier(person.id, project.id, 2);
    const estimate = (
      await api.estimate(person, project.id, { kind: "plot_holes", scope: "project" })
    ).json<EstimateJson>();
    expect(estimate.remaining).toEqual({ runs: 0, tokens: 0 });
  });

  it("is for the configured model's price: half as much on the cheaper model", async () => {
    const opus = await setup();
    const forOpus = (
      await opus.api.estimate(opus.person, opus.project.id, {
        kind: "plot_holes",
        scope: "project",
      })
    ).json<EstimateJson>();
    await t.close();
    const sonnet = await setup({ config: { model: "claude-sonnet-5-5" } });
    const forSonnet = (
      await sonnet.api.estimate(sonnet.person, sonnet.project.id, {
        kind: "plot_holes",
        scope: "project",
      })
    ).json<EstimateJson>();
    expect(forSonnet.costUsd?.low).toBeCloseTo((forOpus.costUsd?.low ?? 0) / 2, 6);
  });

  it("gives no dollars for a model with no known price", async () => {
    const { api, person, project } = await setup({ config: { model: "claude-unknown-9" } });
    const estimate = (
      await api.estimate(person, project.id, { kind: "plot_holes", scope: "project" })
    ).json<EstimateJson>();
    expect(estimate.costUsd).toBeNull();
    expect(estimate.inputTokens.high).toBeGreaterThan(0);
  });

  it("is zero characters for a project without text, and still answers", async () => {
    const { api, person } = await setup();
    const empty = await createdProject(t.app, person, { title: "Empty" });
    const estimate = (
      await api.estimate(person, empty.id, { kind: "plot_holes", scope: "project" })
    ).json<EstimateJson>();
    expect(estimate.characters).toBe(0);
  });
});

describe("the limit on how often runs can be started and cancelled", () => {
  it("answers 429 with Retry-After past the limit, and leaves reading alone", async () => {
    const { api, person, project } = await setup({
      config: { writes: { max: 3, windowSeconds: 60 } },
      behaviors: [{ kind: "hold" }, { kind: "hold" }],
    });
    const first = await startedAnalysis(t.app, person, project.id); // 1
    await api.cancel(person, project.id, first.id); // 2
    const second = await startedAnalysis(t.app, person, project.id); // 3
    const refused = await api.cancel(person, project.id, second.id); // 4

    expect(refused.statusCode).toBe(429);
    expect(refused.headers["content-type"]).toMatch(PROBLEM);
    expect(Number(refused.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    // Reading is not counted.
    for (let read = 0; read < 10; read += 1) {
      expect((await api.get(person, project.id, second.id)).statusCode).toBe(200);
      expect((await api.list(person, project.id)).statusCode).toBe(200);
    }
  });

  it("is a counter of its own: changing documents does not use it up", async () => {
    const { api, person, project } = await setup({
      config: { writes: { max: 2, windowSeconds: 60 } },
    });
    for (let change = 0; change < 5; change += 1) {
      await documentsApi(t.app).create(person, project.id, {
        title: `Item ${change}`,
        content: "x",
      });
    }
    expect((await api.start(person, project.id, WHOLE_PROJECT)).statusCode).toBe(202);
  });
});
