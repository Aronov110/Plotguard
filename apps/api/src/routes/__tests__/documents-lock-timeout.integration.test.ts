import type { PoolClient } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { documents } from "../../db/schema/documents.ts";
import { DEFAULT_LOCK_TIMEOUT_MS } from "../../documents/limits.ts";
import { createDocumentsService } from "../../documents/service.ts";
import { type AuthTestApp, buildAuthTestApp } from "../../test-support/auth-app.ts";
import {
  createdDocument,
  type DocumentJson,
  documentsApi,
  type OutlineJson,
} from "../../test-support/documents-api.ts";
import { createdProject, newPerson } from "../../test-support/projects-api.ts";

const PROBLEM = /^application\/problem\+json/;
const LOCK_TIMEOUT_MS = 150;
// Generous: a busy machine must not turn a correct 503 into a failure, and a missing timeout would
// show as a wait of many seconds (the held lock is never released by itself).
const LATEST_ANSWER_MS = 3000;

let t: AuthTestApp;
let held: PoolClient | undefined;

/** Lets go of the lock that {@link holdProjectLock} took. Safe to call when none is held. */
async function release(): Promise<void> {
  const client = held;
  held = undefined;
  if (client === undefined) return;
  await client.query("rollback");
  client.release();
}

afterEach(async () => {
  await release();
  await t.close();
});

/**
 * Another change to the project, in progress: a second database connection updates the project row
 * and does not finish, so every change to that project has to wait for it, as it would for a slow
 * request of the same person.
 */
async function holdProjectLock(projectId: string): Promise<void> {
  held = await t.handle.pool.connect();
  await held.query("begin");
  await held.query("update projects set updated_at = now() where id = $1", [projectId]);
}

async function setup(lockTimeoutMs = LOCK_TIMEOUT_MS) {
  t = await buildAuthTestApp({ documentLockTimeoutMs: lockTimeoutMs });
  const person = await newPerson(t.app);
  const project = await createdProject(t.app, person);
  const first = await createdDocument(t.app, person, project.id, {
    title: "First",
    content: "one",
  });
  const second = await createdDocument(t.app, person, project.id, { title: "Second" });
  return { api: documentsApi(t.app), person, project, first, second };
}

/** Runs a request and says how long it took. */
async function timed<T>(call: () => Promise<T>): Promise<{ response: T; ms: number }> {
  const start = Date.now();
  const response = await call();
  return { response, ms: Date.now() - start };
}

const storedCount = async () => (await t.handle.db.select().from(documents)).length;

describe("a change that waits too long for the project lock gives up with 503", () => {
  it("answers 503 Problem Details with Retry-After, when creating, and creates nothing", async () => {
    const { api, person, project } = await setup();
    await holdProjectLock(project.id);

    const { response, ms } = await timed(() => api.create(person, project.id, { title: "New" }));

    expect(response.statusCode).toBe(503);
    expect(response.headers["content-type"]).toMatch(PROBLEM);
    expect(response.headers["retry-after"]).toBe("2");
    expect(response.json()).toMatchObject({
      type: "urn:plotpal:problem:service-busy",
      status: 503,
    });
    // It waited for the timeout (not less), and not for ever.
    expect(ms).toBeGreaterThanOrEqual(LOCK_TIMEOUT_MS - 50);
    expect(ms).toBeLessThan(LATEST_ANSWER_MS);

    await release();
    expect(await storedCount()).toBe(2);
    expect((await api.create(person, project.id, { title: "New" })).statusCode).toBe(201);
  });

  it("answers 503 when saving, and the document is as it was; the same save works afterwards", async () => {
    const { api, person, project, first } = await setup();
    await holdProjectLock(project.id);

    const { response, ms } = await timed(() =>
      api.patch(person, project.id, first.id, { content: "changed" }, '"1"'),
    );

    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("2");
    expect(ms).toBeLessThan(LATEST_ANSWER_MS);

    await release();
    const read = (await api.get(person, project.id, first.id)).json<DocumentJson>();
    expect(read).toMatchObject({ content: "one", version: 1 });
    const again = await api.patch(person, project.id, first.id, { content: "changed" }, '"1"');
    expect(again.statusCode).toBe(200);
    expect(again.json<DocumentJson>()).toMatchObject({ content: "changed", version: 2 });
  });

  it("answers 503 when moving, and the order is as it was", async () => {
    const { api, person, project, second } = await setup();
    await holdProjectLock(project.id);

    const { response } = await timed(() =>
      api.patch(person, project.id, second.id, { position: 0 }, '"1"'),
    );

    expect(response.statusCode).toBe(503);
    await release();
    const items = (await api.outline(person, project.id)).json<OutlineJson>().items;
    expect(items.map((item) => item.title)).toEqual(["First", "Second"]);
  });

  it("answers 503 when deleting, and the document is still there", async () => {
    const { api, person, project, first } = await setup();
    await holdProjectLock(project.id);

    const { response } = await timed(() => api.remove(person, project.id, first.id));

    expect(response.statusCode).toBe(503);
    await release();
    expect((await api.get(person, project.id, first.id)).statusCode).toBe(200);
    expect(await storedCount()).toBe(2);
  });
});

describe("what a held lock does not hold up", () => {
  it("still reads the outline and a document at once", async () => {
    const { api, person, project, first } = await setup();
    await holdProjectLock(project.id);

    const outline = await timed(() => api.outline(person, project.id));
    const document = await timed(() => api.get(person, project.id, first.id));

    expect(outline.response.statusCode).toBe(200);
    expect(document.response.statusCode).toBe(200);
    expect(outline.ms).toBeLessThan(LATEST_ANSWER_MS);
    expect(document.ms).toBeLessThan(LATEST_ANSWER_MS);
  });

  it("does not hold up changes to another project of the same person", async () => {
    const { api, person, project } = await setup();
    const other = await createdProject(t.app, person, { title: "Other" });
    await holdProjectLock(project.id);

    const { response, ms } = await timed(() => api.create(person, other.id, { title: "Free" }));

    expect(response.statusCode).toBe(201);
    expect(ms).toBeLessThan(LOCK_TIMEOUT_MS);
  });

  it("answers someone else's change to the locked project with 404, not 503", async () => {
    const { api, project, first } = await setup();
    const stranger = await newPerson(t.app);
    await holdProjectLock(project.id);

    const create = await timed(() => api.create(stranger, project.id, { title: "Mine now" }));
    const save = await timed(() =>
      api.patch(stranger, project.id, first.id, { content: "hijack" }, '"1"'),
    );

    expect(create.response.statusCode).toBe(404);
    expect(save.response.statusCode).toBe(404);
  });
});

describe("a short wait is not an error", () => {
  it("waits for a lock that is let go in time, and then does the change", async () => {
    const { api, person, project } = await setup(5000);
    await holdProjectLock(project.id);

    const pending = timed(() => api.create(person, project.id, { title: "Patient" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await release();
    const { response, ms } = await pending;

    expect(response.statusCode).toBe(201);
    expect(ms).toBeGreaterThanOrEqual(250);
    expect(await storedCount()).toBe(3);
  });
});

describe("a pile-up cannot use up the database connections", () => {
  it("answers every one of twelve waiting changes with 503, and the pool still works", async () => {
    const { api, person, project } = await setup();
    await holdProjectLock(project.id);

    // More than the pool has connections (the default is ten): without a timeout the first ten
    // would hold every connection for ever, and nothing else could be answered.
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        timed(() => api.create(person, project.id, { title: `Waiting ${index}` })),
      ),
    );

    expect(results.map((result) => result.response.statusCode)).toEqual(Array(12).fill(503));
    for (const { ms } of results) expect(ms).toBeLessThan(LATEST_ANSWER_MS);

    expect((await api.outline(person, project.id)).statusCode).toBe(200);
    await release();
    expect((await api.create(person, project.id, { title: "After" })).statusCode).toBe(201);
    expect(await storedCount()).toBe(3);
  });

  it("leaves no lock setting on the connection for the next request", async () => {
    const { api, person, project } = await setup();
    await holdProjectLock(project.id);
    await api.create(person, project.id, { title: "Times out" });
    await release();

    // Every pooled connection must be back to the server's own setting (no limit: 0).
    const clients = await Promise.all(Array.from({ length: 5 }, () => t.handle.pool.connect()));
    try {
      for (const client of clients) {
        const { rows } = await client.query("show lock_timeout");
        expect(rows[0]).toEqual({ lock_timeout: "0" });
      }
    } finally {
      for (const client of clients) client.release();
    }
  });
});

describe("what is logged about a timeout", () => {
  it("logs it as a failed request, and never the title or the text that was sent", async () => {
    const { api, person, project } = await setup();
    await holdProjectLock(project.id);

    await api.create(person, project.id, {
      title: "Private title 7f3a",
      content: "Private text 91bc",
    });

    const logged = t.logs.text;
    expect(logged).not.toContain("Private title 7f3a");
    expect(logged).not.toContain("Private text 91bc");
    expect(logged).not.toContain("lock_timeout");
    expect(logged).not.toMatch(/insert into|update "projects"/i);
    expect(
      t.logs.entries.some((entry) => Number(entry.level) >= 50 && entry.msg !== undefined),
    ).toBe(true);
  });
});

describe("the timeout setting", () => {
  it("is five seconds unless a caller says otherwise", () => {
    expect(DEFAULT_LOCK_TIMEOUT_MS).toBe(5000);
  });

  it.each([
    ["zero, which PostgreSQL reads as no limit", 0],
    ["negative", -1],
    ["not a whole number", 1.5],
    ["not a number", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
  ])("is refused when it is %s", async (_name, value) => {
    await setup();
    expect(() => createDocumentsService(t.handle.db, { lockTimeoutMs: value })).toThrow(RangeError);
  });

  it("accepts one millisecond and the default", async () => {
    await setup();
    expect(() => createDocumentsService(t.handle.db, { lockTimeoutMs: 1 })).not.toThrow();
    expect(() => createDocumentsService(t.handle.db)).not.toThrow();
  });
});
