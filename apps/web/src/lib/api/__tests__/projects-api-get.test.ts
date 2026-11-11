import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../../test-support/msw-server.ts";
import { makeProject, problemResponse } from "../../../test-support/projects-handlers.ts";
import { setAccessToken } from "../../auth/token-store.ts";
import { ApiError, ResponseShapeError } from "../problem.ts";
import { projectsApi } from "../projects-api.ts";

describe("projectsApi.get", () => {
  it("gets one project's own address with the access token", async () => {
    setAccessToken("access-1");
    const project = makeProject({ title: "Lighthouse" });
    const seen: { path: string; auth: string | null }[] = [];
    server.use(
      http.get("/projects/:id", ({ request }) => {
        seen.push({
          path: new URL(request.url).pathname,
          auth: request.headers.get("authorization"),
        });
        return HttpResponse.json(project);
      }),
    );
    expect(await projectsApi.get(project.id)).toEqual(project);
    expect(seen).toEqual([{ path: `/projects/${project.id}`, auth: "Bearer access-1" }]);
  });

  it("encodes the id, so that nothing in it can change the address", async () => {
    const seen: string[] = [];
    server.use(
      http.get("*", ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return HttpResponse.json(makeProject());
      }),
    );
    await projectsApi.get("../auth/me");
    expect(seen).toEqual(["/projects/..%2Fauth%2Fme"]);
  });

  it("throws an ApiError with status 404 for a project that does not exist or is not the person's", async () => {
    server.use(http.get("/projects/:id", () => problemResponse(404, "not-found")));
    const failure = await projectsApi.get("p1").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(404);
  });

  it("refuses an answer of the wrong shape", async () => {
    server.use(http.get("/projects/:id", () => HttpResponse.json({ id: "x" })));
    await expect(projectsApi.get("p1")).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("stops when the caller cancels", async () => {
    server.use(http.get("/projects/:id", () => new Promise<Response>(() => undefined)));
    const controller = new AbortController();
    const pending = projectsApi.get("p1", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
