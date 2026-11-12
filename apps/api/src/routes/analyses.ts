import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AiConfig } from "../ai/limits.ts";
import {
  analysesListQuerySchema,
  analysesParamsSchema,
  analysisListSchema,
  analysisParamsSchema,
  analysisSchema,
  createAnalysisBodySchema,
  estimateQuerySchema,
  estimateSchema,
} from "../ai/schemas.ts";
import type { AiService } from "../ai/service.ts";
import { createRequireAuth } from "../auth/require-auth.ts";
import type { AuthService } from "../auth/service.ts";
import { NotFoundError, UnauthorizedError, ValidationError } from "../errors/app-error.ts";
import { InvalidCursorError } from "../projects/service.ts";
import { createWriteLimit } from "./write-limit.ts";

export interface AnalysesRoutesOptions {
  readonly auth: AuthService;
  readonly ai: AiService;
  readonly config: AiConfig;
}

const NO_PROJECT = "There is no such project.";
const NO_ANALYSIS = "There is no such analysis.";
const NO_DOCUMENT_OR_PROJECT = "There is no such project, or no such item in it.";

/** The body of a request to start a run is a few short fields. */
const CREATE_BODY_LIMIT_BYTES = 1024;

/** The signed-in person. `requireAuth` has run by now, so a missing id is a bug; fail closed. */
function ownerOf(request: FastifyRequest): string {
  if (request.userId === null) throw new UnauthorizedError();
  return request.userId;
}

/**
 * The AI analysis routes. Register under the `/projects/:projectId/analyses` prefix. Every route
 * needs the access token and works only on the signed-in person's own projects; one that is not
 * theirs is answered with 404, like one that does not exist. Starting a run answers 202 at once
 * with the run as `pending`; it goes on in the background and is read back with `GET`.
 */
export async function analysesRoutes(
  app: FastifyInstance,
  options: AnalysesRoutesOptions,
): Promise<void> {
  const { ai, config } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const requireAuth = createRequireAuth(options.auth);
  const limitWrites = createWriteLimit(app, "ai-write", config.writes);

  // Private data (it is somebody's story and what was said about it): never kept by a cache.
  app.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "private, no-store");
  });

  const reading = { preValidation: [requireAuth] };
  const writing = { preValidation: [requireAuth, limitWrites] };

  typed.get(
    "/estimate",
    {
      ...reading,
      schema: {
        tags: ["analyses"],
        summary: "What a run would use and cost",
        description:
          "A rough estimate from the number of characters, with no call to the AI service. Also says " +
          "what is left of your allowance for the last 24 hours, and whether runs can be started at " +
          "all. Answers 404 for a project (or item) that does not exist or is not yours.",
        security: [{ bearerAuth: [] }],
        params: analysesParamsSchema,
        querystring: estimateQuerySchema,
        response: { 200: estimateSchema },
      },
    },
    async (request) => {
      const estimate = await ai.estimate(ownerOf(request), request.params.projectId, request.query);
      if (estimate === undefined) throw new NotFoundError(NO_DOCUMENT_OR_PROJECT);
      return estimate;
    },
  );

  typed.post(
    "",
    {
      ...writing,
      bodyLimit: CREATE_BODY_LIMIT_BYTES,
      schema: {
        tags: ["analyses"],
        summary: "Start an AI run",
        description:
          "Looks for plot holes in one item (an act with its scenes, or a scene) or in the whole " +
          "project. The text is sent to Anthropic's Claude API. Answers 202 with the run as " +
          "`pending`; read it again until it is `succeeded` or `failed`. One run at a time per " +
          "person (409), with a limit on runs and tokens per 24 hours (429). Answers 422 when " +
          "there is no text, 413 when the text is longer than one run may send, 503 when the AI " +
          "features are not switched on, and 404 for a project or item that is not yours.",
        security: [{ bearerAuth: [] }],
        params: analysesParamsSchema,
        body: createAnalysisBodySchema,
        response: { 202: analysisSchema },
      },
    },
    async (request, reply) => {
      const started = await ai.start(ownerOf(request), request.params.projectId, request.body);
      if (started === undefined) throw new NotFoundError(NO_DOCUMENT_OR_PROJECT);
      return reply.status(202).send(started);
    },
  );

  typed.get(
    "",
    {
      ...reading,
      schema: {
        tags: ["analyses"],
        summary: "My AI runs on one project",
        description:
          "Newest first, with cursor paging like the project list. Answers 404 for a project that " +
          "does not exist and for one that is not yours.",
        security: [{ bearerAuth: [] }],
        params: analysesParamsSchema,
        querystring: analysesListQuerySchema,
        response: { 200: analysisListSchema },
      },
    },
    async (request) => {
      try {
        const page = await ai.list(ownerOf(request), request.params.projectId, request.query);
        if (page === undefined) throw new NotFoundError(NO_PROJECT);
        return page;
      } catch (error) {
        if (!(error instanceof InvalidCursorError)) throw error;
        throw new ValidationError([
          { source: "querystring", pointer: "/cursor", message: "The cursor is not valid." },
        ]);
      }
    },
  );

  typed.get(
    "/:id",
    {
      ...reading,
      schema: {
        tags: ["analyses"],
        summary: "One AI run",
        description:
          "The run as it is now: `pending`, or `succeeded` with its result, or `failed` with an " +
          "`errorCode`. Answers 404 for a run that does not exist, one in another project, and " +
          "one that is not yours.",
        security: [{ bearerAuth: [] }],
        params: analysisParamsSchema,
        response: { 200: analysisSchema },
      },
    },
    async (request) => {
      const { projectId, id } = request.params;
      const analysis = await ai.get(ownerOf(request), projectId, id);
      if (analysis === undefined) throw new NotFoundError(NO_ANALYSIS);
      return analysis;
    },
  );

  typed.post(
    "/:id/cancel",
    {
      ...writing,
      schema: {
        tags: ["analyses"],
        summary: "Cancel an AI run",
        description:
          "Stops a run that is still `pending`; it ends as `failed` with the code `canceled`. A run " +
          "that has already finished is returned as it is.",
        security: [{ bearerAuth: [] }],
        params: analysisParamsSchema,
        response: { 200: analysisSchema },
      },
    },
    async (request) => {
      const { projectId, id } = request.params;
      const analysis = await ai.cancel(ownerOf(request), projectId, id);
      if (analysis === undefined) throw new NotFoundError(NO_ANALYSIS);
      return analysis;
    },
  );

  typed.delete(
    "/:id",
    {
      ...writing,
      schema: {
        tags: ["analyses"],
        summary: "Delete an AI run",
        description:
          "Permanent. A run that is still going is stopped first. Answers 404 for a run that does " +
          "not exist (also when it was already deleted) and for one that is not yours.",
        security: [{ bearerAuth: [] }],
        params: analysisParamsSchema,
        response: { 204: z.null().describe("Deleted.") },
      },
    },
    async (request, reply) => {
      const { projectId, id } = request.params;
      const deleted = await ai.remove(ownerOf(request), projectId, id);
      if (!deleted) throw new NotFoundError(NO_ANALYSIS);
      return reply.status(204).send(null);
    },
  );
}
