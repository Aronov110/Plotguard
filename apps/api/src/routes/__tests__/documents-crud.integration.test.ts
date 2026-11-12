import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { aiAnalyses } from "../../db/schema/ai-analyses.ts";
import { insertAiAnalysis } from "../../db/test-support/factories.ts";
import { type AuthTestApp, buildAuthTestApp } from "../../test-support/auth-app.ts";
import {
  createdDocument,
  type DocumentJson,
  documentsApi,
  type OutlineJson,
  outlineTitles,
} from "../../test-support/documents-api.ts";
import {
  bearer,
  createdProject,
  newPerson,
  type ProjectJson,
} from "../../test-support/projects-api.ts";

const PROBLEM = /^application\/problem\+json/;

let t: AuthTestApp;
afterEach(async () => {
  await t.close();
});

async function setup() {
  t = await buildAuthTestApp();
  const person = await newPerson(t.app);
  const project = await createdProject(t.app, person);
  return { api: documentsApi(t.app), person, project };
}

describe("adding a document", () => {
  it("answers 201 with defaults, a Location and an ETag", async () => {
    const { api, person, project } = await setup();
    const response = await api.create(person, project.id, { title: "Act One" });
    expect(response.statusCode).toBe(201);
    const body = response.json<DocumentJson>();
    expect(body).toMatchObject({
      projectId: project.id,
      parentId: null,
      title: "Act One",
      content: "",
      position: 0,
      wordCount: 0,
      version: 1,
    });
    expect(response.headers.location).toBe(`/projects/${project.id}/documents/${body.id}`);
    expect(response.headers.etag).toBe('"1"');
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });

  it("stores the text as sent and counts its words", async () => {
    const { api, person, project } = await setup();
    const text = "  INT. LIGHTHOUSE - NIGHT\n\n<b>Waves</b> crash.  \n";
    const response = await api.create(person, project.id, { title: "Scene", content: text });
    const body = response.json<DocumentJson>();
    expect(body.content).toBe(text);
    expect(body.wordCount).toBe(6);
  });

  it("trims the title like a project title", async () => {
    const { api, person, project } = await setup();
    const response = await api.create(person, project.id, { title: "  Padded  " });
    expect(response.json<DocumentJson>().title).toBe("Padded");
  });

  it("appends to the end of its siblings by default", async () => {
    const { person, project } = await setup();
    const a = await createdDocument(t.app, person, project.id, { title: "A" });
    const b = await createdDocument(t.app, person, project.id, { title: "B" });
    expect([a.position, b.position]).toEqual([0, 1]);
  });

  it("puts a child under its parent, counted apart from the top level", async () => {
    const { person, project } = await setup();
    const act = await createdDocument(t.app, person, project.id, { title: "Act" });
    const scene = await createdDocument(t.app, person, project.id, {
      title: "Scene",
      parentId: act.id,
    });
    expect(scene).toMatchObject({ parentId: act.id, position: 0 });
  });

  it("moves the project to the top of the project list", async () => {
    const { api, person, project } = await setup();
    const newer = await createdProject(t.app, person, { title: "Newer" });
    await api.create(person, project.id, { title: "Act" });
    const list = await t.app.inject({ method: "GET", url: "/projects", headers: bearer(person) });
    const ids = list.json<{ items: ProjectJson[] }>().items.map((item) => item.id);
    expect(ids).toEqual([project.id, newer.id]);
  });

  it("does not touch the project when the request is refused", async () => {
    const { api, person, project } = await setup();
    const newer = await createdProject(t.app, person, { title: "Newer" });
    const refused = await api.create(person, project.id, {
      title: "X",
      parentId: crypto.randomUUID(),
    });
    expect(refused.statusCode).toBe(400);
    const list = await t.app.inject({ method: "GET", url: "/projects", headers: bearer(person) });
    expect(list.json<{ items: ProjectJson[] }>().items[0]?.id).toBe(newer.id);
  });
});

describe("reading", () => {
  it("returns one document with its text, version and ETag", async () => {
    const { api, person, project } = await setup();
    const doc = await createdDocument(t.app, person, project.id, { content: "Hello there" });
    const response = await api.get(person, project.id, doc.id);
    expect(response.statusCode).toBe(200);
    expect(response.json<DocumentJson>()).toMatchObject({ id: doc.id, content: "Hello there" });
    expect(response.headers.etag).toBe('"1"');
  });

  it("returns an empty outline for a new project", async () => {
    const { api, person, project } = await setup();
    const response = await api.outline(person, project.id);
    expect(response.statusCode).toBe(200);
    expect(response.json<OutlineJson>()).toEqual({ items: [] });
  });

  it("leaves the text out of the outline however long it is", async () => {
    const { api, person, project } = await setup();
    await createdDocument(t.app, person, project.id, { content: "word ".repeat(20_000) });
    const response = await api.outline(person, project.id);
    expect(response.body).not.toContain("word word");
    expect(response.body.length).toBeLessThan(1000);
    expect(response.json<OutlineJson>().items[0]).toMatchObject({ wordCount: 20_000 });
  });
});

describe("deleting", () => {
  it("answers 204 with no body, and 404 the second time", async () => {
    const { api, person, project } = await setup();
    const doc = await createdDocument(t.app, person, project.id);
    const first = await api.remove(person, project.id, doc.id);
    expect(first.statusCode).toBe(204);
    expect(first.body).toBe("");
    const second = await api.remove(person, project.id, doc.id);
    expect(second.statusCode).toBe(404);
    expect(second.headers["content-type"]).toMatch(PROBLEM);
  });

  it("deletes the children of an act with it", async () => {
    const { api, person, project } = await setup();
    const act = await createdDocument(t.app, person, project.id, { title: "Act" });
    const scene = await createdDocument(t.app, person, project.id, {
      title: "Scene",
      parentId: act.id,
    });
    await api.remove(person, project.id, act.id);
    expect((await api.get(person, project.id, scene.id)).statusCode).toBe(404);
    expect(await outlineTitles(t.app, person, project.id)).toEqual([]);
  });

  describe("the AI analyses of a deleted document are kept", () => {
    const analysesOf = async (projectId: string) =>
      (await t.handle.db.select().from(aiAnalyses).where(eq(aiAnalyses.projectId, projectId))).map(
        (row) => ({ id: row.id, documentId: row.documentId }),
      );

    it("keeps the analysis and unlinks it from the deleted document", async () => {
      const { api, person, project } = await setup();
      const doc = await createdDocument(t.app, person, project.id);
      const analysis = await insertAiAnalysis(t.handle.db, person.id, project.id, {
        documentId: doc.id,
        scope: "document",
      });

      expect((await api.remove(person, project.id, doc.id)).statusCode).toBe(204);

      expect(await analysesOf(project.id)).toEqual([{ id: analysis.id, documentId: null }]);
    });

    it("leaves the analyses of other documents and of the whole project as they were", async () => {
      const { api, person, project } = await setup();
      const gone = await createdDocument(t.app, person, project.id, { title: "Gone" });
      const kept = await createdDocument(t.app, person, project.id, { title: "Kept" });
      const ofGone = await insertAiAnalysis(t.handle.db, person.id, project.id, {
        documentId: gone.id,
        scope: "document",
      });
      const ofKept = await insertAiAnalysis(t.handle.db, person.id, project.id, {
        documentId: kept.id,
        scope: "document",
      });
      const ofProject = await insertAiAnalysis(t.handle.db, person.id, project.id, {
        documentId: null,
        scope: "project",
      });

      await api.remove(person, project.id, gone.id);

      const rows = await analysesOf(project.id);
      expect(rows).toHaveLength(3);
      expect(rows).toContainEqual({ id: ofGone.id, documentId: null });
      expect(rows).toContainEqual({ id: ofKept.id, documentId: kept.id });
      expect(rows).toContainEqual({ id: ofProject.id, documentId: null });
    });

    it("unlinks the analyses of an act and of its scenes when the act is deleted", async () => {
      const { api, person, project } = await setup();
      const act = await createdDocument(t.app, person, project.id, { title: "Act" });
      const scene = await createdDocument(t.app, person, project.id, {
        title: "Scene",
        parentId: act.id,
      });
      await insertAiAnalysis(t.handle.db, person.id, project.id, {
        documentId: act.id,
        scope: "document",
      });
      await insertAiAnalysis(t.handle.db, person.id, project.id, {
        documentId: scene.id,
        scope: "document",
      });

      await api.remove(person, project.id, act.id);

      const rows = await analysesOf(project.id);
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.documentId === null)).toBe(true);
    });

    it("keeps the analysis when the delete is refused (someone else's project)", async () => {
      const { api, person, project } = await setup();
      const doc = await createdDocument(t.app, person, project.id);
      const analysis = await insertAiAnalysis(t.handle.db, person.id, project.id, {
        documentId: doc.id,
        scope: "document",
      });
      const stranger = await newPerson(t.app);

      expect((await api.remove(stranger, project.id, doc.id)).statusCode).toBe(404);

      expect(await analysesOf(project.id)).toEqual([{ id: analysis.id, documentId: doc.id }]);
    });
  });

  it("closes the gap among the siblings and leaves other parents alone", async () => {
    const { api, person, project } = await setup();
    const a = await createdDocument(t.app, person, project.id, { title: "A" });
    const b = await createdDocument(t.app, person, project.id, { title: "B" });
    await createdDocument(t.app, person, project.id, { title: "C" });
    const child = await createdDocument(t.app, person, project.id, { title: "a1", parentId: a.id });
    await api.remove(person, project.id, b.id);
    const items = (await api.outline(person, project.id)).json<OutlineJson>().items;
    expect(items.map((item) => [item.title, item.position])).toEqual([
      ["A", 0],
      ["a1", 0],
      ["C", 1],
    ]);
    expect(items[1]?.id).toBe(child.id);
  });

  it("moves the project to the top of the project list", async () => {
    const { api, person, project } = await setup();
    const doc = await createdDocument(t.app, person, project.id);
    await createdProject(t.app, person, { title: "Newer" });
    await api.remove(person, project.id, doc.id);
    const list = await t.app.inject({ method: "GET", url: "/projects", headers: bearer(person) });
    expect(list.json<{ items: ProjectJson[] }>().items[0]?.id).toBe(project.id);
  });
});

describe("a change that finds no such document in the person's own project", () => {
  // The project is found (so its `updated_at` is touched first), then the document is not: the
  // answer is 404 and the touch must be rolled back, as it is for a refused request.
  it("answers 404 and does not move the project to the top of the list", async () => {
    const { api, person, project } = await setup();
    const newer = await createdProject(t.app, person, { title: "Newer" });
    const missing = crypto.randomUUID();
    const topOfList = async () => {
      const list = await t.app.inject({ method: "GET", url: "/projects", headers: bearer(person) });
      return list.json<{ items: ProjectJson[] }>().items[0]?.id;
    };

    const patched = await api.patch(person, project.id, missing, { title: "X" }, '"1"');
    expect(patched.statusCode).toBe(404);
    expect(await topOfList()).toBe(newer.id);

    const removed = await api.remove(person, project.id, missing);
    expect(removed.statusCode).toBe(404);
    expect(await topOfList()).toBe(newer.id);
  });
});
