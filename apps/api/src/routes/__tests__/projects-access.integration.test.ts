import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projects } from "../../db/schema/projects.ts";
import { type AuthTestApp, buildAuthTestApp } from "../../test-support/auth-app.ts";
import {
  bearer,
  createdProject,
  type ListJson,
  newPerson,
  type ProjectJson,
  projectsApi,
} from "../../test-support/projects-api.ts";
import { testEnv } from "../../test-support/test-app.ts";

const PROBLEM = /^application\/problem\+json/;
const SECRET = testEnv().JWT_ACCESS_SECRET;
const SOME_ID = "019e5a3c-1b2d-7c4e-8f10-a1b2c3d4e5f6";

let t: AuthTestApp;
beforeAll(async () => {
  t = await buildAuthTestApp();
});
afterAll(async () => {
  await t.close();
});

async function tokenFor(userId: string, secret = SECRET, secondsFromNow = 600) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
    .setSubject(userId)
    .setIssuer("plotpal-api")
    .setAudience("plotpal-web")
    .setIssuedAt(now - (secondsFromNow < 0 ? 3600 : 0))
    .setExpirationTime(now + secondsFromNow)
    .sign(new TextEncoder().encode(secret));
}

const ROUTES = [
  ["list", "GET", "/projects", undefined],
  ["create", "POST", "/projects", { title: "T", format: "prose" }],
  ["get", "GET", `/projects/${SOME_ID}`, undefined],
  ["change", "PATCH", `/projects/${SOME_ID}`, { title: "T" }],
  ["delete", "DELETE", `/projects/${SOME_ID}`, undefined],
] as const;

describe("projects: you must be signed in", () => {
  it.each(ROUTES)("%s answers 401 without a token", async (_name, method, url, payload) => {
    const response = await t.app.inject({ method, url, ...(payload ? { payload } : {}) });
    expect(response.statusCode).toBe(401);
    expect(response.headers["content-type"]).toMatch(PROBLEM);
    expect(response.headers["www-authenticate"]).toBe("Bearer");
  });

  it.each([
    ["an empty header", ""],
    ["only the scheme", "Bearer"],
    ["a scheme that is not Bearer", "Basic dXNlcjpwYXNz"],
    ["a token that is not a token", "Bearer abc"],
    ["two tokens", "Bearer a.b.c d.e.f"],
    ["a token with a quote in it", 'Bearer "a.b.c"'],
  ])("answers 401 for %s", async (_name, authorization) => {
    const response = await t.app.inject({
      method: "GET",
      url: "/projects",
      headers: { authorization },
    });
    expect(response.statusCode).toBe(401);
  });

  it("answers 401 for an expired token", async () => {
    const person = await newPerson(t.app);
    const response = await t.app.inject({
      method: "GET",
      url: "/projects",
      headers: { authorization: `Bearer ${await tokenFor(person.id, SECRET, -60)}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it("answers 401 for a token signed with another secret", async () => {
    const person = await newPerson(t.app);
    const response = await t.app.inject({
      method: "GET",
      url: "/projects",
      headers: {
        authorization: `Bearer ${await tokenFor(person.id, "another-secret-of-32-characters!!")}`,
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it("checks the token before it looks at the body, so a bad body is not described to strangers", async () => {
    const response = await t.app.inject({
      method: "POST",
      url: "/projects",
      payload: { nothing: "valid" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).not.toHaveProperty("errors");
  });

  it("checks the token before it looks at the id", async () => {
    const response = await t.app.inject({ method: "GET", url: "/projects/not-a-uuid" });
    expect(response.statusCode).toBe(401);
  });
});

describe("projects: you only reach your own", () => {
  it("answers 404 when someone else reads your project", async () => {
    const [owner, other] = [await newPerson(t.app), await newPerson(t.app)];
    const mine = await createdProject(t.app, owner);
    const response = await projectsApi(t.app).get(other, mine.id);
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toMatch(PROBLEM);
  });

  it("answers 404 when someone else changes your project, and changes nothing", async () => {
    const [owner, other] = [await newPerson(t.app), await newPerson(t.app)];
    const mine = await createdProject(t.app, owner, { title: "Mine", logline: "Mine too" });
    const response = await projectsApi(t.app).patch(other, mine.id, {
      title: "Hijacked",
      format: "other",
      logline: null,
    });
    expect(response.statusCode).toBe(404);

    const [row] = await t.handle.db.select().from(projects).where(eq(projects.id, mine.id));
    expect(row).toMatchObject({ title: "Mine", format: "screenplay", logline: "Mine too" });
  });

  it("answers 404 when someone else deletes your project, and it stays", async () => {
    const [owner, other] = [await newPerson(t.app), await newPerson(t.app)];
    const mine = await createdProject(t.app, owner);
    const response = await projectsApi(t.app).remove(other, mine.id);
    expect(response.statusCode).toBe(404);
    expect((await projectsApi(t.app).get(owner, mine.id)).statusCode).toBe(200);
  });

  it("gives exactly the same answer for someone else's project as for one that does not exist", async () => {
    const [owner, other] = [await newPerson(t.app), await newPerson(t.app)];
    const mine = await createdProject(t.app, owner);
    const calls = [
      (id: string) => projectsApi(t.app).get(other, id),
      (id: string) => projectsApi(t.app).patch(other, id, { title: "x" }),
      (id: string) => projectsApi(t.app).remove(other, id),
    ];
    for (const call of calls) {
      const foreign = await call(mine.id);
      const missing = await call(SOME_ID);
      expect(foreign.statusCode).toBe(missing.statusCode);
      expect(foreign.headers["content-type"]).toBe(missing.headers["content-type"]);
      expect({ ...foreign.json(), instance: undefined }).toEqual({
        ...missing.json(),
        instance: undefined,
      });
    }
  });

  it("never lists someone else's projects", async () => {
    const [owner, other] = [await newPerson(t.app), await newPerson(t.app)];
    await createdProject(t.app, owner, { title: "Owner's secret" });
    const mine = await projectsApi(t.app).list(other);
    expect(mine.json<ListJson>()).toEqual({ items: [], nextCursor: null });
    expect(mine.body).not.toContain("Owner's secret");
  });

  it("keeps two people's lists apart when they own projects at the same time", async () => {
    const [a, b] = [await newPerson(t.app), await newPerson(t.app)];
    for (let i = 0; i < 3; i++) {
      await createdProject(t.app, a, { title: `A${i}` });
      await createdProject(t.app, b, { title: `B${i}` });
    }
    const listA = (await projectsApi(t.app).list(a)).json<ListJson>();
    const listB = (await projectsApi(t.app).list(b)).json<ListJson>();
    expect(listA.items.map((p) => p.title)).toEqual(["A2", "A1", "A0"]);
    expect(listB.items.map((p) => p.title)).toEqual(["B2", "B1", "B0"]);
  });

  it("does not let a body choose the owner", async () => {
    const [owner, other] = [await newPerson(t.app), await newPerson(t.app)];
    for (const field of ["userId", "user_id", "ownerId"]) {
      const response = await projectsApi(t.app).create(owner, {
        title: "Planted",
        format: "prose",
        [field]: other.id,
      });
      expect(response.statusCode).toBe(400);
    }
    const [planted] = await t.handle.db
      .select()
      .from(projects)
      .where(eq(projects.title, "Planted"));
    expect(planted).toBeUndefined();
  });

  it("does not let a change move a project to someone else", async () => {
    const [owner, other] = [await newPerson(t.app), await newPerson(t.app)];
    const mine = await createdProject(t.app, owner);
    const response = await projectsApi(t.app).patch(owner, mine.id, { userId: other.id });
    expect(response.statusCode).toBe(400);
    const [row] = await t.handle.db.select().from(projects).where(eq(projects.id, mine.id));
    expect(row?.userId).toBe(owner.id);
  });

  it("does not let a change rewrite the id or the dates", async () => {
    const owner = await newPerson(t.app);
    const mine = await createdProject(t.app, owner);
    for (const field of ["id", "createdAt", "updatedAt"]) {
      const response = await projectsApi(t.app).patch(owner, mine.id, {
        [field]: "2000-01-01T00:00:00.000Z",
      });
      expect(response.statusCode).toBe(400);
    }
    const after = (await projectsApi(t.app).get(owner, mine.id)).json<ProjectJson>();
    expect(after).toEqual(mine);
  });

  it("never shows the owner's id in an answer", async () => {
    const owner = await newPerson(t.app);
    const mine = await createdProject(t.app, owner);
    const bodies = [
      JSON.stringify(mine),
      (await projectsApi(t.app).list(owner)).body,
      (await projectsApi(t.app).get(owner, mine.id)).body,
      (await projectsApi(t.app).patch(owner, mine.id, { title: "Again" })).body,
    ];
    for (const body of bodies) {
      expect(body).not.toContain(owner.id);
      expect(body.toLowerCase()).not.toContain("userid");
      expect(body.toLowerCase()).not.toContain("user_id");
    }
  });

  it("still works for the owner after others tried", async () => {
    const [owner, other] = [await newPerson(t.app), await newPerson(t.app)];
    const mine = await createdProject(t.app, owner);
    await projectsApi(t.app).patch(other, mine.id, { title: "no" });
    await projectsApi(t.app).remove(other, mine.id);
    const response = await t.app.inject({
      method: "GET",
      url: `/projects/${mine.id}`,
      headers: bearer(owner),
    });
    expect(response.json<ProjectJson>()).toEqual(mine);
  });
});
