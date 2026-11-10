import { afterEach, describe, expect, it } from "vitest";
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
  const person = await newPerson(t.app);
  const project = await createdProject(t.app, person);
  const document = await createdDocument(t.app, person, project.id, { content: "one" });
  return { api: documentsApi(t.app), person, project, document };
}

describe("saving needs the version that was read", () => {
  it("answers 428 without If-Match and changes nothing", async () => {
    const { api, person, project, document } = await setup();
    const response = await api.patch(person, project.id, document.id, { content: "two" });
    expect(response.statusCode).toBe(428);
    expect(response.headers["content-type"]).toMatch(PROBLEM);
    expect(response.json()).toMatchObject({ type: "urn:plotpal:problem:precondition-required" });
    expect((await api.get(person, project.id, document.id)).json<DocumentJson>().content).toBe(
      "one",
    );
  });

  it.each([
    ["a star", "*"],
    ["a list", '"1", "2"'],
    ["no quotes", "1"],
    ["empty quotes", '""'],
    ["zero", '"0"'],
    ["a negative number", '"-1"'],
    ["a decimal", '"1.5"'],
    ["a leading zero", '"01"'],
    ["letters", '"abc"'],
    ["a number too large", '"9999999999"'],
    ["a space inside", '" 1"'],
    ["a lowercase weak marker", 'w/"1"'],
    ["an empty header", ""],
  ])("answers 400 for %s", async (_name, header) => {
    const { api, person, project, document } = await setup();
    const response = await api.patch(person, project.id, document.id, { content: "two" }, header);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      errors: [{ source: "headers", pointer: "/if-match" }],
    });
  });

  it("answers 412 for a version that is not the current one", async () => {
    const { api, person, project, document } = await setup();
    for (const header of ['"2"', '"99"']) {
      const response = await api.patch(person, project.id, document.id, { content: "x" }, header);
      expect(response.statusCode).toBe(412);
      expect(response.headers["content-type"]).toMatch(PROBLEM);
    }
    expect((await api.get(person, project.id, document.id)).json<DocumentJson>().content).toBe(
      "one",
    );
  });

  it("accepts the version as sent in ETag, and in the weak form a proxy may send back", async () => {
    const { api, person, project, document } = await setup();
    const first = await api.patch(person, project.id, document.id, { content: "two" }, '"1"');
    expect(first.statusCode).toBe(200);
    const second = await api.patch(person, project.id, document.id, { content: "three" }, 'W/"2"');
    expect(second.statusCode).toBe(200);
    expect(second.json<DocumentJson>().content).toBe("three");
  });

  it("adds 1 to the version on each save and sends it as ETag", async () => {
    const { api, person, project, document } = await setup();
    let etag = '"1"';
    for (let version = 2; version <= 4; version++) {
      const response = await api.patch(
        person,
        project.id,
        document.id,
        { title: `V${version}` },
        etag,
      );
      expect(response.statusCode).toBe(200);
      expect(response.json<DocumentJson>().version).toBe(version);
      etag = String(response.headers.etag);
      expect(etag).toBe(`"${version}"`);
    }
  });

  it("refuses the old version after a save (the lost-update case)", async () => {
    const { api, person, project, document } = await setup();
    await api.patch(person, project.id, document.id, { content: "tab one" }, '"1"');
    const late = await api.patch(person, project.id, document.id, { content: "tab two" }, '"1"');
    expect(late.statusCode).toBe(412);
    expect((await api.get(person, project.id, document.id)).json<DocumentJson>().content).toBe(
      "tab one",
    );
  });

  it("lets exactly one of two simultaneous saves win", async () => {
    const { api, person, project, document } = await setup();
    const [a, b] = await Promise.all([
      api.patch(person, project.id, document.id, { content: "from A" }, '"1"'),
      api.patch(person, project.id, document.id, { content: "from B" }, '"1"'),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 412]);
    const winner = a.statusCode === 200 ? "from A" : "from B";
    const stored = (await api.get(person, project.id, document.id)).json<DocumentJson>();
    expect(stored).toMatchObject({ content: winner, version: 2 });
  });

  it("lets exactly one of many simultaneous saves win", async () => {
    const { api, person, project, document } = await setup();
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        api.patch(person, project.id, document.id, { content: `from ${i}` }, '"1"'),
      ),
    );
    const codes = responses.map((response) => response.statusCode);
    expect(codes.filter((code) => code === 200)).toHaveLength(1);
    expect(codes.filter((code) => code === 412)).toHaveLength(7);
  });

  it("answers 404 before looking at the version of a document that does not exist", async () => {
    const { api, person, project } = await setup();
    const response = await api.patch(
      person,
      project.id,
      crypto.randomUUID(),
      { title: "X" },
      '"1"',
    );
    expect(response.statusCode).toBe(404);
  });

  it("tells a broken body first, then the missing header", async () => {
    const { api, person, project, document } = await setup();
    const response = await api.patch(person, project.id, document.id, { title: "" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ source: "body", pointer: "/title" }] });
  });

  it("answers 412, not 400, when the version is stale and the parent is also wrong", async () => {
    const { api, person, project, document } = await setup();
    await api.patch(person, project.id, document.id, { content: "two" }, '"1"');
    const response = await api.patch(
      person,
      project.id,
      document.id,
      { parentId: crypto.randomUUID() },
      '"1"',
    );
    expect(response.statusCode).toBe(412);
    expect(response.headers["content-type"]).toMatch(PROBLEM);
  });

  it("does not make another document's save stale when a sibling is moved", async () => {
    const { api, person, project, document } = await setup();
    const second = await createdDocument(t.app, person, project.id, { title: "Second" });
    // Insert at the front: both older items are renumbered, but their own versions stay 1.
    await createdDocument(t.app, person, project.id, { title: "Front", position: 0 });
    const stored = (await api.get(person, project.id, document.id)).json<DocumentJson>();
    expect(stored).toMatchObject({ position: 1, version: 1 });
    const storedSecond = (await api.get(person, project.id, second.id)).json<DocumentJson>();
    expect(storedSecond).toMatchObject({ position: 2, version: 1 });
    const save = await api.patch(person, project.id, document.id, { content: "still fine" }, '"1"');
    expect(save.statusCode).toBe(200);
  });

  it("counts a move of the item itself as a change", async () => {
    const { api, person, project, document } = await setup();
    await createdDocument(t.app, person, project.id, { title: "B" });
    const moved = await api.patch(person, project.id, document.id, { position: 1 }, '"1"');
    expect(moved.json<DocumentJson>()).toMatchObject({ position: 1, version: 2 });
  });

  it("recounts the words when the text is saved", async () => {
    const { api, person, project, document } = await setup();
    const saved = await api.patch(person, project.id, document.id, { content: "a b c d" }, '"1"');
    expect(saved.json<DocumentJson>().wordCount).toBe(4);
    const cleared = await api.patch(person, project.id, document.id, { content: "" }, '"2"');
    expect(cleared.json<DocumentJson>().wordCount).toBe(0);
  });

  it("changes nothing else when only the text is saved", async () => {
    const { api, person, project, document } = await setup();
    const saved = await api.patch(person, project.id, document.id, { content: "new" }, '"1"');
    expect(saved.json<DocumentJson>()).toMatchObject({
      title: document.title,
      position: document.position,
      parentId: document.parentId,
      createdAt: document.createdAt,
    });
  });
});
