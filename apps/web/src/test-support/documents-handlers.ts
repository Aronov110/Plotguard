import { HttpResponse, http } from "msw";
import type { DocumentDetail, OutlineItem } from "../lib/api/documents-api.ts";
import { server } from "./msw-server.ts";

let counter = 0;

/** An outline item with made-up details. Every call gives it a new id and title. */
export function makeOutlineItem(overrides: Partial<OutlineItem> = {}): OutlineItem {
  counter += 1;
  return {
    id: `0190b000-0000-7000-8000-${String(counter).padStart(12, "0")}`,
    parentId: null,
    title: `Item ${counter}`,
    position: 0,
    wordCount: 0,
    updatedAt: "2026-11-07T12:00:00.000Z",
    ...overrides,
  };
}

/** A document with made-up details, at version 1 with no text. */
export function makeDocument(overrides: Partial<DocumentDetail> = {}): DocumentDetail {
  counter += 1;
  return {
    id: `0190b000-0000-7000-8000-${String(counter).padStart(12, "0")}`,
    projectId: "project-1",
    parentId: null,
    title: `Document ${counter}`,
    content: "",
    position: 0,
    wordCount: 0,
    version: 1,
    createdAt: "2026-11-07T10:00:00.000Z",
    updatedAt: "2026-11-07T12:00:00.000Z",
    ...overrides,
  };
}

/** The outline item that goes with a document. */
export function itemOf(document: DocumentDetail): OutlineItem {
  return {
    id: document.id,
    parentId: document.parentId,
    title: document.title,
    position: document.position,
    wordCount: document.wordCount,
    updatedAt: document.updatedAt,
  };
}

/** Something a fake route can answer with: items, or a function that builds a response. */
export type OutlineReply = readonly OutlineItem[] | (() => Response | Promise<Response>);

export interface SeenCall {
  readonly url: URL;
  readonly headers: Headers;
}

/**
 * Answers `GET /projects/:projectId/documents` with the replies in order (the last one repeats) and
 * records the calls. Passing none answers with an empty outline.
 */
export function answerOutline(...replies: readonly OutlineReply[]): SeenCall[] {
  const calls: SeenCall[] = [];
  server.use(
    http.get("/projects/:projectId/documents", ({ request }) => {
      calls.push({ url: new URL(request.url), headers: request.headers });
      const reply = replies[Math.min(calls.length - 1, replies.length - 1)] ?? [];
      return typeof reply === "function" ? reply() : HttpResponse.json({ items: reply });
    }),
  );
  return calls;
}

export type DocumentReply = DocumentDetail | (() => Response | Promise<Response>);

export interface DocumentCall extends SeenCall {
  readonly projectId: string;
  readonly id: string;
}

/**
 * Answers `GET /projects/:projectId/documents/:id` with the replies in order (the last one
 * repeats), whatever the id, and records the calls.
 */
export function answerDocument(...replies: readonly DocumentReply[]): DocumentCall[] {
  const calls: DocumentCall[] = [];
  server.use(
    http.get("/projects/:projectId/documents/:id", ({ request, params }) => {
      calls.push({
        url: new URL(request.url),
        headers: request.headers,
        projectId: String(params.projectId),
        id: String(params.id),
      });
      const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (reply === undefined) throw new Error("No answer was planned for GET a document.");
      return typeof reply === "function" ? reply() : HttpResponse.json(reply);
    }),
  );
  return calls;
}

export interface SaveCall extends DocumentCall {
  /** The `If-Match` header exactly as sent, for example `"3"`; `null` when there was none. */
  readonly ifMatch: string | null;
  readonly body: unknown;
}

/** Answers `PATCH /projects/:projectId/documents/:id` and records what was sent. */
export function answerSave(reply: (call: SaveCall) => Response | Promise<Response>): SaveCall[] {
  const calls: SaveCall[] = [];
  server.use(
    http.patch("/projects/:projectId/documents/:id", async ({ request, params }) => {
      const call: SaveCall = {
        url: new URL(request.url),
        headers: request.headers,
        projectId: String(params.projectId),
        id: String(params.id),
        ifMatch: request.headers.get("if-match"),
        body: await request.json(),
      };
      calls.push(call);
      return reply(call);
    }),
  );
  return calls;
}

/** Counts words the way the API does: runs of non-space characters. */
export function wordsIn(text: string): number {
  return text.match(/\S+/gu)?.length ?? 0;
}

/**
 * The usual success answer of a save: 200 with `document` holding the sent text, its word count,
 * and the version after the one in `If-Match`, as the API does.
 */
export function saved(document: DocumentDetail): (call: SaveCall) => Response {
  return (call) => {
    const sent = call.body as { content?: string; title?: string };
    const version = Number(/"(\d+)"/.exec(call.ifMatch ?? "")?.[1] ?? document.version) + 1;
    const content = sent.content ?? document.content;
    return HttpResponse.json({
      ...document,
      ...(sent.title === undefined ? {} : { title: sent.title }),
      content,
      wordCount: wordsIn(content),
      version,
      updatedAt: "2026-11-11T09:00:00.000Z",
    });
  };
}

export interface CreateDocumentCall {
  readonly projectId: string;
  readonly body: unknown;
  readonly headers: Headers;
}

/** Answers `POST /projects/:projectId/documents` and records what was sent. */
export function answerCreateDocument(
  reply: (call: CreateDocumentCall) => Response | Promise<Response>,
): CreateDocumentCall[] {
  const calls: CreateDocumentCall[] = [];
  server.use(
    http.post("/projects/:projectId/documents", async ({ request, params }) => {
      const call: CreateDocumentCall = {
        projectId: String(params.projectId),
        body: await request.json(),
        headers: request.headers,
      };
      calls.push(call);
      return reply(call);
    }),
  );
  return calls;
}

/** The usual success answer of a create: 201 with a new, empty document with the sent details. */
export function createdDocument(overrides: Partial<DocumentDetail> = {}) {
  return (call: CreateDocumentCall): Response => {
    const sent = call.body as { title?: string; parentId?: string | null };
    return HttpResponse.json(
      makeDocument({
        projectId: call.projectId,
        ...(sent.title === undefined ? {} : { title: sent.title.trim() }),
        parentId: sent.parentId ?? null,
        ...overrides,
      }),
      { status: 201 },
    );
  };
}
