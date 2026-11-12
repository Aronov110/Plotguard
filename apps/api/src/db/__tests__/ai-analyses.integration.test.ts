import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../client.ts";
import {
  AI_ANALYSIS_KINDS,
  AI_ANALYSIS_SCOPES,
  AI_ANALYSIS_STATUSES,
  aiAnalyses,
} from "../schema/ai-analyses.ts";
import { documents } from "../schema/documents.ts";
import { projects } from "../schema/projects.ts";
import { users } from "../schema/users.ts";
import {
  expectPgError,
  insertAiAnalysis,
  insertDocument,
  insertProject,
  insertUser,
  PG_ERRORS,
} from "../test-support/factories.ts";
import { connectTestDatabase, resetTables } from "../test-support/test-database.ts";

describe("ai_analyses", () => {
  let handle: DatabaseHandle;

  beforeAll(() => {
    handle = connectTestDatabase();
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await resetTables(handle);
  });

  async function setup() {
    const user = await insertUser(handle.db);
    const project = await insertProject(handle.db, user.id);
    return { user, project };
  }

  it("inserts a pending analysis with zero tokens and no result", async () => {
    const { user, project } = await setup();
    const analysis = await insertAiAnalysis(handle.db, user.id, project.id);

    expect(analysis.status).toBe("pending");
    expect(analysis.inputTokens).toBe(0);
    expect(analysis.outputTokens).toBe(0);
    expect(analysis.result).toBeNull();
    expect(analysis.errorCode).toBeNull();
    expect(analysis.documentId).toBeNull();
    expect(analysis.completedAt).toBeNull();
  });

  describe("enumerated columns", () => {
    it.each(AI_ANALYSIS_KINDS)("accepts kind %s", async (kind) => {
      const { user, project } = await setup();

      await expect(
        insertAiAnalysis(handle.db, user.id, project.id, { kind }),
      ).resolves.toMatchObject({ kind });
    });

    it.each(AI_ANALYSIS_SCOPES)("accepts scope %s", async (scope) => {
      const { user, project } = await setup();

      await expect(
        insertAiAnalysis(handle.db, user.id, project.id, { scope }),
      ).resolves.toMatchObject({ scope });
    });

    it.each(AI_ANALYSIS_STATUSES)("accepts status %s", async (status) => {
      const { user, project } = await setup();

      await expect(
        insertAiAnalysis(handle.db, user.id, project.id, { status }),
      ).resolves.toMatchObject({ status });
    });

    it.each(["summary", "", "Plot_Holes"])("rejects kind %j", async (kind) => {
      const { user, project } = await setup();

      await expectPgError(
        insertAiAnalysis(handle.db, user.id, project.id, { kind: kind as never }),
        PG_ERRORS.checkViolation,
        "ai_analyses_kind_valid",
      );
    });

    it.each(["chapter", "", "PROJECT"])("rejects scope %j", async (scope) => {
      const { user, project } = await setup();

      await expectPgError(
        insertAiAnalysis(handle.db, user.id, project.id, { scope: scope as never }),
        PG_ERRORS.checkViolation,
        "ai_analyses_scope_valid",
      );
    });

    it.each(["done", "", "Succeeded"])("rejects status %j", async (status) => {
      const { user, project } = await setup();

      await expectPgError(
        insertAiAnalysis(handle.db, user.id, project.id, { status: status as never }),
        PG_ERRORS.checkViolation,
        "ai_analyses_status_valid",
      );
    });
  });

  describe("token counts and model", () => {
    it("rejects negative token counts and accepts zero and large values", async () => {
      const { user, project } = await setup();

      await expectPgError(
        insertAiAnalysis(handle.db, user.id, project.id, { inputTokens: -1 }),
        PG_ERRORS.checkViolation,
        "ai_analyses_input_tokens_non_negative",
      );
      await expectPgError(
        insertAiAnalysis(handle.db, user.id, project.id, { outputTokens: -1 }),
        PG_ERRORS.checkViolation,
        "ai_analyses_output_tokens_non_negative",
      );
      await expect(
        insertAiAnalysis(handle.db, user.id, project.id, {
          inputTokens: 0,
          outputTokens: 2_000_000_000,
        }),
      ).resolves.toBeDefined();
    });

    it("rejects an empty model name", async () => {
      const { user, project } = await setup();

      await expectPgError(
        insertAiAnalysis(handle.db, user.id, project.id, { model: "" }),
        PG_ERRORS.checkViolation,
        "ai_analyses_model_not_empty",
      );
    });
  });

  describe("focus", () => {
    it("is empty unless one is given", async () => {
      const { user, project } = await setup();
      const row = await insertAiAnalysis(handle.db, user.id, project.id, { kind: "ideas" });
      expect(row.focus).toBeNull();
    });

    it("holds up to 500 characters, counted as characters and not as bytes", async () => {
      const { user, project } = await setup();
      const row = await insertAiAnalysis(handle.db, user.id, project.id, {
        kind: "ideas",
        status: "succeeded",
        focus: "é".repeat(500),
      });
      expect(row.focus).toHaveLength(500);
      await expect(
        insertAiAnalysis(handle.db, user.id, project.id, {
          kind: "ideas",
          status: "succeeded",
          focus: "\u{1F600}".repeat(500),
        }),
      ).resolves.toBeDefined();
    });

    it("refuses more than 500 characters", async () => {
      const { user, project } = await setup();
      await expectPgError(
        insertAiAnalysis(handle.db, user.id, project.id, {
          kind: "ideas",
          focus: "a".repeat(501),
        }),
        PG_ERRORS.checkViolation,
        "ai_analyses_focus_length",
      );
    });
  });

  describe("ownership", () => {
    it("rejects an analysis whose project belongs to a different user", async () => {
      const { project } = await setup();
      const intruder = await insertUser(handle.db);

      await expectPgError(
        insertAiAnalysis(handle.db, intruder.id, project.id),
        PG_ERRORS.foreignKeyViolation,
        "ai_analyses_project_owner_fk",
      );
    });

    it("rejects a project that does not exist", async () => {
      const { user } = await setup();

      await expectPgError(
        insertAiAnalysis(handle.db, user.id, crypto.randomUUID()),
        PG_ERRORS.foreignKeyViolation,
        "ai_analyses_project_owner_fk",
      );
    });

    it("rejects a user that does not exist", async () => {
      const { project } = await setup();

      await expectPgError(
        insertAiAnalysis(handle.db, crypto.randomUUID(), project.id),
        PG_ERRORS.foreignKeyViolation,
      );
    });

    it("rejects a document that does not exist", async () => {
      const { user, project } = await setup();

      await expectPgError(
        insertAiAnalysis(handle.db, user.id, project.id, { documentId: crypto.randomUUID() }),
        PG_ERRORS.foreignKeyViolation,
        "ai_analyses_document_id_documents_id_fk",
      );
    });
  });

  describe("result", () => {
    it("round-trips nested JSON with unicode", async () => {
      const { user, project } = await setup();
      const result = {
        findings: [
          {
            severity: "high",
            title: "Mara has no key 🗝️",
            locations: [{ chapter: 1 }, { chapter: 3 }],
          },
        ],
        notes: null,
      };

      const analysis = await insertAiAnalysis(handle.db, user.id, project.id, {
        status: "succeeded",
        result,
        completedAt: new Date(),
      });

      expect(analysis.result).toEqual(result);
    });
  });

  describe("cascades", () => {
    it("keeps the analysis and clears document_id when the document is deleted", async () => {
      const { user, project } = await setup();
      const doc = await insertDocument(handle.db, project.id);
      const analysis = await insertAiAnalysis(handle.db, user.id, project.id, {
        scope: "document",
        documentId: doc.id,
      });

      await handle.db.delete(documents).where(eq(documents.id, doc.id));

      const [row] = await handle.db.select().from(aiAnalyses).where(eq(aiAnalyses.id, analysis.id));
      expect(row).toBeDefined();
      expect(row?.documentId).toBeNull();
    });

    it("is deleted with its project, leaving other projects' analyses", async () => {
      const { user, project } = await setup();
      const other = await insertProject(handle.db, user.id, { title: "Other" });
      await insertAiAnalysis(handle.db, user.id, project.id);
      // Only one analysis per person may be pending, so the second one is a finished one.
      const kept = await insertAiAnalysis(handle.db, user.id, other.id, { status: "succeeded" });

      await handle.db.delete(projects).where(eq(projects.id, project.id));

      const remaining = await handle.db.select().from(aiAnalyses);
      expect(remaining.map((row) => row.id)).toEqual([kept.id]);
    });

    it("is deleted with its user, leaving other users' analyses", async () => {
      const { user, project } = await setup();
      const other = await insertUser(handle.db);
      const otherProject = await insertProject(handle.db, other.id);
      await insertAiAnalysis(handle.db, user.id, project.id);
      const kept = await insertAiAnalysis(handle.db, other.id, otherProject.id);

      await handle.db.delete(users).where(eq(users.id, user.id));

      const remaining = await handle.db.select().from(aiAnalyses);
      expect(remaining.map((row) => row.id)).toEqual([kept.id]);
    });
  });

  it.each([
    ["a user's history", "user_id", "ai_analyses_user_created_idx"],
    ["a project's history", "project_id", "ai_analyses_project_created_idx"],
  ])(
    "serves %s newest-first from the index without a separate sort",
    async (_label, column, index) => {
      const { user, project } = await setup();
      const client = await handle.pool.connect();
      try {
        await client.query("begin");
        await client.query("set local enable_seqscan = off");
        await client.query("set local enable_bitmapscan = off");
        const plan = await client.query<{ "QUERY PLAN": string }>(
          `explain select * from ai_analyses where ${column} = $1
         order by created_at desc limit 20`,
          [column === "user_id" ? user.id : project.id],
        );
        await client.query("rollback");

        const text = plan.rows.map((row) => row["QUERY PLAN"]).join("\n");
        expect(text).toContain(index);
        expect(text).not.toMatch(/\bSort\b/);
      } finally {
        client.release();
      }
    },
  );

  describe("one pending analysis per person", () => {
    it("refuses a second pending analysis of the same person, even in another project", async () => {
      const { user, project } = await setup();
      const other = await insertProject(handle.db, user.id, { title: "Other" });
      await insertAiAnalysis(handle.db, user.id, project.id);

      await expectPgError(
        insertAiAnalysis(handle.db, user.id, other.id),
        PG_ERRORS.uniqueViolation,
        "ai_analyses_one_pending_per_user_idx",
      );
    });

    it("allows pending analyses of different people at the same time", async () => {
      const { user, project } = await setup();
      const other = await insertUser(handle.db);
      const otherProject = await insertProject(handle.db, other.id);
      await insertAiAnalysis(handle.db, user.id, project.id);

      await expect(insertAiAnalysis(handle.db, other.id, otherProject.id)).resolves.toMatchObject({
        status: "pending",
      });
    });

    it("allows as many finished analyses as there are, next to one pending", async () => {
      const { user, project } = await setup();
      await insertAiAnalysis(handle.db, user.id, project.id, { status: "succeeded" });
      await insertAiAnalysis(handle.db, user.id, project.id, { status: "failed" });
      await insertAiAnalysis(handle.db, user.id, project.id, { status: "succeeded" });

      await expect(insertAiAnalysis(handle.db, user.id, project.id)).resolves.toMatchObject({
        status: "pending",
      });
    });

    it("allows a new pending analysis once the pending one has finished or failed", async () => {
      const { user, project } = await setup();
      const first = await insertAiAnalysis(handle.db, user.id, project.id);
      await handle.db
        .update(aiAnalyses)
        .set({ status: "failed", errorCode: "interrupted" })
        .where(eq(aiAnalyses.id, first.id));

      await expect(insertAiAnalysis(handle.db, user.id, project.id)).resolves.toMatchObject({
        status: "pending",
      });
    });

    it("refuses to turn a finished analysis back into a second pending one", async () => {
      const { user, project } = await setup();
      await insertAiAnalysis(handle.db, user.id, project.id);
      const finished = await insertAiAnalysis(handle.db, user.id, project.id, {
        status: "succeeded",
      });

      await expectPgError(
        handle.db
          .update(aiAnalyses)
          .set({ status: "pending" })
          .where(eq(aiAnalyses.id, finished.id)),
        PG_ERRORS.uniqueViolation,
        "ai_analyses_one_pending_per_user_idx",
      );
    });

    it("lets exactly one of two simultaneous inserts win", async () => {
      const { user, project } = await setup();
      const results = await Promise.allSettled([
        insertAiAnalysis(handle.db, user.id, project.id),
        insertAiAnalysis(handle.db, user.id, project.id),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    });
  });

  it("can sum token usage per user (the basis for usage limits)", async () => {
    const { user, project } = await setup();
    // Finished analyses: a person may have only one pending at a time.
    await insertAiAnalysis(handle.db, user.id, project.id, {
      status: "succeeded",
      inputTokens: 100,
      outputTokens: 10,
    });
    await insertAiAnalysis(handle.db, user.id, project.id, {
      status: "failed",
      inputTokens: 250,
      outputTokens: 40,
    });

    const { rows } = await handle.pool.query<{ input: string; output: string }>(
      `select sum(input_tokens) as input, sum(output_tokens) as output
       from ai_analyses where user_id = $1`,
      [user.id],
    );

    expect(Number(rows[0]?.input)).toBe(350);
    expect(Number(rows[0]?.output)).toBe(50);
  });
});
