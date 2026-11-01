import { and, desc, eq, lt, or } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../client.ts";
import { PROJECT_FORMATS, projects } from "../schema/projects.ts";
import { users } from "../schema/users.ts";
import { expectPgError, insertProject, insertUser, PG_ERRORS } from "../test-support/factories.ts";
import { connectTestDatabase, resetTables } from "../test-support/test-database.ts";

describe("projects", () => {
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

  it("inserts a project with a NULL logline by default", async () => {
    const user = await insertUser(handle.db);
    const project = await insertProject(handle.db, user.id);

    expect(project.logline).toBeNull();
    expect(project.userId).toBe(user.id);
    expect(project.format).toBe("screenplay");
  });

  describe("format", () => {
    it.each(PROJECT_FORMATS)("accepts %s", async (format) => {
      const user = await insertUser(handle.db);

      await expect(insertProject(handle.db, user.id, { format })).resolves.toMatchObject({
        format,
      });
    });

    it.each(["novel", "Screenplay", "", " prose"])("rejects %j", async (format) => {
      const user = await insertUser(handle.db);

      await expectPgError(
        // Cast: the point of this test is that the database refuses what TypeScript would refuse.
        insertProject(handle.db, user.id, { format: format as never }),
        PG_ERRORS.checkViolation,
        "projects_format_valid",
      );
    });

    it("rejects a NULL format", async () => {
      const user = await insertUser(handle.db);

      await expectPgError(
        handle.pool.query("insert into projects (user_id, title, format) values ($1, 't', null)", [
          user.id,
        ]),
        PG_ERRORS.notNullViolation,
      );
    });
  });

  describe("title", () => {
    it("rejects an empty title", async () => {
      const user = await insertUser(handle.db);

      await expectPgError(
        insertProject(handle.db, user.id, { title: "" }),
        PG_ERRORS.checkViolation,
        "projects_title_length",
      );
    });

    it("accepts 1 and 200 characters", async () => {
      const user = await insertUser(handle.db);

      await expect(insertProject(handle.db, user.id, { title: "a" })).resolves.toBeDefined();
      await expect(
        insertProject(handle.db, user.id, { title: "a".repeat(200) }),
      ).resolves.toBeDefined();
    });

    it("rejects 201 characters", async () => {
      const user = await insertUser(handle.db);

      await expectPgError(
        insertProject(handle.db, user.id, { title: "a".repeat(201) }),
        PG_ERRORS.checkViolation,
        "projects_title_length",
      );
    });

    it("stores titles with quotes, emoji and SQL-looking text verbatim", async () => {
      const user = await insertUser(handle.db);
      const title = `Robert'); DROP TABLE projects;-- 🎬 "quoted"`;

      const project = await insertProject(handle.db, user.id, { title });

      expect(project.title).toBe(title);
      await expect(handle.db.select().from(projects)).resolves.toHaveLength(1);
    });
  });

  describe("logline", () => {
    it("accepts NULL, 1000 characters and an empty string", async () => {
      const user = await insertUser(handle.db);

      await expect(insertProject(handle.db, user.id, { logline: null })).resolves.toBeDefined();
      await expect(
        insertProject(handle.db, user.id, { logline: "a".repeat(1000) }),
      ).resolves.toBeDefined();
      await expect(insertProject(handle.db, user.id, { logline: "" })).resolves.toBeDefined();
    });

    it("rejects 1001 characters", async () => {
      const user = await insertUser(handle.db);

      await expectPgError(
        insertProject(handle.db, user.id, { logline: "a".repeat(1001) }),
        PG_ERRORS.checkViolation,
        "projects_logline_length",
      );
    });
  });

  it("rejects a project for a user that does not exist", async () => {
    await expectPgError(
      insertProject(handle.db, crypto.randomUUID()),
      PG_ERRORS.foreignKeyViolation,
      "projects_user_id_users_id_fk",
    );
  });

  it("is deleted together with its user, without touching other users' projects", async () => {
    const owner = await insertUser(handle.db);
    const other = await insertUser(handle.db);
    await insertProject(handle.db, owner.id);
    await insertProject(handle.db, owner.id);
    const kept = await insertProject(handle.db, other.id);

    await handle.db.delete(users).where(eq(users.id, owner.id));

    const remaining = await handle.db.select().from(projects);
    expect(remaining.map((row) => row.id)).toEqual([kept.id]);
  });

  describe("cursor pagination", () => {
    it("pages newest-first with no duplicates or gaps, even when updated_at ties", async () => {
      const user = await insertUser(handle.db);
      const tied = new Date("2026-01-01T00:00:00.000Z");
      const newer = new Date("2026-02-01T00:00:00.000Z");
      const inserted = [
        await insertProject(handle.db, user.id, { title: "tie-1", updatedAt: tied }),
        await insertProject(handle.db, user.id, { title: "tie-2", updatedAt: tied }),
        await insertProject(handle.db, user.id, { title: "tie-3", updatedAt: tied }),
        await insertProject(handle.db, user.id, { title: "newer-1", updatedAt: newer }),
        await insertProject(handle.db, user.id, { title: "newer-2", updatedAt: newer }),
      ];

      const collected: string[] = [];
      let cursor: { updatedAt: Date; id: string } | undefined;
      for (let page = 0; page < 10; page++) {
        const rows = await handle.db
          .select()
          .from(projects)
          .where(
            and(
              eq(projects.userId, user.id),
              cursor
                ? or(
                    lt(projects.updatedAt, cursor.updatedAt),
                    and(eq(projects.updatedAt, cursor.updatedAt), lt(projects.id, cursor.id)),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(projects.updatedAt), desc(projects.id))
          .limit(2);
        if (rows.length === 0) break;
        collected.push(...rows.map((row) => row.id));
        const last = rows[rows.length - 1];
        if (!last) break;
        cursor = { updatedAt: last.updatedAt, id: last.id };
      }

      expect(collected).toHaveLength(5);
      expect(new Set(collected).size).toBe(5);
      expect(new Set(collected)).toEqual(new Set(inserted.map((row) => row.id)));
      // The two "newer" projects must come before every tied one.
      const newerIds = new Set(inserted.slice(3).map((row) => row.id));
      expect(collected.slice(0, 2).every((id) => newerIds.has(id))).toBe(true);
    });

    it("returns an empty page for a user with no projects", async () => {
      const user = await insertUser(handle.db);

      const rows = await handle.db.select().from(projects).where(eq(projects.userId, user.id));

      expect(rows).toEqual([]);
    });

    it("serves the newest-first query from the index without a separate sort", async () => {
      const user = await insertUser(handle.db);
      const client = await handle.pool.connect();
      try {
        await client.query("begin");
        // Force the planner to prefer indexes, since a tiny table would otherwise be scanned.
        await client.query("set local enable_seqscan = off");
        await client.query("set local enable_bitmapscan = off");
        const plan = await client.query<{ "QUERY PLAN": string }>(
          `explain select * from projects where user_id = $1
           order by updated_at desc, id desc limit 20`,
          [user.id],
        );
        await client.query("rollback");

        const text = plan.rows.map((row) => row["QUERY PLAN"]).join("\n");
        expect(text).toContain("projects_user_updated_idx");
        expect(text).not.toMatch(/\bSort\b/);
      } finally {
        client.release();
      }
    });
  });
});
