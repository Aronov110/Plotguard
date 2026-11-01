import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../client.ts";
import { documents } from "../schema/documents.ts";
import { projects } from "../schema/projects.ts";
import {
  expectPgError,
  insertDocument,
  insertProject,
  insertUser,
  PG_ERRORS,
} from "../test-support/factories.ts";
import { connectTestDatabase, resetTables } from "../test-support/test-database.ts";

describe("documents", () => {
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

  it("inserts a top-level document with empty content and a zero word count", async () => {
    const { project } = await setup();
    const doc = await insertDocument(handle.db, project.id);

    expect(doc.parentId).toBeNull();
    expect(doc.content).toBe("");
    expect(doc.wordCount).toBe(0);
    expect(doc.projectId).toBe(project.id);
  });

  it("stores large content and unicode verbatim", async () => {
    const { project } = await setup();
    const content = `INT. LIGHTHOUSE - NIGHT\n\n${"Mara climbs. 🌊 ".repeat(100_000)}`;

    const doc = await insertDocument(handle.db, project.id, { content });

    expect(doc.content).toBe(content);
  });

  describe("title", () => {
    it("rejects an empty title and 201 characters", async () => {
      const { project } = await setup();

      await expectPgError(
        insertDocument(handle.db, project.id, { title: "" }),
        PG_ERRORS.checkViolation,
        "documents_title_length",
      );
      await expectPgError(
        insertDocument(handle.db, project.id, { title: "a".repeat(201) }),
        PG_ERRORS.checkViolation,
        "documents_title_length",
      );
    });

    it("accepts 1 and 200 characters", async () => {
      const { project } = await setup();

      await expect(insertDocument(handle.db, project.id, { title: "a" })).resolves.toBeDefined();
      await expect(
        insertDocument(handle.db, project.id, { title: "a".repeat(200) }),
      ).resolves.toBeDefined();
    });
  });

  describe("position and word_count", () => {
    it("accepts position 0 and rejects -1", async () => {
      const { project } = await setup();

      await expect(insertDocument(handle.db, project.id, { position: 0 })).resolves.toBeDefined();
      await expectPgError(
        insertDocument(handle.db, project.id, { position: -1 }),
        PG_ERRORS.checkViolation,
        "documents_position_non_negative",
      );
    });

    it("accepts word_count 0 and rejects -1", async () => {
      const { project } = await setup();

      await expect(insertDocument(handle.db, project.id, { wordCount: 0 })).resolves.toBeDefined();
      await expectPgError(
        insertDocument(handle.db, project.id, { wordCount: -1 }),
        PG_ERRORS.checkViolation,
        "documents_word_count_non_negative",
      );
    });

    it("allows two documents to share a position (reordering is done in the app, in a transaction)", async () => {
      const { project } = await setup();

      await insertDocument(handle.db, project.id, { position: 3, title: "a" });
      await expect(
        insertDocument(handle.db, project.id, { position: 3, title: "b" }),
      ).resolves.toBeDefined();
    });
  });

  describe("hierarchy", () => {
    it("accepts a child whose parent is in the same project", async () => {
      const { project } = await setup();
      const act = await insertDocument(handle.db, project.id, { title: "Act 1" });

      const chapter = await insertDocument(handle.db, project.id, {
        title: "Chapter 1",
        parentId: act.id,
      });

      expect(chapter.parentId).toBe(act.id);
    });

    it("rejects a parent that belongs to a different project", async () => {
      const { user, project } = await setup();
      const otherProject = await insertProject(handle.db, user.id, { title: "Other" });
      const foreignParent = await insertDocument(handle.db, otherProject.id);

      await expectPgError(
        insertDocument(handle.db, project.id, { parentId: foreignParent.id }),
        PG_ERRORS.foreignKeyViolation,
        "documents_parent_same_project_fk",
      );
    });

    it("rejects a parent that does not exist", async () => {
      const { project } = await setup();

      await expectPgError(
        insertDocument(handle.db, project.id, { parentId: crypto.randomUUID() }),
        PG_ERRORS.foreignKeyViolation,
        "documents_parent_same_project_fk",
      );
    });

    it("rejects a document that is its own parent", async () => {
      const { project } = await setup();
      const doc = await insertDocument(handle.db, project.id);

      await expectPgError(
        handle.db.update(documents).set({ parentId: doc.id }).where(eq(documents.id, doc.id)),
        PG_ERRORS.checkViolation,
        "documents_not_own_parent",
      );
    });

    it("rejects nesting deeper than one level", async () => {
      const { project } = await setup();
      const act = await insertDocument(handle.db, project.id);
      const chapter = await insertDocument(handle.db, project.id, { parentId: act.id });

      const info = await expectPgError(
        insertDocument(handle.db, project.id, { parentId: chapter.id }),
        PG_ERRORS.checkViolation,
      );
      expect(info.message).toContain("only one level deep");
    });

    it("rejects giving a parent to a document that already has children", async () => {
      const { project } = await setup();
      const act = await insertDocument(handle.db, project.id, { title: "Act 1" });
      const otherAct = await insertDocument(handle.db, project.id, { title: "Act 2" });
      await insertDocument(handle.db, project.id, { parentId: act.id });

      const info = await expectPgError(
        handle.db.update(documents).set({ parentId: otherAct.id }).where(eq(documents.id, act.id)),
        PG_ERRORS.checkViolation,
      );
      expect(info.message).toContain("has children");
    });

    it("allows moving a child to another parent and detaching it", async () => {
      const { project } = await setup();
      const actOne = await insertDocument(handle.db, project.id, { title: "Act 1" });
      const actTwo = await insertDocument(handle.db, project.id, { title: "Act 2" });
      const chapter = await insertDocument(handle.db, project.id, { parentId: actOne.id });

      await handle.db
        .update(documents)
        .set({ parentId: actTwo.id })
        .where(eq(documents.id, chapter.id));
      await handle.db.update(documents).set({ parentId: null }).where(eq(documents.id, chapter.id));

      const [row] = await handle.db.select().from(documents).where(eq(documents.id, chapter.id));
      expect(row?.parentId).toBeNull();
    });

    it("still allows renaming a document that has children", async () => {
      const { project } = await setup();
      const act = await insertDocument(handle.db, project.id, { title: "Act 1" });
      await insertDocument(handle.db, project.id, { parentId: act.id });

      await expect(
        handle.db.update(documents).set({ title: "Act One" }).where(eq(documents.id, act.id)),
      ).resolves.toBeDefined();
    });
  });

  describe("cascades", () => {
    it("deleting a parent deletes its children but not its siblings", async () => {
      const { project } = await setup();
      const act = await insertDocument(handle.db, project.id, { title: "Act 1" });
      const sibling = await insertDocument(handle.db, project.id, { title: "Act 2" });
      await insertDocument(handle.db, project.id, { title: "c1", parentId: act.id });
      await insertDocument(handle.db, project.id, { title: "c2", parentId: act.id });

      await handle.db.delete(documents).where(eq(documents.id, act.id));

      const remaining = await handle.db.select().from(documents);
      expect(remaining.map((row) => row.id)).toEqual([sibling.id]);
    });

    it("deleting a project deletes all of its documents only", async () => {
      const { user, project } = await setup();
      const otherProject = await insertProject(handle.db, user.id, { title: "Other" });
      await insertDocument(handle.db, project.id);
      await insertDocument(handle.db, project.id);
      const kept = await insertDocument(handle.db, otherProject.id);

      await handle.db.delete(projects).where(eq(projects.id, project.id));

      const remaining = await handle.db.select().from(documents);
      expect(remaining.map((row) => row.id)).toEqual([kept.id]);
    });
  });

  it("rejects a document for a project that does not exist", async () => {
    await expectPgError(
      insertDocument(handle.db, crypto.randomUUID()),
      PG_ERRORS.foreignKeyViolation,
      "documents_project_id_projects_id_fk",
    );
  });

  it("rejects NULL for title, content, position and project_id", async () => {
    const { project } = await setup();
    const values = {
      project_id: `'${project.id}'`,
      title: "'t'",
      content: "''",
      position: "0",
    };

    for (const column of Object.keys(values) as (keyof typeof values)[]) {
      const row = { ...values, [column]: "null" };
      await expectPgError(
        handle.pool.query(
          `insert into documents (${Object.keys(row).join(", ")}) values (${Object.values(row).join(", ")})`,
        ),
        PG_ERRORS.notNullViolation,
      );
    }
  });
});
