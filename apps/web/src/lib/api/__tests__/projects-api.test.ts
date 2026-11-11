import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../../test-support/msw-server.ts";
import {
  answerCreateProject,
  answerProjectList,
  makeProject,
  problemResponse,
  projectPage,
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
