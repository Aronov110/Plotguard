import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { AiProviderError } from "../../ai/client.ts";
import type { AiConfig } from "../../ai/limits.ts";
import { createAiService } from "../../ai/service.ts";
import { testAiConfig } from "../../ai/test-support/config.ts";
import {
  createFakeAiClient,
  FAKE_USAGE,
  type FakeBehavior,
} from "../../ai/test-support/fake-client.ts";
import { buildApp } from "../../app.ts";
import { aiAnalyses } from "../../db/schema/ai-analyses.ts";
import { documents } from "../../db/schema/documents.ts";
import { insertAiAnalysis } from "../../db/test-support/factories.ts";
import { connectTestDatabase } from "../../db/test-support/test-database.ts";
import {
  ACT_TEXT,
  type AnalysisJson,
  analysesApi,
  finishedAnalysis,
  SCENE_TEXT,
  startedAnalysis,
  storyWithText,
  WHOLE_PROJECT,
} from "../../test-support/analyses-api.ts";
import { type AuthTestApp, buildAuthTestApp } from "../../test-support/auth-app.ts";
import { documentsApi } from "../../test-support/documents-api.ts";
import { testEnv } from "../../test-support/test-app.ts";

const TEST_KEY = "sk-ant-api03-test-key-0123456789abcdefghijkl";

let t: AuthTestApp;
afterEach(async () => {
  await t.close();
});

async function setup(options: { behaviors?: FakeBehavior[]; config?: Partial<AiConfig> } = {}) {
  const fake = createFakeAiClient(...(options.behaviors ?? []));
  t = await buildAuthTestApp({
    aiClient: fake,
    aiConfig: testAiConfig(options.config),
    env: { ANTHROPIC_API_KEY: TEST_KEY },
  });
  const story = await storyWithText(t.app);
  return { fake, api: analysesApi(t.app), ...story };
}

const rowOf = async (id: string) =>
  (await t.handle.db.select().from(aiAnalyses).where(eq(aiAnalyses.id, id)))[0];

describe("a run from start to finish", () => {
  it("answers 202 with the run pending, and no result yet", async () => {
    const { api, person, project, fake } = await setup({ behaviors: [{ kind: "hold" }] });

    const response = await api.start(person, project.id, WHOLE_PROJECT);

    expect(response.statusCode).toBe(202);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json<AnalysisJson>()).toMatchObject({
      projectId: project.id,
      documentId: null,
      kind: "plot_holes",
      scope: "project",
      status: "pending",
      model: "claude-opus-5-5",
      inputTokens: 0,
      outputTokens: 0,
      result: null,
      errorCode: null,
      completedAt: null,
    });
    expect(response.json<AnalysisJson>().id).toMatch(/^[0-9a-f-]{36}$/);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.holding).toBe(1);
    fake.release();
  });

  it("ends as succeeded, with the tokens the model used and a result that has been checked", async () => {
    const { api, person, project, act } = await setup();

    const started = await startedAnalysis(t.app, person, project.id);
    const finished = await finishedAnalysis(t.app, person, project.id, started.id);

    expect(finished).toMatchObject({
      id: started.id,
      status: "succeeded",
      errorCode: null,
      inputTokens: FAKE_USAGE.inputTokens,
      outputTokens: FAKE_USAGE.outputTokens,
    });
    expect(finished.completedAt).not.toBeNull();
    expect(finished.result?.read).toEqual({
      items: 2,
      characters: ACT_TEXT.length + SCENE_TEXT.length,
    });
    expect(finished.result?.findings).toHaveLength(1);
    // The fake quotes the start of the first item, so the quote is in the act's text.
    expect(finished.result?.findings[0]?.evidence[0]).toMatchObject({
      documentId: act.id,
      verified: true,
    });
    expect((await api.get(person, project.id, started.id)).json<AnalysisJson>()).toEqual(finished);
  });

  it("counts the cached part of the text too, so the daily allowance cannot be dodged", async () => {
    const { person, project } = await setup({
      behaviors: [{ kind: "ok", usage: { cacheReadTokens: 5000, cacheWriteTokens: 300 } }],
    });
    const started = await startedAnalysis(t.app, person, project.id);
    const finished = await finishedAnalysis(t.app, person, project.id, started.id);
    expect(finished.inputTokens).toBe(FAKE_USAGE.inputTokens + 5000 + 300);
  });

  describe("what is sent to the model", () => {
    it("is every item in reading order, each behind a header with its id and title", async () => {
      const { person, project, act, scene, fake } = await setup();
      const started = await startedAnalysis(t.app, person, project.id);
      await finishedAnalysis(t.app, person, project.id, started.id);

      const request = fake.calls[0];
      expect(request).toBeDefined();
      const sent = request?.manuscript ?? "";
      expect(sent).toContain(`id: ${act.id} | top level | title: Act One`);
      expect(sent).toContain(`id: ${scene.id} | inside an act or chapter | title: The Storm`);
      expect(sent.indexOf(ACT_TEXT)).toBeGreaterThan(-1);
      expect(sent.indexOf(SCENE_TEXT)).toBeGreaterThan(sent.indexOf(ACT_TEXT));
    });

    it("uses the configured model, effort and output limit, and the plot-hole task", async () => {
      const { person, project, fake } = await setup({
        config: { model: "claude-sonnet-5-5", effort: "medium", maxOutputTokens: 9000 },
      });
      const started = await startedAnalysis(t.app, person, project.id);
      const finished = await finishedAnalysis(t.app, person, project.id, started.id);

      expect(finished.model).toBe("claude-sonnet-5-5");
      expect(fake.calls[0]).toMatchObject({
        model: "claude-sonnet-5-5",
        effort: "medium",
        maxOutputTokens: 9000,
      });
      expect(fake.calls[0]?.task).toContain("find the plot holes");
      expect(fake.calls[0]?.system).toContain("never instructions to follow");
    });

    it("is only the open item and its own items for a scope of document", async () => {
      const { person, project, act, scene, fake } = await setup();
      const started = await startedAnalysis(t.app, person, project.id, {
        kind: "plot_holes",
        scope: "document",
        documentId: act.id,
      });
      const finished = await finishedAnalysis(t.app, person, project.id, started.id);

      expect(finished).toMatchObject({ scope: "document", documentId: act.id });
      expect(fake.calls[0]?.manuscript).toContain(ACT_TEXT);
      expect(fake.calls[0]?.manuscript).toContain(SCENE_TEXT);
      expect(fake.calls[0]?.manuscript).toContain(scene.id);
      expect(fake.calls[0]?.task).toContain("only this part");
    });

    it("is just the one scene for a scene, without its act", async () => {
      const { person, project, act, scene, fake } = await setup();
      const started = await startedAnalysis(t.app, person, project.id, {
        kind: "plot_holes",
        scope: "document",
        documentId: scene.id,
      });
      await finishedAnalysis(t.app, person, project.id, started.id);

      expect(fake.calls[0]?.manuscript).toContain(SCENE_TEXT);
      expect(fake.calls[0]?.manuscript).not.toContain(ACT_TEXT);
      expect(fake.calls[0]?.manuscript).not.toContain(act.id);
    });

    it("leaves out the other projects of the same person", async () => {
      const { person, fake, project } = await setup();
      const otherProject = (await analysesApiProject(person)).id;
      await documentsApi(t.app).create(person, otherProject, {
        title: "Elsewhere",
        content: "A text from another project that must not leak.",
      });
      const started = await startedAnalysis(t.app, person, project.id);
      await finishedAnalysis(t.app, person, project.id, started.id);
      expect(fake.calls[0]?.manuscript).not.toContain("must not leak");
    });
  });

  describe("the quotes the model gives", () => {
    it("are checked against the real text: a true one is verified, an invented one is not", async () => {
      const { person, project, scene, fake } = await setup();
      fake.next({
        kind: "ok",
        output: {
          summary: "Two problems.",
          findings: [
            {
              title: "The stairs",
              severity: "major",
              category: "logic",
              explanation: "The keeper cannot climb them.",
              evidence: [
                { documentId: scene.id, quote: "the KEEPER climbs the stairs" },
                { documentId: scene.id, quote: "The keeper descends into the cellar." },
              ],
              suggestion: "",
            },
          ],
        },
      });
      const started = await startedAnalysis(t.app, person, project.id);
      const finished = await finishedAnalysis(t.app, person, project.id, started.id);

      expect(finished.result?.findings[0]?.evidence).toEqual([
        { documentId: scene.id, quote: "the KEEPER climbs the stairs", verified: true },
        { documentId: scene.id, quote: "The keeper descends into the cellar.", verified: false },
      ]);
    });

    it("are not verified when the model names an item that is not in the text, and the id is dropped", async () => {
      const { person, project } = await setup({
        behaviors: [
          {
            kind: "ok",
            output: {
              summary: "One problem.",
              findings: [
                {
                  title: "Unknown place",
                  severity: "minor",
                  category: "other",
                  explanation: "x",
                  evidence: [
                    { documentId: "00000000-0000-0000-0000-000000000000", quote: SCENE_TEXT },
                  ],
                  suggestion: "",
                },
              ],
            },
          },
        ],
      });
      const started = await startedAnalysis(t.app, person, project.id);
      const finished = await finishedAnalysis(t.app, person, project.id, started.id);
      expect(finished.result?.findings[0]?.evidence[0]).toEqual({
        documentId: null,
        quote: SCENE_TEXT,
        verified: false,
      });
    });

    it("are not verified when they are real text from a different item than the one named", async () => {
      const { person, project, act, fake } = await setup();
      fake.next({
        kind: "ok",
        output: {
          summary: "One.",
          findings: [
            {
              title: "Mixed up",
              severity: "minor",
              category: "other",
              explanation: "x",
              // This is the scene's text, but the act is named.
              evidence: [{ documentId: act.id, quote: "Waves crash on the rocks" }],
              suggestion: "",
            },
          ],
        },
      });
      const started = await startedAnalysis(t.app, person, project.id);
      const finished = await finishedAnalysis(t.app, person, project.id, started.id);
      expect(finished.result?.findings[0]?.evidence[0]).toMatchObject({
        documentId: act.id,
        verified: false,
      });
    });

    it("may be an empty list: a story with no holes gets a summary and nothing else", async () => {
      const { person, project } = await setup({
        behaviors: [{ kind: "ok", output: { summary: "Solid.", findings: [] } }],
      });
      const started = await startedAnalysis(t.app, person, project.id);
      const finished = await finishedAnalysis(t.app, person, project.id, started.id);
      expect(finished).toMatchObject({ status: "succeeded" });
      expect(finished.result).toMatchObject({ summary: "Solid.", findings: [] });
    });
  });
});

/** Another project of the same person, made through the API. */
async function analysesApiProject(person: Awaited<ReturnType<typeof setup>>["person"]) {
  const { createdProject } = await import("../../test-support/projects-api.ts");
  return createdProject(t.app, person, { title: "Another project" });
}

describe("a run that does not succeed", () => {
  it.each<[string, FakeBehavior, string]>([
    ["the safety systems declined", { kind: "refused", category: "general_harms" }, "refused"],
    ["the answer was cut off", { kind: "truncated" }, "truncated"],
    ["the answer was not JSON", { kind: "unparseable" }, "invalid_output"],
    ["the answer was an empty object", { kind: "ok", output: {} }, "invalid_output"],
    ["the answer was null", { kind: "ok", output: null }, "invalid_output"],
    [
      "a finding was missing its evidence",
      {
        kind: "ok",
        output: {
          summary: "x",
          findings: [
            {
              title: "t",
              severity: "major",
              category: "logic",
              explanation: "e",
              evidence: [],
              suggestion: "",
            },
          ],
        },
      },
      "invalid_output",
    ],
    [
      "a finding had a severity that does not exist",
      {
        kind: "ok",
        output: {
          summary: "x",
          findings: [
            {
              title: "t",
              severity: "catastrophic",
              category: "logic",
              explanation: "e",
              evidence: [{ documentId: "a", quote: "q" }],
              suggestion: "",
            },
          ],
        },
      },
      "invalid_output",
    ],
    [
      "the AI service had too many requests",
      { kind: "error", error: new AiProviderError("rate_limited") },
      "rate_limited",
    ],
    [
      "the AI service was overloaded",
      { kind: "error", error: new AiProviderError("overloaded") },
      "overloaded",
    ],
    [
      "the AI service could not be reached",
      { kind: "error", error: new AiProviderError("unavailable") },
      "overloaded",
    ],
    ["the call took too long", { kind: "error", error: new AiProviderError("timeout") }, "timeout"],
    [
      "the text was too long for the model",
      { kind: "error", error: new AiProviderError("too_long") },
      "too_long",
    ],
    [
      "the server's key was refused",
      { kind: "error", error: new AiProviderError("not_configured") },
      "not_configured",
    ],
    ["something nobody expected happened", { kind: "error", error: new Error("boom") }, "internal"],
  ])("ends as failed when %s, with the code %s", async (_name, behavior, code) => {
    const { person, project } = await setup({ behaviors: [behavior] });
    const started = await startedAnalysis(t.app, person, project.id);
    const finished = await finishedAnalysis(t.app, person, project.id, started.id);

    expect(finished).toMatchObject({ status: "failed", errorCode: code, result: null });
    expect(finished.completedAt).not.toBeNull();
  });

  it("records the tokens when the model got as far as answering", async () => {
    const { person, project } = await setup({ behaviors: [{ kind: "refused" }] });
    const started = await startedAnalysis(t.app, person, project.id);
    const finished = await finishedAnalysis(t.app, person, project.id, started.id);
    expect(finished).toMatchObject({
      inputTokens: FAKE_USAGE.inputTokens,
      outputTokens: FAKE_USAGE.outputTokens,
    });
  });

  it("records no tokens when the call itself failed", async () => {
    const { person, project } = await setup({
      behaviors: [{ kind: "error", error: new AiProviderError("overloaded") }],
    });
    const started = await startedAnalysis(t.app, person, project.id);
    const finished = await finishedAnalysis(t.app, person, project.id, started.id);
    expect(finished).toMatchObject({ inputTokens: 0, outputTokens: 0 });
  });

  it("frees the person to start another run", async () => {
    const { person, project, api } = await setup({ behaviors: [{ kind: "truncated" }] });
    const first = await startedAnalysis(t.app, person, project.id);
    await finishedAnalysis(t.app, person, project.id, first.id);
    expect((await api.start(person, project.id, WHOLE_PROJECT)).statusCode).toBe(202);
  });

  it("gives up on a run that takes too long, and says so", async () => {
    const { person, project, fake } = await setup({
      behaviors: [{ kind: "hold" }],
      config: { requestTimeoutMs: 150 },
    });
    const started = await startedAnalysis(t.app, person, project.id);
    const finished = await finishedAnalysis(t.app, person, project.id, started.id);

    expect(finished).toMatchObject({ status: "failed", errorCode: "timeout" });
    // The call was told to stop, not left running.
    expect(fake.holding).toBe(0);
  });

  describe("what is logged", () => {
    it("never holds the text, the result or the key, not even when a run fails unexpectedly", async () => {
      const secretText = "A private line about the keeper that nobody else may read.";
      const { person, project, fake } = await setup({
        behaviors: [
          { kind: "error", error: new Error(`The call failed on: ${secretText} (${TEST_KEY})`) },
        ],
      });
      await documentsApi(t.app).create(person, project.id, {
        title: "Secret scene",
        content: secretText,
      });
      const started = await startedAnalysis(t.app, person, project.id);
      await finishedAnalysis(t.app, person, project.id, started.id);

      expect(fake.calls).toHaveLength(1);
      const logged = t.logs.text;
      expect(logged).not.toContain(secretText);
      expect(logged).not.toContain(TEST_KEY);
      expect(logged).not.toContain(ACT_TEXT);
      expect(logged).toContain("An AI run failed unexpectedly");
    });

    it("holds nothing of a successful run either", async () => {
      const { person, project } = await setup();
      const started = await startedAnalysis(t.app, person, project.id);
      await finishedAnalysis(t.app, person, project.id, started.id);
      expect(t.logs.text).not.toContain(SCENE_TEXT);
      expect(t.logs.text).not.toContain("The first scene does not match the second");
      expect(t.logs.text).not.toContain(TEST_KEY);
    });
  });
});

describe("shutting the server down", () => {
  it("stops a run in progress and writes it down as interrupted, without waiting for the model", async () => {
    const { person, project, fake } = await setup({ behaviors: [{ kind: "hold" }] });
    const started = await startedAnalysis(t.app, person, project.id);
    await vi_waitFor(() => fake.holding === 1);

    const before = Date.now();
    await t.app.close();
    const took = Date.now() - before;
    // The close also ends the database pool, so the test must not close the app again.
    t = { ...t, close: () => Promise.resolve() };

    expect(took).toBeLessThan(3000);
    const check = connectTestDatabase();
    try {
      const [row] = await check.db.select().from(aiAnalyses).where(eq(aiAnalyses.id, started.id));
      expect(row).toMatchObject({
        status: "failed",
        errorCode: "interrupted",
        completedAt: expect.any(Date),
      });
    } finally {
      await check.close();
    }
  });
});

describe("cancelling a run", () => {
  it("stops the call, and ends the run as failed with the code canceled", async () => {
    const { api, person, project, fake } = await setup({ behaviors: [{ kind: "hold" }] });
    const started = await startedAnalysis(t.app, person, project.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.holding).toBe(1);

    const response = await api.cancel(person, project.id, started.id);

    expect(response.statusCode).toBe(200);
    expect(response.json<AnalysisJson>()).toMatchObject({
      status: "failed",
      errorCode: "canceled",
      completedAt: expect.any(String),
    });
    // The held call was aborted: nothing is left waiting.
    await vi_waitFor(() => fake.holding === 0);
  });

  it("is not undone when the model answers late", async () => {
    const { api, person, project, fake } = await setup({
      // A call that cannot be stopped: it answers after it was cancelled.
      behaviors: [{ kind: "hold", ignoreAbort: true, afterwards: { kind: "ok" } }],
    });
    const started = await startedAnalysis(t.app, person, project.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await api.cancel(person, project.id, started.id);

    fake.release();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const after = (await api.get(person, project.id, started.id)).json<AnalysisJson>();
    expect(after).toMatchObject({ status: "failed", errorCode: "canceled", result: null });
  });

  it("gives back a run that has already finished, as it is", async () => {
    const { api, person, project } = await setup();
    const started = await startedAnalysis(t.app, person, project.id);
    const finished = await finishedAnalysis(t.app, person, project.id, started.id);

    const response = await api.cancel(person, project.id, started.id);

    expect(response.statusCode).toBe(200);
    expect(response.json<AnalysisJson>()).toEqual(finished);
  });

  it("can be asked twice", async () => {
    const { api, person, project } = await setup({ behaviors: [{ kind: "hold" }] });
    const started = await startedAnalysis(t.app, person, project.id);
    const one = await api.cancel(person, project.id, started.id);
    const two = await api.cancel(person, project.id, started.id);
    expect(one.json<AnalysisJson>().errorCode).toBe("canceled");
    expect(two.json<AnalysisJson>().errorCode).toBe("canceled");
  });

  it("frees the person to start another run at once", async () => {
    const { api, person, project } = await setup({ behaviors: [{ kind: "hold" }] });
    const started = await startedAnalysis(t.app, person, project.id);
    await api.cancel(person, project.id, started.id);
    expect((await api.start(person, project.id, WHOLE_PROJECT)).statusCode).toBe(202);
  });
});

describe("deleting a run", () => {
  it("deletes a finished run, answers 204 with no body, and 404 the second time", async () => {
    const { api, person, project } = await setup();
    const started = await startedAnalysis(t.app, person, project.id);
    await finishedAnalysis(t.app, person, project.id, started.id);

    const first = await api.remove(person, project.id, started.id);
    expect(first.statusCode).toBe(204);
    expect(first.body).toBe("");
    expect(await rowOf(started.id)).toBeUndefined();
    expect((await api.get(person, project.id, started.id)).statusCode).toBe(404);
    expect((await api.remove(person, project.id, started.id)).statusCode).toBe(404);
  });

  it("stops a run that is still going before it deletes it", async () => {
    const { api, person, project, fake } = await setup({ behaviors: [{ kind: "hold" }] });
    const started = await startedAnalysis(t.app, person, project.id);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect((await api.remove(person, project.id, started.id)).statusCode).toBe(204);

    await vi_waitFor(() => fake.holding === 0);
    expect(await rowOf(started.id)).toBeUndefined();
    // And the slot is free again.
    expect((await api.start(person, project.id, WHOLE_PROJECT)).statusCode).toBe(202);
  });
});

/** Waits (briefly) for something that happens in the background. */
async function vi_waitFor(condition: () => boolean): Promise<void> {
  const until = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > until) throw new Error("The condition did not come true in time.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("a run and the text it was about", () => {
  it("is kept when the item it looked at is deleted, no longer pointing at it", async () => {
    const { api, person, project, act } = await setup();
    const started = await startedAnalysis(t.app, person, project.id, {
      kind: "plot_holes",
      scope: "document",
      documentId: act.id,
    });
    await finishedAnalysis(t.app, person, project.id, started.id);

    await documentsApi(t.app).remove(person, project.id, act.id);

    const view = (await api.get(person, project.id, started.id)).json<AnalysisJson>();
    expect(view).toMatchObject({ status: "succeeded", scope: "document", documentId: null });
    expect(await t.handle.db.select().from(documents)).toHaveLength(0);
  });
});

describe("runs left pending by a restart", () => {
  it("are failed as interrupted when the server starts, and nothing else is touched", async () => {
    const { person, project } = await setup();
    const pending = await insertAiAnalysis(t.handle.db, person.id, project.id);
    const done = await insertAiAnalysis(t.handle.db, person.id, project.id, {
      status: "succeeded",
    });
    const failed = await insertAiAnalysis(t.handle.db, person.id, project.id, {
      status: "failed",
      errorCode: "refused",
    });

    // A new process starts on the same database, as after a restart.
    const restarted = buildApp(testEnv(), {
      database: connectTestDatabase(),
      aiSweepOnStart: true,
    });
    await restarted.ready();
    try {
      expect(await rowOf(pending.id)).toMatchObject({
        status: "failed",
        errorCode: "interrupted",
        completedAt: expect.any(Date),
      });
      expect(await rowOf(done.id)).toMatchObject({ status: "succeeded", errorCode: null });
      expect(await rowOf(failed.id)).toMatchObject({ status: "failed", errorCode: "refused" });
    } finally {
      await restarted.close();
    }
  });

  it("are left alone by a server that does not sweep (the tests, a second process)", async () => {
    const { person, project } = await setup();
    const pending = await insertAiAnalysis(t.handle.db, person.id, project.id);

    const other = buildApp(testEnv(), { database: connectTestDatabase() });
    await other.ready();
    await other.close();

    expect(await rowOf(pending.id)).toMatchObject({ status: "pending" });
  });

  it("are counted by the sweep, which can also be called directly", async () => {
    const { person, project } = await setup();
    await insertAiAnalysis(t.handle.db, person.id, project.id);
    const service = createAiService(t.handle.db, {
      config: testAiConfig(),
      enabled: false,
    });
    expect(await service.sweepInterrupted()).toBe(1);
    expect(await service.sweepInterrupted()).toBe(0);
  });
});
