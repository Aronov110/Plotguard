import { STATUS_CODES } from "node:http";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { AppError, NotFoundError, type ProblemIssue, ValidationError } from "./app-error.ts";
import { PROBLEM_CONTENT_TYPE, toProblemDetails } from "./problem-details.ts";

const GENERIC_SERVER_DETAIL = "An unexpected error occurred.";
const GENERIC_CLIENT_DETAIL = "The request could not be processed.";

/**
 * Fixed, safe explanations for known Fastify protocol errors. Their own messages are never sent
 * to the client because they can quote parts of the request.
 */
const PROTOCOL_DETAILS: Readonly<Record<string, string>> = {
  FST_ERR_CTP_BODY_TOO_LARGE: "The request body is too large.",
  FST_ERR_CTP_INVALID_MEDIA_TYPE: "Unsupported content type.",
  FST_ERR_CTP_INVALID_JSON_BODY: "The request body is not valid JSON.",
  FST_ERR_CTP_EMPTY_JSON_BODY: "The request body is empty.",
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: "The Content-Length header does not match the body.",
};

function readStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : undefined;
}

function readCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function validationIssues(error: FastifyError): ProblemIssue[] {
  const source = error.validationContext ?? "body";
  return (error.validation ?? []).map((issue) => ({
    source,
    pointer: issue.instancePath === "/" ? "" : issue.instancePath,
    message: issue.message ?? "Invalid value.",
  }));
}

/** Maps anything that was thrown to an {@link AppError} that is safe to send to the client. */
function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (hasZodFastifySchemaValidationErrors(error)) {
    return new ValidationError(validationIssues(error as FastifyError), undefined, {
      cause: error,
    });
  }

  const status = readStatus(error);
  if (status !== undefined && status < 500) {
    const code = readCode(error);
    return new AppError({
      status,
      code: `http-${status}`,
      title: STATUS_CODES[status] ?? "Error",
      detail: (code !== undefined ? PROTOCOL_DETAILS[code] : undefined) ?? GENERIC_CLIENT_DETAIL,
      cause: error,
    });
  }

  const serverStatus = status ?? 500;
  return new AppError({
    status: serverStatus,
    code: serverStatus === 500 ? "internal-error" : `http-${serverStatus}`,
    title: STATUS_CODES[serverStatus] ?? "Internal Server Error",
    detail: GENERIC_SERVER_DETAIL,
    cause: error,
  });
}

function instanceOf(request: FastifyRequest): string {
  return request.url.split("?")[0] ?? request.url;
}

function sendProblem(request: FastifyRequest, reply: FastifyReply, error: AppError): FastifyReply {
  return reply
    .status(error.status)
    .headers(error.headers)
    .type(PROBLEM_CONTENT_TYPE)
    .send(toProblemDetails(error, instanceOf(request)));
}

/**
 * Not-found handler that answers with Problem Details. It is installed by `registerSecurity`
 * (Fastify allows only one per instance) so that unknown URLs are rate limited too.
 */
export function notFoundHandler(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendProblem(request, reply, new NotFoundError());
}

/**
 * Installs the global error handler. Every error response is RFC 9457
 * `application/problem+json`. Unexpected errors are logged in full but reported to the client
 * as a generic problem, so stack traces, queries and secrets never leave the server.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request, reply) => {
    const problem = toAppError(error);
    if (problem.status >= 500) {
      request.log.error({ err: error }, "Unhandled error while processing request");
    }
    return sendProblem(request, reply, problem);
  });
}
