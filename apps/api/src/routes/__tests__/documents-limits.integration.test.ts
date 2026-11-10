import { count, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { documents } from "../../db/schema/documents.ts";
import { MAX_DOCUMENTS_PER_PROJECT } from "../../documents/limits.ts";
import { type AuthTestApp, buildAuthTestApp } from "../../test-support/auth-app.ts";
import {
  createdDocument,
  documentsApi,
  openConnections,
} from "../../test-support/documents-api.ts";
import { createdProject, newPerson, projectsApi } from "../../test-support/projects-api.ts";

const PROBLEM = /^application\/problem\+json/;

let t: AuthTestApp;
afterEach(async () => {
  await t.close();
});

async function setup(max: number, windowSeconds = 60) {
  t = await buildAuthTestApp({ documentLimits: { writes: { max, windowSeconds } } });
  const person = await newPerson(t.app);
  const project = await createdProject(t.app, person);
  return { api: documentsApi(t.app), person, project };
}

describe("how often one person may change documents", () => {
  it("allows exactly the maximum and refuses the next one with 429", async () => {
    const { api, person, project } = await setup(3);
    for (let i = 0; i < 3; i++) {
      expect((await api.create(person, project.id, { title: `D${i}` })).statusCode).toBe(201);
    }
    const refused = await api.create(person, project.id, { title: "D3" });
    expect(refused.statusCode).toBe(429);
    expect(refused.headers["content-type"]).toMatch(PROBLEM);
    const wait = Number(refused.headers["retry-after"]);
    expect(wait).toBeGreaterThanOrEqual(1);
    expect(wait).toBeLessThanOrEqual(60);
  });

  it("shares one counter between create, save and delete", async () => {
    const { api, person, project } = await setup(3);
    const doc = await createdDocument(t.app, person, project.id);
    expect((await api.patch(person, project.id, doc.id, { title: "B" }, '"1"')).statusCode).toBe(
      200,
    );
    expect((await api.remove(person, project.id, doc.id)).statusCode).toBe(204);
    expect((await api.create(person, project.id, { title: "C" })).statusCode).toBe(429);
  });

  it("does not create or change what it refused", async () => {
    const { api, person, project } = await setup(1);
    const doc = await createdDocument(t.app, person, project.id);
    await api.create(person, project.id, { title: "Refused" });
    await api.patch(person, project.id, doc.id, { title: "Refused" }, '"1"');
    await api.remove(person, project.id, doc.id);
    const rows = await t.handle.db.select().from(documents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Act One", version: 1 });
  });

  it("does not count reads", async () => {
    const { api, person, project } = await setup(1);
    const doc = await createdDocument(t.app, person, project.id);
    for (let i = 0; i < 10; i++) {
      expect((await api.outline(person, project.id)).statusCode).toBe(200);
      expect((await api.get(person, project.id, doc.id)).statusCode).toBe(200);
    }
  });

  it("counts each person apart", async () => {
    const { api, person, project } = await setup(1);
    const other = await newPerson(t.app);
    const theirs = await createdProject(t.app, other);
    await api.create(person, project.id, { title: "One" });
    expect((await api.create(person, project.id, { title: "Two" })).statusCode).toBe(429);
    expect((await api.create(other, theirs.id, { title: "Theirs" })).statusCode).toBe(201);
  });

  it("keeps its own counter, apart from the project one", async () => {
    const { api, person, project } = await setup(1);
    await api.create(person, project.id, { title: "One" });
    const made = await projectsApi(t.app).create(person, { title: "P", format: "prose" });
    expect(made.statusCode).toBe(201);
  });

  it("does not count a request without a valid token", async () => {
    const { api, person, project } = await setup(1);
    for (let i = 0; i < 5; i++) {
      await t.app.inject({
        method: "POST",
        url: `/projects/${project.id}/documents`,
        payload: { title: "X" },
      });
    }
    expect((await api.create(person, project.id, { title: "Mine" })).statusCode).toBe(201);
  });

  it("is generous enough for normal use with the default limit", async () => {
    t = await buildAuthTestApp();
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    const doc = await createdDocument(t.app, person, project.id);
    const api = documentsApi(t.app);
    let version = 1;
    for (let i = 0; i < 100; i++) {
      const response = await api.patch(
        person,
        project.id,
        doc.id,
        { content: `draft ${i}` },
        `"${version}"`,
      );
      expect(response.statusCode).toBe(200);
      version += 1;
    }
  });
});

describe("what is logged", () => {
  it("never logs the text or the title of a request, accepted or refused", async () => {
    // Three writes are allowed, so the invalid one below reaches validation (the limit check runs
    // before it) and only the fourth is refused for the limit.
    const { api, person, project } = await setup(3);
    const doc = await api.create(person, project.id, {
      title: "Logged-title-7731",
      content: "Logged-story-4410",
    });
    const id = doc.json<{ id: string }>().id;
    const stale = await api.patch(person, project.id, id, { content: "Logged-story-8852" }, '"9"');
    const invalid = await api.create(person, project.id, {
      title: "",
      content: "Logged-story-1175",
    });
    const limited = await api.patch(
      person,
      project.id,
      id,
      { content: "Logged-story-9963" },
      '"1"',
    );
    // Each way of being refused really happened, so each one was checked.
    expect([stale.statusCode, invalid.statusCode, limited.statusCode]).toEqual([412, 400, 429]);
    // The log is not empty (the requests were recorded), so the check below can fail.
    expect(t.logs.text).toContain("/documents");
    expect(t.logs.text).not.toMatch(/Logged-(title|story)-/);
  });
});

describe("how many documents a project can hold", () => {
  it("allows 1,000 and refuses the 1,001st with 409", async () => {
    t = await buildAuthTestApp({
      documentLimits: { writes: { max: 100_000, windowSeconds: 60 } },
    });
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    const other = await createdProject(t.app, person, { title: "Other" });
    // Filled directly: 1,000 requests would only test the speed of the machine.
    await t.handle.db.insert(documents).values(
      Array.from({ length: MAX_DOCUMENTS_PER_PROJECT - 1 }, (_, i) => ({
        projectId: project.id,
        title: `D${i}`,
        position: i,
      })),
    );
    const api = documentsApi(t.app);
    expect((await api.create(person, project.id, { title: "Last" })).statusCode).toBe(201);
    const refused = await api.create(person, project.id, { title: "One too many" });
    expect(refused.statusCode).toBe(409);
    expect(refused.headers["content-type"]).toMatch(PROBLEM);
    const [{ n } = { n: 0 }] = await t.handle.db
      .select({ n: count() })
      .from(documents)
      .where(eq(documents.projectId, project.id));
    expect(n).toBe(MAX_DOCUMENTS_PER_PROJECT);
    // The cap is per project: another project of the same person is not affected.
    expect((await api.create(person, other.id, { title: "Fine" })).statusCode).toBe(201);
  });

  it("lets only one of eight simultaneous creates take the last place", async () => {
    t = await buildAuthTestApp({
      documentLimits: { writes: { max: 100_000, windowSeconds: 60 } },
    });
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    await t.handle.db.insert(documents).values(
      Array.from({ length: MAX_DOCUMENTS_PER_PROJECT - 1 }, (_, i) => ({
        projectId: project.id,
        title: `D${i}`,
        position: i,
      })),
    );
    const api = documentsApi(t.app);
    await openConnections(t.handle.pool, 8);
    // Without the project lock several would count 999 and all of those would insert.
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) => api.create(person, project.id, { title: `Racer ${i}` })),
    );
    const codes = responses.map((response) => response.statusCode);
    expect(codes.filter((code) => code === 201)).toHaveLength(1);
    expect(codes.filter((code) => code === 409)).toHaveLength(7);
    const [{ n } = { n: 0 }] = await t.handle.db
      .select({ n: count() })
      .from(documents)
      .where(eq(documents.projectId, project.id));
    expect(n).toBe(MAX_DOCUMENTS_PER_PROJECT);
  });

  it("returns the whole full outline in one response", async () => {
    t = await buildAuthTestApp();
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    await t.handle.db.insert(documents).values(
      Array.from({ length: MAX_DOCUMENTS_PER_PROJECT }, (_, i) => ({
        projectId: project.id,
        title: `D${i}`,
        position: i,
      })),
    );
    const response = await documentsApi(t.app).outline(person, project.id);
    expect(response.statusCode).toBe(200);
    expect(response.json<{ items: unknown[] }>().items).toHaveLength(MAX_DOCUMENTS_PER_PROJECT);
  });

  it("lets a delete make room again", async () => {
    t = await buildAuthTestApp({
      documentLimits: { writes: { max: 100_000, windowSeconds: 60 } },
    });
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    await t.handle.db.insert(documents).values(
      Array.from({ length: MAX_DOCUMENTS_PER_PROJECT }, (_, i) => ({
        projectId: project.id,
        title: `D${i}`,
        position: i,
      })),
    );
    const api = documentsApi(t.app);
    expect((await api.create(person, project.id, { title: "Full" })).statusCode).toBe(409);
    const outline = (await api.outline(person, project.id)).json<{ items: { id: string }[] }>();
    const first = outline.items[0];
    if (first === undefined) throw new Error("The outline is empty.");
    await api.remove(person, project.id, first.id);
    expect((await api.create(person, project.id, { title: "Room" })).statusCode).toBe(201);
  });
});
