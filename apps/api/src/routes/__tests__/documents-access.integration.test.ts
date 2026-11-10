import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { documents } from "../../db/schema/documents.ts";
import { type AuthTestApp, buildAuthTestApp } from "../../test-support/auth-app.ts";
import {
  createdDocument,
  type DocumentJson,
  documentsApi,
} from "../../test-support/documents-api.ts";
import { createdProject, newPerson } from "../../test-support/projects-api.ts";

const PROBLEM = /^application\/problem\+json/;

let t: AuthTestApp;
afterEach(async () => {
  await t.close();
});

async function setup() {
  t = await buildAuthTestApp();
  const owner = await newPerson(t.app);
  const stranger = await newPerson(t.app);
  const project = await createdProject(t.app, owner);
  const document = await createdDocument(t.app, owner, project.id, { content: "Secret text" });
  return { api: documentsApi(t.app), owner, stranger, project, document };
}

describe("who can reach documents", () => {
  it("answers 401 without a token on every route", async () => {
    const { project, document } = await setup();
    const base = `/projects/${project.id}/documents`;
    const calls = [
      { method: "GET", url: base },
      { method: "POST", url: base, payload: { title: "X" } },
      { method: "GET", url: `${base}/${document.id}` },
      { method: "PATCH", url: `${base}/${document.id}`, payload: { title: "X" } },
      { method: "DELETE", url: `${base}/${document.id}` },
    ] as const;
    for (const call of calls) {
      const response = await t.app.inject(call);
      expect(response.statusCode, `${call.method} ${call.url}`).toBe(401);
      expect(response.headers["content-type"]).toMatch(PROBLEM);
    }
  });

  it("answers 401 with a bad token, before it looks at the body", async () => {
    const { project } = await setup();
    const response = await t.app.inject({
      method: "POST",
      url: `/projects/${project.id}/documents`,
      headers: { authorization: "Bearer not-a-token" },
      payload: { nonsense: true },
    });
    expect(response.statusCode).toBe(401);
  });

  it("answers 404 for every route on the project of someone else", async () => {
    const { api, stranger, project, document } = await setup();
    const responses = [
      await api.outline(stranger, project.id),
      await api.create(stranger, project.id, { title: "Planted" }),
      await api.get(stranger, project.id, document.id),
      await api.patch(stranger, project.id, document.id, { title: "Hacked" }, '"1"'),
      await api.remove(stranger, project.id, document.id),
    ];
    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).toMatch(PROBLEM);
      expect(response.body).not.toContain("Secret text");
    }
  });

  it("changes nothing when someone else tries to write", async () => {
    const { api, owner, stranger, project, document } = await setup();
    await api.patch(stranger, project.id, document.id, { title: "Hacked" }, '"1"');
    await api.create(stranger, project.id, { title: "Planted" });
    await api.remove(stranger, project.id, document.id);

    const rows = await t.handle.db.select().from(documents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Act One", content: "Secret text", version: 1 });
    expect((await api.get(owner, project.id, document.id)).statusCode).toBe(200);
  });

  it("does not move the project of someone else to the top of their list", async () => {
    const { api, owner, stranger, project } = await setup();
    const before = (
      await t.app.inject({
        method: "GET",
        url: `/projects/${project.id}`,
        headers: { authorization: `Bearer ${owner.token}` },
      })
    ).json<{ updatedAt: string }>().updatedAt;
    await api.create(stranger, project.id, { title: "Planted" });
    const after = (
      await t.app.inject({
        method: "GET",
        url: `/projects/${project.id}`,
        headers: { authorization: `Bearer ${owner.token}` },
      })
    ).json<{ updatedAt: string }>().updatedAt;
    expect(after).toBe(before);
  });

  it("answers 404 for a document reached through another project of the same owner", async () => {
    const { api, owner, document } = await setup();
    const other = await createdProject(t.app, owner, { title: "Other" });
    for (const response of [
      await api.get(owner, other.id, document.id),
      await api.patch(owner, other.id, document.id, { title: "Moved" }, '"1"'),
      await api.remove(owner, other.id, document.id),
    ]) {
      expect(response.statusCode).toBe(404);
    }
    const [row] = await t.handle.db.select().from(documents).where(eq(documents.id, document.id));
    expect(row).toMatchObject({ title: "Act One", version: 1 });
  });

  it("answers 404 for ids that do not exist", async () => {
    const { api, owner, project } = await setup();
    expect((await api.get(owner, project.id, randomUUID())).statusCode).toBe(404);
    expect((await api.outline(owner, randomUUID())).statusCode).toBe(404);
    expect((await api.remove(owner, project.id, randomUUID())).statusCode).toBe(404);
    expect(
      (await api.patch(owner, project.id, randomUUID(), { title: "X" }, '"1"')).statusCode,
    ).toBe(404);
  });

  it("answers 400 for ids that are not UUIDs", async () => {
    const { api, owner, project } = await setup();
    expect((await api.get(owner, project.id, "not-a-uuid")).statusCode).toBe(400);
    expect((await api.outline(owner, "not-a-uuid")).statusCode).toBe(400);
  });

  it("does not let a stranger read a document by guessing its id in their own project", async () => {
    const { api, stranger, document } = await setup();
    const own = await createdProject(t.app, stranger, { title: "Mine" });
    const response = await api.get(stranger, own.id, document.id);
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("Secret text");
  });

  it("deletes the documents with their project", async () => {
    const { owner, project } = await setup();
    const removed = await t.app.inject({
      method: "DELETE",
      url: `/projects/${project.id}`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(removed.statusCode).toBe(204);
    expect(await t.handle.db.select().from(documents)).toHaveLength(0);
  });

  it("sends private, no-store on success and on errors", async () => {
    const { api, owner, stranger, project, document } = await setup();
    const ok = await api.get(owner, project.id, document.id);
    const refused = await api.get(stranger, project.id, document.id);
    expect(ok.headers["cache-control"]).toBe("private, no-store");
    expect(refused.headers["cache-control"]).toBe("private, no-store");
    expect((ok.json() as DocumentJson).content).toBe("Secret text");
  });
});

describe("the API reference", () => {
  it("lists the five document routes, each needing the access token", async () => {
    await setup();
    const response = await t.app.inject({ method: "GET", url: "/docs/openapi.json" });
    const doc = response.json<{
      paths: Record<
        string,
        Record<
          string,
          { tags?: string[]; security?: unknown; parameters?: { name: string; in: string }[] }
        >
      >;
      tags?: { name: string }[];
    }>();
    const base = "/projects/{projectId}/documents";
    const operations: [string, string][] = [
      [base, "get"],
      [base, "post"],
      [`${base}/{id}`, "get"],
      [`${base}/{id}`, "patch"],
      [`${base}/{id}`, "delete"],
    ];
    for (const [path, method] of operations) {
      const operation = doc.paths[path]?.[method];
      expect(operation, `${method} ${path}`).toBeDefined();
      expect(operation?.tags).toEqual(["documents"]);
      expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    }
    expect(doc.tags?.map((tag) => tag.name)).toContain("documents");
    const headers = doc.paths[`${base}/{id}`]?.patch?.parameters?.map((p) => `${p.in}:${p.name}`);
    expect(headers).toContain("header:if-match");
  });
});
