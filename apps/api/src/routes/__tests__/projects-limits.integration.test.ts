import { count, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { projects } from "../../db/schema/projects.ts";
import { type AuthTestApp, buildAuthTestApp } from "../../test-support/auth-app.ts";
import {
  createdProject,
  newPerson,
  type Person,
  projectsApi,
} from "../../test-support/projects-api.ts";

const PROBLEM = /^application\/problem\+json/;

let t: AuthTestApp;
afterEach(async () => {
  await t.close();
});

async function app(max: number, windowSeconds = 60) {
  t = await buildAuthTestApp({ projectLimits: { writes: { max, windowSeconds } } });
  return projectsApi(t.app);
}

const rows = async (person: Person) =>
  (await t.handle.db.select({ n: count() }).from(projects).where(eq(projects.userId, person.id)))[0]
    ?.n;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("how often one person may change projects", () => {
  it("allows exactly the maximum and refuses the next one with 429", async () => {
    const api = await app(3);
    const person = await newPerson(t.app);
    for (let i = 0; i < 3; i++) {
      expect((await api.create(person, { title: `P${i}`, format: "prose" })).statusCode).toBe(201);
    }
    const refused = await api.create(person, { title: "P3", format: "prose" });
    expect(refused.statusCode).toBe(429);
    expect(refused.headers["content-type"]).toMatch(PROBLEM);
    expect(refused.json()).toMatchObject({ type: "urn:plotpal:problem:rate-limited", status: 429 });
  });

  it("tells how long to wait, in whole seconds within the window", async () => {
    const api = await app(1);
    const person = await newPerson(t.app);
    await api.create(person, { title: "One", format: "prose" });
    const refused = await api.create(person, { title: "Two", format: "prose" });
    const wait = Number(refused.headers["retry-after"]);
    expect(Number.isInteger(wait)).toBe(true);
    expect(wait).toBeGreaterThanOrEqual(1);
    expect(wait).toBeLessThanOrEqual(60);
  });

  it("does not create the project it refused", async () => {
    const api = await app(2);
    const person = await newPerson(t.app);
    for (let i = 0; i < 5; i++) await api.create(person, { title: `P${i}`, format: "prose" });
    expect(await rows(person)).toBe(2);
  });

  it("still lets the person read while writes are refused", async () => {
    const api = await app(1);
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    expect((await api.create(person, { title: "No", format: "prose" })).statusCode).toBe(429);
    expect((await api.list(person)).statusCode).toBe(200);
    expect((await api.get(person, project.id)).statusCode).toBe(200);
  });

  it("counts creating, changing and deleting together", async () => {
    const api = await app(3);
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    expect((await api.patch(person, project.id, { title: "Changed" })).statusCode).toBe(200);
    expect((await api.remove(person, project.id)).statusCode).toBe(204);
    expect((await api.create(person, { title: "Next", format: "prose" })).statusCode).toBe(429);
  });

  it("refuses a change and a delete too once the maximum is reached", async () => {
    const api = await app(1);
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    expect((await api.patch(person, project.id, { title: "No" })).statusCode).toBe(429);
    expect((await api.remove(person, project.id)).statusCode).toBe(429);
    expect((await api.get(person, project.id)).json()).toMatchObject({ title: "The Lighthouse" });
  });

  it("counts requests that were refused for another reason", async () => {
    const api = await app(3);
    const person = await newPerson(t.app);
    for (let i = 0; i < 3; i++) {
      expect((await api.create(person, { title: "", format: "prose" })).statusCode).toBe(400);
    }
    expect((await api.create(person, { title: "Fine", format: "prose" })).statusCode).toBe(429);
  });

  it("counts attempts on projects that belong to someone else", async () => {
    const api = await app(2);
    const [owner, intruder] = [await newPerson(t.app), await newPerson(t.app)];
    const project = await createdProject(t.app, owner);
    expect((await api.patch(intruder, project.id, { title: "x" })).statusCode).toBe(404);
    expect((await api.remove(intruder, project.id)).statusCode).toBe(404);
    expect((await api.remove(intruder, project.id)).statusCode).toBe(429);
  });

  it("keeps a separate count for each person", async () => {
    const api = await app(2);
    const [a, b] = [await newPerson(t.app), await newPerson(t.app)];
    for (let i = 0; i < 2; i++) await api.create(a, { title: `A${i}`, format: "prose" });
    expect((await api.create(a, { title: "A2", format: "prose" })).statusCode).toBe(429);
    expect((await api.create(b, { title: "B0", format: "prose" })).statusCode).toBe(201);
    expect((await api.create(b, { title: "B1", format: "prose" })).statusCode).toBe(201);
  });

  it("is not used up by requests without a valid token", async () => {
    const api = await app(2);
    const person = await newPerson(t.app);
    for (let i = 0; i < 10; i++) {
      const response = await t.app.inject({
        method: "POST",
        url: "/projects",
        payload: { title: "x", format: "prose" },
      });
      expect(response.statusCode).toBe(401);
    }
    expect((await api.create(person, { title: "One", format: "prose" })).statusCode).toBe(201);
    expect((await api.create(person, { title: "Two", format: "prose" })).statusCode).toBe(201);
  });

  it("starts again when the window has passed", async () => {
    const api = await app(1, 1);
    const person = await newPerson(t.app);
    expect((await api.create(person, { title: "One", format: "prose" })).statusCode).toBe(201);
    expect((await api.create(person, { title: "Two", format: "prose" })).statusCode).toBe(429);
    await sleep(1200);
    expect((await api.create(person, { title: "Three", format: "prose" })).statusCode).toBe(201);
  });

  it("is generous enough for normal use with the default limit", async () => {
    t = await buildAuthTestApp();
    const api = projectsApi(t.app);
    const person = await newPerson(t.app);
    for (let i = 0; i < 30; i++) {
      expect((await api.create(person, { title: `P${i}`, format: "prose" })).statusCode).toBe(201);
    }
  });

  it("does not log the title of a refused request", async () => {
    const api = await app(1);
    const person = await newPerson(t.app);
    await api.create(person, { title: "first", format: "prose" });
    await api.create(person, { title: "Refused-title-5521", format: "prose" });
    expect(t.logs.text).not.toContain("Refused-title-5521");
  });
});
