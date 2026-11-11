import { HttpResponse, http } from "msw";
import type { Project, ProjectPage } from "../lib/api/projects-api.ts";
import { server } from "./msw-server.ts";

let counter = 0;

/** A project with made-up details. Every call gives it a new id and title, so lists have no repeats. */
export function makeProject(overrides: Partial<Project> = {}): Project {
  counter += 1;
  return {
    id: `0190a000-0000-7000-8000-${String(counter).padStart(12, "0")}`,
    title: `Project ${counter}`,
    format: "screenplay",
    logline: null,
    createdAt: "2026-11-07T10:00:00.000Z",
    updatedAt: "2026-11-07T12:00:00.000Z",
    ...overrides,
  };
}

export function projectPage(
  items: readonly Project[],
  nextCursor: string | null = null,
): ProjectPage {
  return { items: [...items], nextCursor };
}

/** An error answer in the API's Problem Details form. */
export function problemResponse(
  status: number,
  type: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  return HttpResponse.json(
    { type: `urn:plotpal:problem:${type}`, status, ...extra },
    { status, headers: { "content-type": "application/problem+json", ...headers } },
  );
}

/** Something a fake route can answer with: a page of projects, or a function that builds a response. */
export type PageReply = ProjectPage | (() => Response | Promise<Response>);

export interface ListCall {
  readonly url: URL;
  readonly headers: Headers;
}

/**
 * Answers `GET /projects` with the replies in order (the last one repeats) and records every call.
 * Passing none answers every call with an empty first page.
 */
export function answerProjectList(...replies: readonly PageReply[]): ListCall[] {
  const calls: ListCall[] = [];
  server.use(
    http.get("/projects", ({ request }) => {
      calls.push({ url: new URL(request.url), headers: request.headers });
      const reply = replies[Math.min(calls.length - 1, replies.length - 1)] ?? projectPage([]);
      return typeof reply === "function" ? reply() : HttpResponse.json(reply);
    }),
  );
  return calls;
}

export interface CreateCall {
  readonly body: unknown;
  readonly headers: Headers;
}

/** Answers `POST /projects` and records the bodies that were sent. */
export function answerCreateProject(
  reply: (body: unknown) => Response | Promise<Response>,
): CreateCall[] {
  const calls: CreateCall[] = [];
  server.use(
    http.post("/projects", async ({ request }) => {
      const body: unknown = await request.json();
      calls.push({ body, headers: request.headers });
      return reply(body);
    }),
  );
  return calls;
}

/** The usual success answer of `POST /projects`: 201 with a project that has the sent details. */
export function created(overrides: Partial<Project> = {}): (body: unknown) => Response {
  return (body) => {
    const sent = body as { title?: string; format?: Project["format"]; logline?: string };
    return HttpResponse.json(
      makeProject({
        ...(sent.title === undefined ? {} : { title: sent.title.trim() }),
        ...(sent.format === undefined ? {} : { format: sent.format }),
        logline: sent.logline ?? null,
        ...overrides,
      }),
      { status: 201 },
    );
  };
}
