import type { CreateRateLimitOptions } from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { createRequireAuth } from "../auth/require-auth.ts";
import type { AuthService } from "../auth/service.ts";
import {
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from "../errors/app-error.ts";
import { RATE_LIMIT_CACHE_SIZE } from "../plugins/security.ts";
import {
  DEFAULT_PAGE_SIZE,
  PROJECT_BODY_LIMIT_BYTES,
  type ProjectLimits,
} from "../projects/limits.ts";
import {
  createProjectBodySchema,
  listQuerySchema,
  patchProjectBodySchema,
  projectListSchema,
  projectParamsSchema,
  projectSchema,
} from "../projects/schemas.ts";
import { InvalidCursorError, type ProjectsService } from "../projects/service.ts";

export interface ProjectsRoutesOptions {
  readonly auth: AuthService;
  readonly projects: ProjectsService;
  readonly limits: ProjectLimits;
}

const NOT_FOUND = "There is no such project.";

/** The signed-in person. `requireAuth` has run by now, so a missing id is a bug; fail closed. */
function ownerOf(request: FastifyRequest): string {
  if (request.userId === null) throw new UnauthorizedError();
  return request.userId;
}

/**
 * The project routes. Register under the `/projects` prefix. Every route needs the access token,
 * and every query is limited to the signed-in person's own projects: a project of someone else is
 * answered with 404, exactly like one that does not exist.
 */
export async function projectsRoutes(
  app: FastifyInstance,
  options: ProjectsRoutesOptions,
): Promise<void> {
  const { projects, limits } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const requireAuth = createRequireAuth(options.auth);

  // Private data: neither the browser nor a proxy may keep a copy.
  app.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "private, no-store");
  });

  // One counter per person for everything that changes projects. Called by hand, after the person
  // is known, because the per-address limiter runs before the login check and knows only addresses.
  // `cache` (how many people the counter remembers) is honoured by the plugin but missing from its
  // type for this call, so the options are built apart from the call. Left at its default of 5,000,
  // junk accounts could push a victim's counter out and reset it (see `rule` in routes/auth.ts).
  const writeLimit: CreateRateLimitOptions & { readonly cache: number } = {
    max: limits.writes.max,
    timeWindow: limits.writes.windowSeconds * 1000,
    cache: RATE_LIMIT_CACHE_SIZE,
    keyGenerator: (request: FastifyRequest) => `projects-write:${request.userId ?? request.ip}`,
  };
  const writeCounter = app.createRateLimit(writeLimit);

  async function limitWrites(request: FastifyRequest): Promise<void> {
    const state = await writeCounter(request);
    // `isAllowed` is true only for allow-listed callers (there are none); a counted request always
    // has it false, and `isExceeded` says whether this one went past the maximum.
    if (!state.isAllowed && state.isExceeded) throw new RateLimitError(state.ttlInSeconds);
  }

  // `preValidation`, so that a request without a valid token gets 401 whatever its body or address
  // looks like, and is never told what is wrong with it.
  const reading = { preValidation: [requireAuth] };
  const writing = { preValidation: [requireAuth, limitWrites] };

  typed.get(
    "",
    {
      ...reading,
      schema: {
        tags: ["projects"],
        summary: "List my projects",
        description:
          `Newest updated first, ${DEFAULT_PAGE_SIZE} per page by default. Pass the ` +
          "`nextCursor` of one page as `cursor` to get the next. Only your own projects are listed.",
        security: [{ bearerAuth: [] }],
        querystring: listQuerySchema,
        response: { 200: projectListSchema },
      },
    },
    async (request) => {
      try {
        return await projects.list(ownerOf(request), {
          limit: request.query.limit ?? DEFAULT_PAGE_SIZE,
          cursor: request.query.cursor,
        });
      } catch (error) {
        if (!(error instanceof InvalidCursorError)) throw error;
        throw new ValidationError([
          { source: "querystring", pointer: "/cursor", message: "The cursor is not valid." },
        ]);
      }
    },
  );

  typed.post(
    "",
    {
      ...writing,
      bodyLimit: PROJECT_BODY_LIMIT_BYTES,
      schema: {
        tags: ["projects"],
        summary: "Create a project",
        security: [{ bearerAuth: [] }],
        body: createProjectBodySchema,
        response: { 201: projectSchema },
      },
    },
    async (request, reply) => {
      const project = await projects.create(ownerOf(request), request.body);
      return reply.status(201).header("location", `/projects/${project.id}`).send(project);
    },
  );

  typed.get(
    "/:id",
    {
      ...reading,
      schema: {
        tags: ["projects"],
        summary: "Get one of my projects",
        description: "Answers 404 for a project that does not exist and for one that is not yours.",
        security: [{ bearerAuth: [] }],
        params: projectParamsSchema,
        response: { 200: projectSchema },
      },
    },
    async (request) => {
      const project = await projects.get(ownerOf(request), request.params.id);
      if (project === undefined) throw new NotFoundError(NOT_FOUND);
      return project;
    },
  );

  typed.patch(
    "/:id",
    {
      ...writing,
      bodyLimit: PROJECT_BODY_LIMIT_BYTES,
      schema: {
        tags: ["projects"],
        summary: "Change one of my projects",
        description:
          "Send only what changes. `logline: null` (or a blank text) clears the logline. " +
          "Answers 404 for a project that does not exist and for one that is not yours.",
        security: [{ bearerAuth: [] }],
        params: projectParamsSchema,
        body: patchProjectBodySchema,
        response: { 200: projectSchema },
      },
    },
    async (request) => {
      const project = await projects.update(ownerOf(request), request.params.id, request.body);
      if (project === undefined) throw new NotFoundError(NOT_FOUND);
      return project;
    },
  );

  typed.delete(
    "/:id",
    {
      ...writing,
      schema: {
        tags: ["projects"],
        summary: "Delete one of my projects",
        description:
          "Permanent. The project's documents and analyses are deleted with it. Answers 404 for " +
          "a project that does not exist (also when it was already deleted) and for one that is " +
          "not yours.",
        security: [{ bearerAuth: [] }],
        params: projectParamsSchema,
        response: { 204: z.null().describe("Deleted.") },
      },
    },
    async (request, reply) => {
      const deleted = await projects.remove(ownerOf(request), request.params.id);
      if (!deleted) throw new NotFoundError(NOT_FOUND);
      // The 204 schema is `null`, so the type wants a value; Fastify sends no body with a 204.
      return reply.status(204).send(null);
    },
  );
}
