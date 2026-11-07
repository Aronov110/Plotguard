import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aiAnalyses } from "../../db/schema/ai-analyses.ts";
import { documents } from "../../db/schema/documents.ts";
import { projects } from "../../db/schema/projects.ts";
import { users } from "../../db/schema/users.ts";
import {
  insertAiAnalysis,
  insertDocument,
  insertProject,
} from "../../db/test-support/factories.ts";
import { type AuthTestApp, buildAuthTestApp } from "../../test-support/auth-app.ts";
import {
  createdProject,
  newPerson,
  type ProjectJson,
  projectsApi,
} from "../../test-support/projects-api.ts";

let t: AuthTestApp;
beforeAll(async () => {
  t = await buildAuthTestApp();
});
afterAll(async () => {
  await t.close();
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("POST /projects", () => {
  it("creates a project and answers 201 with it", async () => {
    const person = await newPerson(t.app);
    const response = await projectsApi(t.app).create(person, {
      title: "The Lighthouse",
      format: "screenplay",
      logline: "A keeper finds a letter.",
    });
    expect(response.statusCode).toBe(201);
    const project = response.json<ProjectJson>();
    expect(project).toEqual({
      id: expect.stringMatching(UUID),
      title: "The Lighthouse",
      format: "screenplay",
      logline: "A keeper finds a letter.",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(Object.keys(project).sort()).toEqual(
      ["createdAt", "format", "id", "logline", "title", "updatedAt"].sort(),
    );
  });

  it("says where the new project is", async () => {
    const person = await newPerson(t.app);
    const response = await projectsApi(t.app).create(person, { title: "T", format: "prose" });
    expect(response.headers.location).toBe(`/projects/${response.json<ProjectJson>().id}`);
  });

  it("writes the dates as UTC ISO 8601 and close to now", async () => {
    const person = await newPerson(t.app);
    const before = Date.now();
    const project = await createdProject(t.app, person);
    const created = Date.parse(project.createdAt);
    expect(project.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Math.abs(created - before)).toBeLessThan(10_000);
    expect(project.updatedAt).toBe(project.createdAt);
  });

  it.each(["screenplay", "prose", "other"] as const)("accepts the format %s", async (format) => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person, { format });
    expect(project.format).toBe(format);
  });

  it("leaves the logline empty when none is sent", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    expect(project.logline).toBeNull();
  });

  it.each([
    ["null", null],
    ["an empty text", ""],
    ["only spaces", "    "],
  ])("stores no logline for %s", async (_name, logline) => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person, { logline });
    expect(project.logline).toBeNull();
    const [row] = await t.handle.db.select().from(projects).where(eq(projects.id, project.id));
    expect(row?.logline).toBeNull();
  });

  it("removes spaces around the title and the logline", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person, {
      title: "  Padded title  ",
      logline: "\n Padded logline \t",
    });
    expect(project.title).toBe("Padded title");
    expect(project.logline).toBe("Padded logline");
  });

  it("allows two projects with the same title", async () => {
    const person = await newPerson(t.app);
    const first = await createdProject(t.app, person, { title: "Twin" });
    const second = await createdProject(t.app, person, { title: "Twin" });
    expect(first.id).not.toBe(second.id);
  });

  it("stores the longest allowed title and logline", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person, {
      title: "t".repeat(200),
      logline: "l".repeat(1000),
    });
    expect(project.title).toHaveLength(200);
    expect(project.logline).toHaveLength(1000);
  });

  it("stores 200 emoji as 200 characters, the way the database counts them", async () => {
    const person = await newPerson(t.app);
    const title = "😀".repeat(200);
    const project = await createdProject(t.app, person, { title });
    expect(project.title).toBe(title);
    const [row] = await t.handle.db.select().from(projects).where(eq(projects.id, project.id));
    expect([...(row?.title ?? "")]).toHaveLength(200);
  });

  it.each([
    ["accents", "Café Müller, Ñandú"],
    ["Chinese", "灯台守の手紙"],
    ["Arabic", "رسالة الفنار"],
    ["Hebrew", "מכתב מהמגדלור"],
    ["Cyrillic", "Письмо смотрителя"],
    ["a combining mark", "é"],
    ["a zero width joiner emoji", "👩‍👩‍👧‍👦"],
    ["quotes and markup", `<b>"Hi"</b> & 'bye'`],
    ["SQL-looking text", "x'); DROP TABLE projects; --"],
    ["a percent and a backslash", "100% \\ done"],
  ])("keeps %s exactly", async (_name, title) => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person, { title });
    expect(project.title).toBe(title.trim());
    const fetched = (await projectsApi(t.app).get(person, project.id)).json<ProjectJson>();
    expect(fetched.title).toBe(title.trim());
  });

  it("keeps line breaks inside a logline", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person, { logline: "Line one\nLine two" });
    expect(project.logline).toBe("Line one\nLine two");
  });

  it("does not break on a lone surrogate (invalid text) in a title", async () => {
    const person = await newPerson(t.app);
    const response = await projectsApi(t.app).create(
      person,
      '{"title":"a\\ud800b","format":"prose"}',
    );
    expect(response.statusCode).toBeLessThan(500);
  });

  it("creates nothing when the request is refused", async () => {
    const person = await newPerson(t.app);
    await projectsApi(t.app).create(person, { title: "", format: "prose" });
    await projectsApi(t.app).create(person, { title: "T", format: "poem" });
    const [total] = await t.handle.db
      .select({ n: count() })
      .from(projects)
      .where(eq(projects.userId, person.id));
    expect(total?.n).toBe(0);
  });
});

describe("GET /projects/:id", () => {
  it("returns the project as it was created", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person, { logline: "L" });
    const response = await projectsApi(t.app).get(person, project.id);
    expect(response.statusCode).toBe(200);
    expect(response.json<ProjectJson>()).toEqual(project);
  });

  it("answers 404 for an id that does not exist", async () => {
    const person = await newPerson(t.app);
    const response = await projectsApi(t.app).get(person, "019e5a3c-1b2d-7c4e-8f10-a1b2c3d4e5f6");
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      type: "urn:plotpal:problem:not-found",
      status: 404,
      detail: "There is no such project.",
    });
  });

  it("accepts the id in upper case", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    const response = await projectsApi(t.app).get(person, project.id.toUpperCase());
    expect(response.statusCode).toBe(200);
  });
});

describe("PATCH /projects/:id", () => {
  it("changes only the title", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person, { logline: "Keep me" });
    const response = await projectsApi(t.app).patch(person, project.id, { title: "New title" });
    expect(response.statusCode).toBe(200);
    expect(response.json<ProjectJson>()).toMatchObject({
      id: project.id,
      title: "New title",
      format: "screenplay",
      logline: "Keep me",
      createdAt: project.createdAt,
    });
  });

  it("changes only the format", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person, { format: "screenplay" });
    const changed = (
      await projectsApi(t.app).patch(person, project.id, { format: "prose" })
    ).json<ProjectJson>();
    expect(changed.format).toBe("prose");
    expect(changed.title).toBe(project.title);
  });

  it("sets a logline", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    const changed = (
      await projectsApi(t.app).patch(person, project.id, { logline: "Now set" })
    ).json<ProjectJson>();
    expect(changed.logline).toBe("Now set");
  });

  it.each([
    ["null", null],
    ["an empty text", ""],
    ["only spaces", "   "],
  ])("clears the logline with %s", async (_name, logline) => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person, { logline: "Will go" });
    const changed = (
      await projectsApi(t.app).patch(person, project.id, { logline })
    ).json<ProjectJson>();
    expect(changed.logline).toBeNull();
  });

  it("leaves the logline alone when it is not mentioned", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person, { logline: "Stays" });
    await projectsApi(t.app).patch(person, project.id, { title: "Other" });
    const fetched = (await projectsApi(t.app).get(person, project.id)).json<ProjectJson>();
    expect(fetched.logline).toBe("Stays");
  });

  it("changes everything at once", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    const changed = (
      await projectsApi(t.app).patch(person, project.id, {
        title: "All new",
        format: "other",
        logline: "All new too",
      })
    ).json<ProjectJson>();
    expect(changed).toMatchObject({ title: "All new", format: "other", logline: "All new too" });
  });

  it("moves the update time forward and keeps the creation time", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    await sleep(15);
    const changed = (
      await projectsApi(t.app).patch(person, project.id, { title: "Later" })
    ).json<ProjectJson>();
    expect(Date.parse(changed.updatedAt)).toBeGreaterThan(Date.parse(project.updatedAt));
    expect(changed.createdAt).toBe(project.createdAt);
  });

  it("accepts a change that sets the same values", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    const response = await projectsApi(t.app).patch(person, project.id, { title: project.title });
    expect(response.statusCode).toBe(200);
  });

  it("trims the new title", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    const changed = (
      await projectsApi(t.app).patch(person, project.id, { title: "  Trim  " })
    ).json<ProjectJson>();
    expect(changed.title).toBe("Trim");
  });

  it("answers 404 for an id that does not exist", async () => {
    const person = await newPerson(t.app);
    const response = await projectsApi(t.app).patch(
      person,
      "019e5a3c-1b2d-7c4e-8f10-a1b2c3d4e5f6",
      {
        title: "x",
      },
    );
    expect(response.statusCode).toBe(404);
  });

  it.each([
    ["no field", {}],
    ["only an unknown field", { colour: "red" }],
    ["a blank title", { title: "   " }],
    ["an unknown format", { format: "poem" }],
    ["a too long logline", { logline: "x".repeat(1001) }],
  ])("answers 400 and changes nothing for %s", async (_name, body) => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    const response = await projectsApi(t.app).patch(person, project.id, body);
    expect(response.statusCode).toBe(400);
    const fetched = (await projectsApi(t.app).get(person, project.id)).json<ProjectJson>();
    expect(fetched).toEqual(project);
  });

  it("changes nothing when one of several fields is wrong", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    const response = await projectsApi(t.app).patch(person, project.id, {
      title: "Would be fine",
      format: "poem",
    });
    expect(response.statusCode).toBe(400);
    const fetched = (await projectsApi(t.app).get(person, project.id)).json<ProjectJson>();
    expect(fetched.title).toBe(project.title);
  });
});

describe("DELETE /projects/:id", () => {
  it("deletes the project and answers 204 with no body", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    const response = await projectsApi(t.app).remove(person, project.id);
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(response.headers["content-type"]).toBeUndefined();
    expect((await projectsApi(t.app).get(person, project.id)).statusCode).toBe(404);
  });

  it("answers 404 the second time", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    await projectsApi(t.app).remove(person, project.id);
    expect((await projectsApi(t.app).remove(person, project.id)).statusCode).toBe(404);
  });

  it("answers 404 for an id that never existed", async () => {
    const person = await newPerson(t.app);
    const response = await projectsApi(t.app).remove(
      person,
      "019e5a3c-1b2d-7c4e-8f10-a1b2c3d4e5f6",
    );
    expect(response.statusCode).toBe(404);
  });

  it("removes the project from the list", async () => {
    const person = await newPerson(t.app);
    const keep = await createdProject(t.app, person, { title: "Keep" });
    const drop = await createdProject(t.app, person, { title: "Drop" });
    await projectsApi(t.app).remove(person, drop.id);
    const items = (await projectsApi(t.app).list(person)).json<{ items: ProjectJson[] }>().items;
    expect(items.map((p) => p.id)).toEqual([keep.id]);
  });

  it("deletes its documents and analyses with it, and nothing else", async () => {
    const person = await newPerson(t.app);
    const other = await newPerson(t.app);
    const doomed = await createdProject(t.app, person, { title: "Doomed" });
    const spared = await createdProject(t.app, person, { title: "Spared" });
    const othersProject = await createdProject(t.app, other, { title: "Others" });

    const act = await insertDocument(t.handle.db, doomed.id, { title: "Act 1" });
    await insertDocument(t.handle.db, doomed.id, {
      title: "Scene 1",
      parentId: act.id,
      position: 0,
    });
    await insertAiAnalysis(t.handle.db, person.id, doomed.id);
    await insertDocument(t.handle.db, spared.id);
    await insertAiAnalysis(t.handle.db, person.id, spared.id);
    await insertDocument(t.handle.db, othersProject.id);

    expect((await projectsApi(t.app).remove(person, doomed.id)).statusCode).toBe(204);

    const docsOf = async (projectId: string) =>
      (
        await t.handle.db
          .select({ n: count() })
          .from(documents)
          .where(eq(documents.projectId, projectId))
      )[0]?.n;
    const analysesOf = async (projectId: string) =>
      (
        await t.handle.db
          .select({ n: count() })
          .from(aiAnalyses)
          .where(eq(aiAnalyses.projectId, projectId))
      )[0]?.n;
    expect(await docsOf(doomed.id)).toBe(0);
    expect(await analysesOf(doomed.id)).toBe(0);
    expect(await docsOf(spared.id)).toBe(1);
    expect(await analysesOf(spared.id)).toBe(1);
    expect(await docsOf(othersProject.id)).toBe(1);
  });

  it("keeps the person's account", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    await projectsApi(t.app).remove(person, project.id);
    const [row] = await t.handle.db.select().from(users).where(eq(users.id, person.id));
    expect(row).toBeDefined();
  });
});

describe("the whole life of a project", () => {
  it("can be created, listed, changed and deleted by its owner", async () => {
    const person = await newPerson(t.app);
    const api = projectsApi(t.app);
    const project = await createdProject(t.app, person, { title: "Draft", format: "prose" });
    expect((await api.list(person)).json<{ items: ProjectJson[] }>().items).toHaveLength(1);
    await api.patch(person, project.id, { title: "Final" });
    expect((await api.get(person, project.id)).json<ProjectJson>().title).toBe("Final");
    expect((await api.remove(person, project.id)).statusCode).toBe(204);
    expect((await api.list(person)).json<{ items: ProjectJson[] }>().items).toEqual([]);
  });

  it("works on projects that were put into the database directly", async () => {
    const person = await newPerson(t.app);
    const row = await insertProject(t.handle.db, person.id, { title: "From the database" });
    const response = await projectsApi(t.app).get(person, row.id);
    expect(response.json<ProjectJson>()).toMatchObject({ id: row.id, title: "From the database" });
  });
});

describe("answers about projects", () => {
  it("are marked as private and not to be stored", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    const responses = [
      await projectsApi(t.app).list(person),
      await projectsApi(t.app).get(person, project.id),
      await projectsApi(t.app).get(person, "019e5a3c-1b2d-7c4e-8f10-a1b2c3d4e5f6"),
      await projectsApi(t.app).create(person, { title: "", format: "prose" }),
    ];
    for (const response of responses) {
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
  });
});

describe("the API reference", () => {
  it("lists the five project routes, each needing the access token", async () => {
    const response = await t.app.inject({ method: "GET", url: "/docs/openapi.json" });
    const doc = response.json<{
      paths: Record<string, Record<string, { tags?: string[]; security?: unknown }>>;
      tags?: { name: string }[];
    }>();
    const operations: [string, string][] = [
      ["/projects", "get"],
      ["/projects", "post"],
      ["/projects/{id}", "get"],
      ["/projects/{id}", "patch"],
      ["/projects/{id}", "delete"],
    ];
    for (const [path, method] of operations) {
      const operation = doc.paths[path]?.[method];
      expect(operation, `${method} ${path}`).toBeDefined();
      expect(operation?.tags).toEqual(["projects"]);
      expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    }
    expect(doc.tags?.map((tag) => tag.name)).toContain("projects");
  });

  it("describes the list parameters", async () => {
    const response = await t.app.inject({ method: "GET", url: "/docs/openapi.json" });
    const doc = response.json<{
      paths: Record<string, Record<string, { parameters?: { name: string; in: string }[] }>>;
    }>();
    const names = doc.paths["/projects"]?.get?.parameters?.map((p) => `${p.in}:${p.name}`);
    expect(names).toEqual(expect.arrayContaining(["query:limit", "query:cursor"]));
  });
});
