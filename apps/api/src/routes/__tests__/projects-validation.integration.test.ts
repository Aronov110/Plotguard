import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projects } from "../../db/schema/projects.ts";
import { type AuthTestApp, buildAuthTestApp } from "../../test-support/auth-app.ts";
import {
  bearer,
  createdProject,
  newPerson,
  type Person,
  type ProjectJson,
  projectsApi,
} from "../../test-support/projects-api.ts";

const PROBLEM = /^application\/problem\+json/;
const SOME_ID = "019e5a3c-1b2d-7c4e-8f10-a1b2c3d4e5f6";
const PINO_ERROR = 50;

let t: AuthTestApp;
beforeAll(async () => {
  t = await buildAuthTestApp();
});
afterAll(async () => {
  await t.close();
});

/** Sends a raw body with a content type the test chooses. */
function sendRaw(
  person: Person,
  method: "POST" | "PATCH",
  url: string,
  body: string,
  type: string,
) {
  return t.app.inject({
    method,
    url,
    headers: { ...bearer(person), "content-type": type },
    payload: body,
  });
}

const projectCount = async (person: Person) =>
  (await t.handle.db.select({ n: count() }).from(projects).where(eq(projects.userId, person.id)))[0]
    ?.n;

/** Error-level log lines written since `since` (an index into the log). Means a 500 or worse. */
const errorLinesSince = (since: number) =>
  t.logs.entries.slice(since).filter((entry) => Number(entry.level) >= PINO_ERROR);

describe("a refused request is explained as a Problem Details answer", () => {
  it("names the field and says what is wrong", async () => {
    const person = await newPerson(t.app);
    const response = await projectsApi(t.app).create(person, { title: "", format: "prose" });
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toMatch(PROBLEM);
    expect(response.json()).toMatchObject({
      type: "urn:plotpal:problem:validation-error",
      status: 400,
      errors: [{ source: "body", pointer: "/title", message: "Enter a title." }],
    });
  });

  it("reports every problem at once", async () => {
    const person = await newPerson(t.app);
    const response = await projectsApi(t.app).create(person, {
      title: "   ",
      format: "poem",
      logline: "x".repeat(1001),
    });
    const pointers = response
      .json<{ errors: { pointer: string }[] }>()
      .errors.map((error) => error.pointer)
      .sort();
    expect(pointers).toEqual(["/format", "/logline", "/title"]);
  });

  it("explains a missing field", async () => {
    const person = await newPerson(t.app);
    const response = await projectsApi(t.app).create(person, { title: "T" });
    expect(response.json<{ errors: { pointer: string }[] }>().errors[0]?.pointer).toBe("/format");
  });

  it("explains an unknown field", async () => {
    const person = await newPerson(t.app);
    const response = await projectsApi(t.app).create(person, {
      title: "T",
      format: "prose",
      mood: "dark",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty("errors");
  });

  it("explains an empty change", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    const response = await projectsApi(t.app).patch(person, project.id, {});
    expect(response.json<{ errors: { message: string }[] }>().errors[0]?.message).toBe(
      "Send at least one of title, format or logline.",
    );
  });

  it("never repeats what the person sent", async () => {
    const person = await newPerson(t.app);
    const marker = "MARKER-should-not-come-back-7731";
    const response = await projectsApi(t.app).create(person, {
      title: marker,
      format: marker,
      logline: marker.repeat(100),
      extra: marker,
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain(marker);
  });

  it("does not show a stack trace or a file path", async () => {
    const person = await newPerson(t.app);
    const response = await projectsApi(t.app).create(person, { title: 5, format: "prose" });
    expect(response.body).not.toMatch(/at .*\(.*:\d+:\d+\)/);
    expect(response.body).not.toContain("node_modules");
  });
});

describe("a body that is not the expected JSON", () => {
  it.each([
    ["plain text", "text/plain"],
    ["a form", "application/x-www-form-urlencoded"],
    ["XML", "application/xml"],
    ["multipart", "multipart/form-data; boundary=x"],
  ])("answers 415 for %s", async (_name, type) => {
    const person = await newPerson(t.app);
    const response = await sendRaw(person, "POST", "/projects", "title=T&format=prose", type);
    expect(response.statusCode).toBe(415);
    expect(await projectCount(person)).toBe(0);
  });

  it("answers 415 for a change that is plain text", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    const response = await sendRaw(
      person,
      "PATCH",
      `/projects/${project.id}`,
      "title=x",
      "text/plain",
    );
    expect(response.statusCode).toBe(415);
  });

  it.each([
    ["broken JSON", "{"],
    ["a trailing comma", '{"title":"T","format":"prose",}'],
    ["single quotes", "{'title':'T','format':'prose'}"],
    ["an empty body", ""],
  ])("answers 400 for %s", async (_name, body) => {
    const person = await newPerson(t.app);
    const response = await sendRaw(person, "POST", "/projects", body, "application/json");
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toMatch(PROBLEM);
    expect(await projectCount(person)).toBe(0);
  });

  it.each([
    ["null", "null"],
    ["an array", "[]"],
    ["an array of projects", '[{"title":"T","format":"prose"}]'],
    ["a number", "5"],
    ["a string", '"text"'],
    ["true", "true"],
  ])("answers 400 for JSON that is %s", async (_name, body) => {
    const person = await newPerson(t.app);
    const response = await sendRaw(person, "POST", "/projects", body, "application/json");
    expect(response.statusCode).toBe(400);
    expect(await projectCount(person)).toBe(0);
  });

  it("refuses a body that tries to set the prototype", async () => {
    const person = await newPerson(t.app);
    const response = await sendRaw(
      person,
      "POST",
      "/projects",
      '{"title":"T","format":"prose","__proto__":{"isAdmin":true}}',
      "application/json",
    );
    expect(response.statusCode).toBe(400);
    expect(await projectCount(person)).toBe(0);
  });

  it("refuses a constructor trick the same way", async () => {
    const person = await newPerson(t.app);
    const response = await sendRaw(
      person,
      "POST",
      "/projects",
      '{"title":"T","format":"prose","constructor":{"prototype":{"x":1}}}',
      "application/json",
    );
    expect(response.statusCode).toBe(400);
  });
});

describe("a body that is too large", () => {
  it("answers 413 for a create", async () => {
    const person = await newPerson(t.app);
    const response = await projectsApi(t.app).create(person, {
      title: "T",
      format: "prose",
      logline: "x".repeat(20_000),
    });
    expect(response.statusCode).toBe(413);
    expect(response.headers["content-type"]).toMatch(PROBLEM);
    expect(await projectCount(person)).toBe(0);
  });

  it("answers 413 for a change, and changes nothing", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    const response = await projectsApi(t.app).patch(person, project.id, {
      logline: "x".repeat(20_000),
    });
    expect(response.statusCode).toBe(413);
    const fetched = (await projectsApi(t.app).get(person, project.id)).json<ProjectJson>();
    expect(fetched).toEqual(project);
  });

  it("still takes the largest valid project", async () => {
    const person = await newPerson(t.app);
    // 1000 characters of 4 bytes each (emoji) as JSON is about 4 KB, well under the 16 KiB limit.
    const response = await projectsApi(t.app).create(person, {
      title: "😀".repeat(200),
      format: "prose",
      logline: "😀".repeat(1000),
    });
    expect(response.statusCode).toBe(201);
  });

  it("takes the largest valid project even when every emoji is written as an escape pair", async () => {
    const person = await newPerson(t.app);
    // "😀" as "😀" is twelve bytes in JSON. 200 + 1000 of them is about 14.4 KB, which has
    // to stay under the 16 KiB limit, or a writer's perfectly valid text would be refused.
    const pair = "\\ud83d\\ude00";
    const body = `{"title":"${pair.repeat(200)}","format":"prose","logline":"${pair.repeat(1000)}"}`;
    expect(Buffer.byteLength(body)).toBeLessThan(16_384);
    const response = await sendRaw(person, "POST", "/projects", body, "application/json");
    expect(response.statusCode).toBe(201);
    expect(response.json<ProjectJson>().logline).toBe("😀".repeat(1000));
  });

  it("takes the largest valid project written with escapes", async () => {
    const person = await newPerson(t.app);
    // "é" is six bytes in JSON for one character: 1200 characters is about 7 KB.
    const escaped = "\\u00e9".repeat(1000);
    const response = await sendRaw(
      person,
      "POST",
      "/projects",
      `{"title":"T","format":"prose","logline":"${escaped}"}`,
      "application/json",
    );
    expect(response.statusCode).toBe(201);
  });
});

describe("text the database cannot store", () => {
  it("answers 400, not 500, for a NUL character in the title", async () => {
    const person = await newPerson(t.app);
    const before = t.logs.lines.length;
    const response = await sendRaw(
      person,
      "POST",
      "/projects",
      '{"title":"bad\\u0000title","format":"prose"}',
      "application/json",
    );
    expect(response.statusCode).toBe(400);
    expect(await projectCount(person)).toBe(0);
    expect(errorLinesSince(before)).toEqual([]);
  });

  it("answers 400, not 500, for a NUL character in the logline", async () => {
    const person = await newPerson(t.app);
    const before = t.logs.lines.length;
    const response = await sendRaw(
      person,
      "POST",
      "/projects",
      '{"title":"T","format":"prose","logline":"a\\u0000b"}',
      "application/json",
    );
    expect(response.statusCode).toBe(400);
    expect(errorLinesSince(before)).toEqual([]);
  });

  it("answers 400, not 500, for a NUL character in a change", async () => {
    const person = await newPerson(t.app);
    const project = await createdProject(t.app, person);
    const before = t.logs.lines.length;
    const response = await sendRaw(
      person,
      "PATCH",
      `/projects/${project.id}`,
      '{"title":"a\\u0000b"}',
      "application/json",
    );
    expect(response.statusCode).toBe(400);
    expect(errorLinesSince(before)).toEqual([]);
  });
});

describe("an id that is not an id", () => {
  it.each([
    ["GET", (person: Person, id: string) => projectsApi(t.app).get(person, id)],
    ["PATCH", (person: Person, id: string) => projectsApi(t.app).patch(person, id, { title: "x" })],
    ["DELETE", (person: Person, id: string) => projectsApi(t.app).remove(person, id)],
  ])("%s answers 400 and names the parameter", async (_method, call) => {
    const person = await newPerson(t.app);
    const response = await call(person, "not-a-uuid");
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      errors: [{ source: "params", pointer: "/id", message: "The project id must be a UUID." }],
    });
  });

  it.each([
    "1",
    "null",
    "undefined",
    "0",
    "019e5a3c1b2d7c4e8f10a1b2c3d4e5f6",
    "1%27%20OR%20%271%27%3D%271",
    "%00",
    "%20",
    "019e5a3c-1b2d-7c4e-8f10-a1b2c3d4e5f6%20",
  ])("does not fail, and does not touch anything, for the id %j", async (id) => {
    const person = await newPerson(t.app);
    const survivor = await createdProject(t.app, person);
    const before = t.logs.lines.length;
    const responses = [
      await t.app.inject({ method: "GET", url: `/projects/${id}`, headers: bearer(person) }),
      await t.app.inject({
        method: "PATCH",
        url: `/projects/${id}`,
        headers: bearer(person),
        payload: { title: "x" },
      }),
      await t.app.inject({ method: "DELETE", url: `/projects/${id}`, headers: bearer(person) }),
    ];
    for (const response of responses) expect([400, 404]).toContain(response.statusCode);
    expect(errorLinesSince(before)).toEqual([]);
    expect((await projectsApi(t.app).get(person, survivor.id)).statusCode).toBe(200);
  });

  it("answers 404 for a path under a project that does not exist yet", async () => {
    const person = await newPerson(t.app);
    const response = await t.app.inject({
      method: "GET",
      url: `/projects/${SOME_ID}/documents`,
      headers: bearer(person),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("a method that a path does not have", () => {
  it.each([
    ["PUT", "/projects/019e5a3c-1b2d-7c4e-8f10-a1b2c3d4e5f6"],
    ["POST", "/projects/019e5a3c-1b2d-7c4e-8f10-a1b2c3d4e5f6"],
    ["DELETE", "/projects"],
    ["PATCH", "/projects"],
    ["PUT", "/projects"],
  ] as const)("%s %s is not a route", async (method, url) => {
    const person = await newPerson(t.app);
    const response = await t.app.inject({
      method,
      url,
      headers: bearer(person),
      payload: { title: "T", format: "prose" },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("nothing unexpected is logged", () => {
  it("keeps titles and loglines out of the logs", async () => {
    const person = await newPerson(t.app);
    const title = `Unique-title-${crypto.randomUUID()}`;
    const logline = `Unique-logline-${crypto.randomUUID()}`;
    const project = await createdProject(t.app, person, { title, logline });
    await projectsApi(t.app).patch(person, project.id, { title: `${title}-changed` });
    await projectsApi(t.app).create(person, { title: `${title}-bad`, format: "poem" });
    await projectsApi(t.app).list(person);
    await projectsApi(t.app).remove(person, project.id);
    expect(t.logs.text).not.toContain(title);
    expect(t.logs.text).not.toContain(logline);
  });

  it("keeps the access token out of the logs", async () => {
    const person = await newPerson(t.app);
    await projectsApi(t.app).list(person);
    await projectsApi(t.app).get(person, SOME_ID);
    expect(t.logs.text).not.toContain(person.token);
  });
});
