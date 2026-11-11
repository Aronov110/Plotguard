import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../../test-support/msw-server.ts";
import {
  answerCreateProject,
  answerDeleteProject,
  answerProjectList,
  answerUpdateProject,
  makeProject,
  problemResponse,
  projectPage,
  updated,
} from "../../../test-support/projects-handlers.ts";
import { setAccessToken } from "../../auth/token-store.ts";
import { ApiError, ResponseShapeError } from "../problem.ts";
import { projectsApi } from "../projects-api.ts";

describe("projectsApi.list", () => {
  it("gets /projects with the access token and returns the page", async () => {
    setAccessToken("access-1");
    const project = makeProject({ title: "Lighthouse", logline: "A keeper finds a message." });
    const calls = answerProjectList(projectPage([project], "cursor-2"));

    const page = await projectsApi.list();

    expect(page).toEqual({ items: [project], nextCursor: "cursor-2" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.pathname).toBe("/projects");
    expect(calls[0]?.url.search).toBe("");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer access-1");
  });

  it("sends the cursor, encoded so that no character can change the query", async () => {
    setAccessToken("access-1");
    const calls = answerProjectList(projectPage([]));
    const cursor = "2026-11-07T12:00:00.123456+00:00|a&b=c d";

    await projectsApi.list({ cursor });

    expect(calls[0]?.url.searchParams.get("cursor")).toBe(cursor);
    expect([...(calls[0]?.url.searchParams.keys() ?? [])]).toEqual(["cursor"]);
    expect(calls[0]?.url.search).not.toContain("&b=c");
  });

  it("accepts a last page with no next cursor", async () => {
    answerProjectList(projectPage([makeProject()], null));
    expect((await projectsApi.list()).nextCursor).toBeNull();
  });

  it("refuses an answer of the wrong shape, without repeating it", async () => {
    answerProjectList(() => HttpResponse.json({ items: [{ id: "x", title: "SECRET-TITLE" }] }));
    const failure = await projectsApi.list().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ResponseShapeError);
    expect((failure as Error).message).not.toContain("SECRET-TITLE");
  });

  it("refuses a format it does not know", async () => {
    answerProjectList(() =>
      HttpResponse.json({
        items: [{ ...makeProject(), format: "podcast" }],
        nextCursor: null,
      }),
    );
    await expect(projectsApi.list()).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("refuses an answer that is not JSON", async () => {
    answerProjectList(() => new HttpResponse("<html>oops</html>", { status: 200 }));
    await expect(projectsApi.list()).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("throws an ApiError for an error answer", async () => {
    answerProjectList(() => problemResponse(401, "unauthorized"));
    const failure = await projectsApi.list().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(401);
    expect((failure as ApiError).code).toBe("unauthorized");
  });

  it("stops when the caller cancels", async () => {
    server.use(http.get("/projects", () => new Promise<Response>(() => undefined)));
    const controller = new AbortController();
    const pending = projectsApi.list({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("projectsApi.create", () => {
  it("posts the title and format as JSON, with the access token", async () => {
    setAccessToken("access-1");
    const project = makeProject({ title: "Lighthouse", format: "prose" });
    const calls = answerCreateProject(() => HttpResponse.json(project, { status: 201 }));

    const result = await projectsApi.create({ title: "Lighthouse", format: "prose" });

    expect(result).toEqual(project);
    expect(calls[0]?.body).toEqual({ title: "Lighthouse", format: "prose" });
    expect(calls[0]?.headers.get("content-type")).toBe("application/json");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer access-1");
  });

  it("sends a logline when there is one", async () => {
    const calls = answerCreateProject(() =>
      HttpResponse.json(makeProject({ logline: "A keeper." }), { status: 201 }),
    );
    await projectsApi.create({ title: "T", format: "screenplay", logline: "A keeper." });
    expect(calls[0]?.body).toEqual({ title: "T", format: "screenplay", logline: "A keeper." });
  });

  it("leaves the logline out when there is none, instead of sending it empty", async () => {
    const calls = answerCreateProject(() => HttpResponse.json(makeProject(), { status: 201 }));
    await projectsApi.create({ title: "T", format: "other" });
    expect(calls[0]?.body).toEqual({ title: "T", format: "other" });
    expect(calls[0]?.body).not.toHaveProperty("logline");
  });

  it("sends the text exactly as it was typed (the API trims it)", async () => {
    const calls = answerCreateProject(() => HttpResponse.json(makeProject(), { status: 201 }));
    await projectsApi.create({ title: "  Padded  ", format: "other", logline: " Line " });
    expect(calls[0]?.body).toEqual({ title: "  Padded  ", format: "other", logline: " Line " });
  });

  it("throws an ApiError with the field messages when the API refuses", async () => {
    answerCreateProject(() =>
      problemResponse(400, "validation-error", {
        errors: [{ source: "body", pointer: "/title", message: "Enter a title." }],
      }),
    );
    const failure = await projectsApi
      .create({ title: "", format: "prose" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).issues).toEqual([
      { pointer: "/title", message: "Enter a title." },
    ]);
  });

  it("refuses a created project of the wrong shape", async () => {
    answerCreateProject(() => HttpResponse.json({ id: "x" }, { status: 201 }));
    await expect(projectsApi.create({ title: "T", format: "prose" })).rejects.toBeInstanceOf(
      ResponseShapeError,
    );
  });
});

describe("projectsApi.update", () => {
  it("patches the project's own address with only the changes, and the access token", async () => {
    setAccessToken("access-1");
    const project = makeProject({ title: "Old" });
    const calls = answerUpdateProject(updated(project));

    const result = await projectsApi.update(project.id, { title: "New" });

    expect(result).toMatchObject({ id: project.id, title: "New" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe(project.id);
    expect(calls[0]?.body).toEqual({ title: "New" });
    expect(calls[0]?.headers.get("content-type")).toBe("application/json");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer access-1");
  });

  it("sends null to clear the logline, and nothing for the fields that are not changed", async () => {
    const project = makeProject({ logline: "A logline." });
    const calls = answerUpdateProject(updated(project));
    await projectsApi.update(project.id, { logline: null });
    expect(calls[0]?.body).toEqual({ logline: null });
    expect(calls[0]?.body).not.toHaveProperty("title");
    expect(calls[0]?.body).not.toHaveProperty("format");
  });

  it("sends the text exactly as it was typed (the API trims the title)", async () => {
    const project = makeProject();
    const calls = answerUpdateProject(updated(project));
    await projectsApi.update(project.id, { title: "  Padded  ", format: "prose" });
    expect(calls[0]?.body).toEqual({ title: "  Padded  ", format: "prose" });
  });

  it("encodes the id, so that nothing in it can change the address", async () => {
    const seen: string[] = [];
    server.use(
      http.patch("*", ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return HttpResponse.json(makeProject());
      }),
    );
    await projectsApi.update("../auth/logout?x=1#y", { title: "T" });
    expect(seen).toEqual(["/projects/..%2Fauth%2Flogout%3Fx%3D1%23y"]);
  });

  it("throws an ApiError with the field messages when the API refuses", async () => {
    answerUpdateProject(() =>
      problemResponse(400, "validation-error", {
        errors: [{ source: "body", pointer: "/title", message: "Enter a title." }],
      }),
    );
    const failure = await projectsApi.update("p1", { title: "" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(400);
    expect((failure as ApiError).issues).toEqual([
      { pointer: "/title", message: "Enter a title." },
    ]);
  });

  it("throws an ApiError with status 404 for a project that is gone", async () => {
    answerUpdateProject(() => problemResponse(404, "not-found"));
    const failure = await projectsApi.update("p1", { title: "T" }).catch((error: unknown) => error);
    expect((failure as ApiError).status).toBe(404);
  });

  it("refuses an answer of the wrong shape", async () => {
    answerUpdateProject(() => HttpResponse.json({ id: "x" }));
    await expect(projectsApi.update("p1", { title: "T" })).rejects.toBeInstanceOf(
      ResponseShapeError,
    );
  });

  it("stops when the caller cancels", async () => {
    server.use(http.patch("/projects/:id", () => new Promise<Response>(() => undefined)));
    const controller = new AbortController();
    const pending = projectsApi.update("p1", { title: "T" }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("projectsApi.remove", () => {
  it("deletes the project's own address with the access token and returns nothing", async () => {
    setAccessToken("access-1");
    const calls = answerDeleteProject();
    const result = await projectsApi.remove("project-1");
    expect(result).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe("project-1");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer access-1");
    expect(calls[0]?.headers.get("content-type")).toBeNull();
  });

  it("encodes the id, so that nothing in it can change the address", async () => {
    const seen: string[] = [];
    server.use(
      http.delete("*", ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await projectsApi.remove("a/b");
    expect(seen).toEqual(["/projects/a%2Fb"]);
  });

  it("throws an ApiError with status 404 when the project is already gone", async () => {
    answerDeleteProject(() => problemResponse(404, "not-found"));
    const failure = await projectsApi.remove("p1").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(404);
  });

  it("throws an ApiError for a rate limit, with the wait", async () => {
    answerDeleteProject(() => problemResponse(429, "rate-limited", {}, { "retry-after": "7" }));
    const failure = await projectsApi.remove("p1").catch((error: unknown) => error);
    expect((failure as ApiError).status).toBe(429);
    expect((failure as ApiError).retryAfterSeconds).toBe(7);
  });

  it("stops when the caller cancels", async () => {
    server.use(http.delete("/projects/:id", () => new Promise<Response>(() => undefined)));
    const controller = new AbortController();
    const pending = projectsApi.remove("p1", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
