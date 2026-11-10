import { afterEach, describe, expect, it } from "vitest";
import { type AuthTestApp, buildAuthTestApp } from "../../test-support/auth-app.ts";
import {
  createdDocument,
  type DocumentJson,
  documentsApi,
  type OutlineJson,
  openConnections,
  outlineTitles,
} from "../../test-support/documents-api.ts";
import { createdProject, newPerson, type Person } from "../../test-support/projects-api.ts";

let t: AuthTestApp;
afterEach(async () => {
  await t.close();
});

async function setup() {
  t = await buildAuthTestApp();
  const person = await newPerson(t.app);
  const project = await createdProject(t.app, person);
  const make = (title: string, extra: Record<string, unknown> = {}) =>
    createdDocument(t.app, person, project.id, { title, ...extra });
  const titles = () => outlineTitles(t.app, person, project.id);
  return { api: documentsApi(t.app), person, project, make, titles };
}

/** Positions of every item as `title:position`, to check that they are gapless. */
async function positions(person: Person, projectId: string) {
  const response = await documentsApi(t.app).outline(person, projectId);
  return response.json<OutlineJson>().items.map((item) => `${item.title}:${item.position}`);
}

describe("the order of the outline", () => {
  it("lists each act followed by its scenes", async () => {
    const { make, titles } = await setup();
    const act1 = await make("Act 1");
    const act2 = await make("Act 2");
    await make("2a", { parentId: act2.id });
    await make("1a", { parentId: act1.id });
    await make("1b", { parentId: act1.id });
    expect(await titles()).toEqual(["Act 1", "1a", "1b", "Act 2", "2a"]);
  });

  it("inserts at a position and shifts the others down", async () => {
    const { person, project, make, titles } = await setup();
    await make("A");
    await make("B");
    await make("X", { position: 1 });
    await make("Front", { position: 0 });
    expect(await titles()).toEqual(["Front", "A", "X", "B"]);
    expect(await positions(person, project.id)).toEqual(["Front:0", "A:1", "X:2", "B:3"]);
  });

  it("accepts the position just past the end, and refuses one further", async () => {
    const { api, person, project, make, titles } = await setup();
    await make("A");
    const end = await api.create(person, project.id, { title: "End", position: 1 });
    expect(end.statusCode).toBe(201);
    const beyond = await api.create(person, project.id, { title: "Beyond", position: 3 });
    expect(beyond.statusCode).toBe(400);
    expect(beyond.json()).toMatchObject({ errors: [{ source: "body", pointer: "/position" }] });
    expect(await titles()).toEqual(["A", "End"]);
  });
});

describe("moving", () => {
  it("moves within the same parent, renumbering without gaps", async () => {
    const { api, person, project, make, titles } = await setup();
    const a = await make("A");
    await make("B");
    await make("C");
    const moved = await api.patch(person, project.id, a.id, { position: 2 }, '"1"');
    expect(moved.statusCode).toBe(200);
    expect(await titles()).toEqual(["B", "C", "A"]);
    expect(await positions(person, project.id)).toEqual(["B:0", "C:1", "A:2"]);
  });

  it("moves to the front", async () => {
    const { api, person, project, make, titles } = await setup();
    await make("A");
    await make("B");
    const c = await make("C");
    await api.patch(person, project.id, c.id, { position: 0 }, '"1"');
    expect(await titles()).toEqual(["C", "A", "B"]);
  });

  it("treats the position as counted without the item itself", async () => {
    const { api, person, project, make } = await setup();
    const a = await make("A");
    await make("B");
    const stay = await api.patch(person, project.id, a.id, { position: 0 }, '"1"');
    expect(stay.json<DocumentJson>().position).toBe(0);
    const tooFar = await api.patch(person, project.id, a.id, { position: 2 }, '"2"');
    expect(tooFar.statusCode).toBe(400);
    expect(tooFar.json()).toMatchObject({ errors: [{ pointer: "/position" }] });
  });

  it("moves under an act, at the end by default, and closes the gap it left", async () => {
    const { api, person, project, make, titles } = await setup();
    const act = await make("Act");
    await make("S1", { parentId: act.id });
    const loose = await make("Loose");
    await make("After");
    const moved = await api.patch(person, project.id, loose.id, { parentId: act.id }, '"1"');
    expect(moved.json<DocumentJson>()).toMatchObject({ parentId: act.id, position: 1 });
    expect(await titles()).toEqual(["Act", "S1", "Loose", "After"]);
    expect(await positions(person, project.id)).toEqual(["Act:0", "S1:0", "Loose:1", "After:1"]);
  });

  it("moves under an act at a chosen position", async () => {
    const { api, person, project, make, titles } = await setup();
    const act = await make("Act");
    await make("S1", { parentId: act.id });
    await make("S2", { parentId: act.id });
    const loose = await make("Loose");
    await api.patch(person, project.id, loose.id, { parentId: act.id, position: 1 }, '"1"');
    expect(await titles()).toEqual(["Act", "S1", "Loose", "S2"]);
  });

  it("moves a scene to the top level with null, at the end", async () => {
    const { api, person, project, make, titles } = await setup();
    const act = await make("Act");
    const scene = await make("Scene", { parentId: act.id });
    await make("Other");
    await api.patch(person, project.id, scene.id, { parentId: null }, '"1"');
    expect(await titles()).toEqual(["Act", "Other", "Scene"]);
    expect(await positions(person, project.id)).toEqual(["Act:0", "Other:1", "Scene:2"]);
  });

  it("moves a scene from one act to another", async () => {
    const { api, person, project, make, titles } = await setup();
    const one = await make("One");
    const two = await make("Two");
    const scene = await make("Scene", { parentId: one.id });
    await make("Keep", { parentId: one.id });
    await api.patch(person, project.id, scene.id, { parentId: two.id }, '"1"');
    expect(await titles()).toEqual(["One", "Keep", "Two", "Scene"]);
    expect(await positions(person, project.id)).toEqual(["One:0", "Keep:0", "Two:1", "Scene:0"]);
  });

  it("changes nothing when a move is refused", async () => {
    const { api, person, project, make, titles } = await setup();
    const a = await make("A");
    await make("B");
    const refused = await api.patch(
      person,
      project.id,
      a.id,
      { title: "Renamed", position: 9 },
      '"1"',
    );
    expect(refused.statusCode).toBe(400);
    expect(await titles()).toEqual(["A", "B"]);
    expect((await api.get(person, project.id, a.id)).json<DocumentJson>().version).toBe(1);
  });
});

describe("parents that are not allowed", () => {
  it("refuses a parent that does not exist", async () => {
    const { api, person, project } = await setup();
    const response = await api.create(person, project.id, {
      title: "X",
      parentId: crypto.randomUUID(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ source: "body", pointer: "/parentId" }] });
  });

  it("refuses a parent from another project", async () => {
    const { api, person, project, make } = await setup();
    const other = await createdProject(t.app, person, { title: "Other" });
    const foreign = await createdDocument(t.app, person, other.id, { title: "Foreign" });
    const response = await api.create(person, project.id, { title: "X", parentId: foreign.id });
    expect(response.statusCode).toBe(400);
    const doc = await make("Mine");
    const move = await api.patch(person, project.id, doc.id, { parentId: foreign.id }, '"1"');
    expect(move.statusCode).toBe(400);
  });

  it("refuses a parent of someone else's project", async () => {
    const { api, person, project } = await setup();
    const stranger = await newPerson(t.app);
    const theirs = await createdProject(t.app, stranger);
    const foreign = await createdDocument(t.app, stranger, theirs.id, { title: "Theirs" });
    const response = await api.create(person, project.id, { title: "X", parentId: foreign.id });
    expect(response.statusCode).toBe(400);
  });

  it("refuses to nest more than one level", async () => {
    const { api, person, project, make } = await setup();
    const act = await make("Act");
    const scene = await make("Scene", { parentId: act.id });
    const response = await api.create(person, project.id, { title: "Deep", parentId: scene.id });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ errors: { message: string }[] }>().errors[0]?.message).toMatch(
      /top-level/,
    );
  });

  it("refuses to make an item its own parent", async () => {
    const { api, person, project, make } = await setup();
    const act = await make("Act");
    const response = await api.patch(person, project.id, act.id, { parentId: act.id }, '"1"');
    expect(response.statusCode).toBe(400);
  });

  it("refuses to move an act with scenes under another act", async () => {
    const { api, person, project, make, titles } = await setup();
    const one = await make("One");
    const two = await make("Two");
    await make("Scene", { parentId: one.id });
    const response = await api.patch(person, project.id, one.id, { parentId: two.id }, '"1"');
    expect(response.statusCode).toBe(400);
    expect(await titles()).toEqual(["One", "Scene", "Two"]);
  });

  it("refuses a cycle: an act under its own scene", async () => {
    const { api, person, project, make } = await setup();
    const act = await make("Act");
    const scene = await make("Scene", { parentId: act.id });
    const response = await api.patch(person, project.id, act.id, { parentId: scene.id }, '"1"');
    expect(response.statusCode).toBe(400);
  });

  it("lets an act without scenes become a scene", async () => {
    const { api, person, project, make, titles } = await setup();
    const one = await make("One");
    const two = await make("Two");
    const response = await api.patch(person, project.id, two.id, { parentId: one.id }, '"1"');
    expect(response.statusCode).toBe(200);
    expect(response.json<DocumentJson>()).toMatchObject({ parentId: one.id, position: 0 });
    // The reading order is the same before and after, so the numbers tell the two apart.
    expect(await titles()).toEqual(["One", "Two"]);
    expect(await positions(person, project.id)).toEqual(["One:0", "Two:0"]);
  });
});

describe("changes at the same moment", () => {
  // The project lock makes the "read the siblings, then place" steps safe. Nothing in the table
  // stops two items sharing a position, so without the lock these runs end with duplicates.
  it("gives eight simultaneous creates the positions 0 to 7, each once", async () => {
    const { api, person, project } = await setup();
    await openConnections(t.handle.pool, 8);
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) => api.create(person, project.id, { title: `N${i}` })),
    );
    expect(responses.map((response) => response.statusCode)).toEqual(
      Array.from({ length: 8 }, () => 201),
    );
    const items = (await api.outline(person, project.id)).json<OutlineJson>().items;
    expect(items.map((item) => item.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(items.map((item) => item.title)).size).toBe(8);
  });

  it("keeps the positions gapless when creates at the front and a delete overlap", async () => {
    const { api, person, project, make } = await setup();
    const first = await make("First");
    await make("Second");
    await openConnections(t.handle.pool, 4);
    const responses = await Promise.all([
      api.create(person, project.id, { title: "F1", position: 0 }),
      api.create(person, project.id, { title: "F2", position: 0 }),
      api.create(person, project.id, { title: "F3", position: 0 }),
      api.remove(person, project.id, first.id),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([201, 201, 201, 204]);
    const items = (await api.outline(person, project.id)).json<OutlineJson>().items;
    expect(items.map((item) => item.position)).toEqual([0, 1, 2, 3]);
  });
});
