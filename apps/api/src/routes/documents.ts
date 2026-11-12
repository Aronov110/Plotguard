import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { createRequireAuth } from "../auth/require-auth.ts";
import type { AuthService } from "../auth/service.ts";
import { formatEtag, parseIfMatch } from "../documents/etag.ts";
import { DOCUMENT_TEXT_BODY_LIMIT_BYTES, type DocumentLimits } from "../documents/limits.ts";
import {
  createDocumentBodySchema,
  documentParamsSchema,
  documentSchema,
  documentsParamsSchema,
  ifMatchHeadersSchema,
  outlineSchema,
  patchDocumentBodySchema,
} from "../documents/schemas.ts";
import {
  DocumentLimitError,
  type DocumentsService,
  InvalidParentError,
  type InvalidParentReason,
  InvalidPositionError,
  StaleVersionError,
} from "../documents/service.ts";
import {
  ConflictError,
  NotFoundError,
  PreconditionFailedError,
  PreconditionRequiredError,
  UnauthorizedError,
  ValidationError,
} from "../errors/app-error.ts";
import { createWriteLimit } from "./write-limit.ts";

export interface DocumentsRoutesOptions {
  readonly auth: AuthService;
  readonly documents: DocumentsService;
  readonly limits: DocumentLimits;
}

const NO_DOCUMENT = "There is no such document.";
const NO_PROJECT = "There is no such project.";

const PARENT_MESSAGES: Record<InvalidParentReason, string> = {
  "not-found": "The parent does not exist in this project.",
  "too-deep": "Only top-level items (acts and chapters) can hold other items.",
  self: "An item cannot be its own parent.",
  "has-children": "An item that has children cannot be moved under another item.",
};

/** The signed-in person. `requireAuth` has run by now, so a missing id is a bug; fail closed. */
function ownerOf(request: FastifyRequest): string {
  if (request.userId === null) throw new UnauthorizedError();
  return request.userId;
}

/** Turns the service's refusals about parent and position into 400 answers with a pointer. */
async function withPlacementErrors<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof InvalidParentError) {
      throw new ValidationError([
        { source: "body", pointer: "/parentId", message: PARENT_MESSAGES[error.reason] },
      ]);
    }
    if (error instanceof InvalidPositionError) {
      throw new ValidationError([
        {
          source: "body",
          pointer: "/position",
          message: `The position must be from 0 to ${error.max}.`,
        },
      ]);
    }
    throw error;
  }
}

function sendDocument(reply: FastifyReply, status: number, version: number) {
  return reply.status(status).header("etag", formatEtag(version));
}

/**
 * The document routes. Register under the `/projects/:projectId/documents` prefix. Every route
 * needs the access token, every query is limited to the signed-in person's own projects, and a
 * document reached through another project's path is answered with 404 like one that is missing.
 * Saving needs `If-Match` with the version that was read, so a stale save is refused.
 */
export async function documentsRoutes(
  app: FastifyInstance,
  options: DocumentsRoutesOptions,
): Promise<void> {
  const { documents, limits } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const requireAuth = createRequireAuth(options.auth);
  const limitWrites = createWriteLimit(app, "documents-write", limits.writes);

  // Private data (it is somebody's story): neither the browser nor a proxy may keep a copy.
  app.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "private, no-store");
  });

  // `preValidation`, so that a request without a valid token gets 401 whatever its body or address
  // looks like, and is never told what is wrong with it.
  const reading = { preValidation: [requireAuth] };
  const writing = { preValidation: [requireAuth, limitWrites] };

  typed.get(
    "",
    {
      ...reading,
      schema: {
        tags: ["documents"],
        summary: "The outline of one of my projects",
        description:
          "Every act, chapter and scene without its text, in reading order: each top-level item " +
          "followed by its children. Not paginated (a project holds at most 1,000 items). " +
          "Answers 404 for a project that does not exist and for one that is not yours.",
        security: [{ bearerAuth: [] }],
        params: documentsParamsSchema,
        response: { 200: outlineSchema },
      },
    },
    async (request) => {
      const outline = await documents.outline(ownerOf(request), request.params.projectId);
      if (outline === undefined) throw new NotFoundError(NO_PROJECT);
      return outline;
    },
  );

  typed.post(
    "",
    {
      ...writing,
      bodyLimit: DOCUMENT_TEXT_BODY_LIMIT_BYTES,
      schema: {
        tags: ["documents"],
        summary: "Add an outline item",
        description:
          "Leave out `position` to put it last. Answers 409 when the project already has 1,000 " +
          "items, and 404 for a project that does not exist or is not yours. " +
          "Answers 503 with `Retry-After` when other changes to the project keep it locked for more than five seconds; nothing was changed, so send it again.",
        security: [{ bearerAuth: [] }],
        params: documentsParamsSchema,
        body: createDocumentBodySchema,
        response: { 201: documentSchema },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const created = await withPlacementErrors(async () => {
        try {
          return await documents.create(ownerOf(request), projectId, request.body);
        } catch (error) {
          if (error instanceof DocumentLimitError) throw new ConflictError(error.message);
          throw error;
        }
      });
      if (created === undefined) throw new NotFoundError(NO_PROJECT);
      return sendDocument(reply, 201, created.version)
        .header("location", `/projects/${projectId}/documents/${created.id}`)
        .send(created);
    },
  );

  typed.get(
    "/:id",
    {
      ...reading,
      schema: {
        tags: ["documents"],
        summary: "One document with its text",
        description:
          "The `version` (also sent as `ETag`) is what a later save must send as `If-Match`. " +
          "Answers 404 for a document that does not exist, one in another project, and one that " +
          "is not yours.",
        security: [{ bearerAuth: [] }],
        params: documentParamsSchema,
        response: { 200: documentSchema },
      },
    },
    async (request, reply) => {
      const { projectId, id } = request.params;
      const document = await documents.get(ownerOf(request), projectId, id);
      if (document === undefined) throw new NotFoundError(NO_DOCUMENT);
      return sendDocument(reply, 200, document.version).send(document);
    },
  );

  typed.patch(
    "/:id",
    {
      ...writing,
      bodyLimit: DOCUMENT_TEXT_BODY_LIMIT_BYTES,
      schema: {
        tags: ["documents"],
        summary: "Rename, move or save the text of a document",
        description:
          "Send only what changes. Needs `If-Match` with the version you loaded: a missing header " +
          "gets 428, a malformed one (including `*` and lists) 400, and an out-of-date one 412, " +
          "in which case load the document again. A move renumbers the siblings; `position` is " +
          "counted among the siblings without this item. Leaving it out moves to the end when " +
          "`parentId` changes. " +
          "Answers 503 with `Retry-After` when other changes to the project keep it locked for more than five seconds; nothing was changed, so send it again.",
        security: [{ bearerAuth: [] }],
        params: documentParamsSchema,
        headers: ifMatchHeadersSchema,
        body: patchDocumentBodySchema,
        response: { 200: documentSchema },
      },
    },
    async (request, reply) => {
      // After body validation on purpose: a request with a broken body is told so first.
      const ifMatch = parseIfMatch(request.headers["if-match"]);
      if (ifMatch.kind === "missing") throw new PreconditionRequiredError();
      if (ifMatch.kind === "malformed") {
        throw new ValidationError([
          {
            source: "headers",
            pointer: "/if-match",
            message: 'If-Match must be one version in quotes, for example "3".',
          },
        ]);
      }
      const { projectId, id } = request.params;
      const updated = await withPlacementErrors(async () => {
        try {
          return await documents.update(
            ownerOf(request),
            projectId,
            id,
            ifMatch.version,
            request.body,
          );
        } catch (error) {
          if (error instanceof StaleVersionError) throw new PreconditionFailedError();
          throw error;
        }
      });
      if (updated === undefined) throw new NotFoundError(NO_DOCUMENT);
      return sendDocument(reply, 200, updated.version).send(updated);
    },
  );

  typed.delete(
    "/:id",
    {
      ...writing,
      schema: {
        tags: ["documents"],
        summary: "Delete a document",
        description:
          "Permanent. The children of an act or chapter are deleted with it, and the siblings " +
          "move up. Answers 404 for a document that does not exist (also when it was already " +
          "deleted) and for one that is not yours. " +
          "Answers 503 with `Retry-After` when other changes to the project keep it locked for more than five seconds; nothing was changed, so send it again.",
        security: [{ bearerAuth: [] }],
        params: documentParamsSchema,
        response: { 204: z.null().describe("Deleted.") },
      },
    },
    async (request, reply) => {
      const { projectId, id } = request.params;
      const deleted = await documents.remove(ownerOf(request), projectId, id);
      if (!deleted) throw new NotFoundError(NO_DOCUMENT);
      return reply.status(204).send(null);
    },
  );
}
