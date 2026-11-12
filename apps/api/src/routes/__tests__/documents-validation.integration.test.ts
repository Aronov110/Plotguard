import { afterEach, describe, expect, it } from "vitest";
import { documents } from "../../db/schema/documents.ts";
import { type AuthTestApp, buildAuthTestApp } from "../../test-support/auth-app.ts";
import {
  createdDocument,
  type DocumentJson,
  documentsApi,
} from "../../test-support/documents-api.ts";
import { bearer, createdProject, newPerson } from "../../test-support/projects-api.ts";

const PROBLEM = /^application\/problem\+json/;

let t: AuthTestApp;
afterEach(async () => {
  await t.close();
});

async function setup() {
  t = await buildAuthTestApp();
  const person = await newPerson(t.app);
  const project = await createdProject(t.app, person);
  const document = await createdDocument(t.app, person, project.id);
  const raw = (method: "POST" | "PATCH", payload: string, contentType = "application/json") =>
    t.app.inject({
      method,
      url:
        method === "POST"
          ? `/projects/${project.id}/documents`
          : `/projects/${project.id}/documents/${document.id}`,
      headers: { ...bearer(person), "content-type": contentType, "if-match": '"1"' },
      payload,
    });
  return { api: documentsApi(t.app), person, project, document, raw };
}

const stored = async () => (await t.handle.db.select().from(documents)).length;

describe("titles follow the project rules", () => {
  it.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["201 characters", "x".repeat(201)],
    ["a NUL character", "bad\u0000title"],
    ["not a string", 5],
    ["null", null],
  ])("refuses a title that is %s", async (_name, title) => {
    const { api, person, project } = await setup();
    const response = await api.create(person, project.id, { title });
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toMatch(PROBLEM);
    expect(response.json()).toMatchObject({ errors: [{ source: "body", pointer: "/title" }] });
    expect(await stored()).toBe(1);
  });

  it("accepts 200 characters, counting an emoji as one", async () => {
    const { api, person, project } = await setup();
    expect((await api.create(person, project.id, { title: "x".repeat(200) })).statusCode).toBe(201);
    expect((await api.create(person, project.id, { title: "😀".repeat(200) })).statusCode).toBe(
      201,
    );
    expect((await api.create(person, project.id, { title: "😀".repeat(201) })).statusCode).toBe(
      400,
    );
  });

  it("refuses a missing title", async () => {
    const { api, person, project } = await setup();
    expect((await api.create(person, project.id, {})).statusCode).toBe(400);
  });

  it("refuses a broken emoji (a lone surrogate half) in a new title instead of changing it", async () => {
    const { raw } = await setup();
    const response = await raw("POST", '{"title":"broken \\ud83d title"}');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ source: "body", pointer: "/title" }] });
    expect(await stored()).toBe(1);
  });

  it("refuses a broken emoji in a changed title, and the title stays as it was", async () => {
    const { api, raw, person, project, document } = await setup();
    const response = await raw("PATCH", '{"title":"broken \\ude00 title"}');
    expect(response.statusCode).toBe(400);
    const read = await api.get(person, project.id, document.id);
    expect(read.json<{ title: string }>().title).toBe(document.title);
  });
});

describe("the text of a document", () => {
  it("accepts 0, and exactly 200,000 characters", async () => {
    const { api, person, project, document } = await setup();
    const empty = await api.patch(person, project.id, document.id, { content: "" }, '"1"');
    expect(empty.statusCode).toBe(200);
    const full = await api.patch(
      person,
      project.id,
      document.id,
      { content: "a".repeat(200_000) },
      '"2"',
    );
    expect(full.statusCode).toBe(200);
    const read = await api.get(person, project.id, document.id);
    expect(read.json<DocumentJson>().content).toHaveLength(200_000);
  });

  it("refuses 200,001 characters and changes nothing", async () => {
    const { api, person, project, document } = await setup();
    const response = await api.patch(
      person,
      project.id,
      document.id,
      { content: "a".repeat(200_001) },
      '"1"',
    );
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ source: "body", pointer: "/content" }] });
    expect((await api.get(person, project.id, document.id)).json<DocumentJson>().version).toBe(1);
  });

  it("counts an emoji as one character, so 200,000 emoji fit and 200,001 do not", async () => {
    const { api, person, project, document } = await setup();
    const fits = await api.patch(
      person,
      project.id,
      document.id,
      { content: "😀".repeat(200_000) },
      '"1"',
    );
    expect(fits.statusCode).toBe(200);
    const tooMany = await api.patch(
      person,
      project.id,
      document.id,
      { content: "😀".repeat(200_001) },
      '"2"',
    );
    expect(tooMany.statusCode).toBe(400);
  });

  it("accepts the worst-case body: 200,000 emoji written as escape pairs (about 2.4 MB)", async () => {
    const { person, project, document, raw, api } = await setup();
    const body = `{"content":"${"\\ud83d\\ude00".repeat(200_000)}"}`;
    expect(body.length).toBeGreaterThan(2_000_000);
    const response = await raw("PATCH", body);
    expect(response.statusCode).toBe(200);
    const read = await api.get(person, project.id, document.id);
    expect([...read.json<DocumentJson>().content]).toHaveLength(200_000);
  });

  it("answers 413 above 2.5 MiB, and changes nothing", async () => {
    const { api, person, project, document, raw } = await setup();
    const response = await raw("PATCH", `{"content":"${"a".repeat(2_700_000)}"}`);
    expect(response.statusCode).toBe(413);
    expect(response.headers["content-type"]).toMatch(PROBLEM);
    expect((await api.get(person, project.id, document.id)).json<DocumentJson>().version).toBe(1);
  });

  it("answers 413 above 2.5 MiB on create too", async () => {
    const { raw } = await setup();
    const response = await raw("POST", `{"title":"x","content":"${"a".repeat(2_700_000)}"}`);
    expect(response.statusCode).toBe(413);
  });

  it("keeps the text exactly as sent: no trimming, no cleaning", async () => {
    const { api, person, project, document } = await setup();
    const text = "  <script>alert(1)</script>\r\n\ttabs &amp; \u00e9\u0301\u0301 \u202e  ";
    const response = await api.patch(person, project.id, document.id, { content: text }, '"1"');
    expect(response.json<DocumentJson>().content).toBe(text);
    const read = await api.get(person, project.id, document.id);
    expect(read.json<DocumentJson>().content).toBe(text);
  });

  it("refuses a NUL character", async () => {
    const { api, person, project, document } = await setup();
    const response = await api.patch(
      person,
      project.id,
      document.id,
      { content: "a\u0000b" },
      '"1"',
    );
    expect(response.statusCode).toBe(400);
  });

  it("refuses a lone surrogate instead of silently changing it", async () => {
    const { api, person, project, document, raw } = await setup();
    const response = await raw("PATCH", '{"content":"broken \\ud83d emoji"}');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ pointer: "/content" }] });
    const read = await api.get(person, project.id, document.id);
    expect(read.json<DocumentJson>().content).toBe("");
  });

  it("refuses text that is not a string", async () => {
    const { api, person, project, document } = await setup();
    for (const content of [5, null, ["a"], { a: 1 }]) {
      const response = await api.patch(person, project.id, document.id, { content }, '"1"');
      expect(response.statusCode).toBe(400);
    }
  });
});

describe("the shape of the request", () => {
  it("refuses unknown fields, so nobody can set the version or the owner", async () => {
    const { api, person, project, document } = await setup();
    for (const extra of [
      { version: 99 },
      { projectId: crypto.randomUUID() },
      { id: crypto.randomUUID() },
      { wordCount: 5 },
      { createdAt: "2000-01-01T00:00:00Z" },
    ]) {
      const create = await api.create(person, project.id, { title: "X", ...extra });
      expect(create.statusCode).toBe(400);
      const patch = await api.patch(
        person,
        project.id,
        document.id,
        { title: "Y", ...extra },
        '"1"',
      );
      expect(patch.statusCode).toBe(400);
    }
    expect(await stored()).toBe(1);
  });

  it("refuses an empty PATCH", async () => {
    const { api, person, project, document } = await setup();
    const response = await api.patch(person, project.id, document.id, {}, '"1"');
    expect(response.statusCode).toBe(400);
  });

  it("refuses a body that is not JSON, or not an object", async () => {
    const { raw } = await setup();
    expect((await raw("POST", "{not json")).statusCode).toBe(400);
    expect((await raw("POST", '["x"]')).statusCode).toBe(400);
    expect((await raw("POST", "null")).statusCode).toBe(400);
  });

  it("answers 415 for a content type other than JSON", async () => {
    const { raw } = await setup();
    expect((await raw("POST", '{"title":"x"}', "text/plain")).statusCode).toBe(415);
    expect((await raw("POST", "title=x", "application/x-www-form-urlencoded")).statusCode).toBe(
      415,
    );
  });

  it.each([
    ["a decimal", 1.5],
    ["negative", -1],
    ["a string", "1"],
    ["huge", 1_000_000],
    ["null", null],
  ])("refuses a position that is %s", async (_name, position) => {
    const { api, person, project } = await setup();
    const response = await api.create(person, project.id, { title: "X", position });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ pointer: "/position" }] });
  });

  it("refuses a parent id that is not a UUID", async () => {
    const { api, person, project } = await setup();
    const response = await api.create(person, project.id, { title: "X", parentId: "nope" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ pointer: "/parentId" }] });
  });

  it("does not echo the submitted text in an error", async () => {
    const { api, person, project, document } = await setup();
    const response = await api.patch(
      person,
      project.id,
      document.id,
      { content: `SECRET-STORY${"a".repeat(200_001)}` },
      '"1"',
    );
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain("SECRET-STORY");
  });
});
