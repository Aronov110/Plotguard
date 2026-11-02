import type { AppError } from "./app-error.ts";

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

/** RFC 9457 Problem Details object, plus optional extension members. */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance?: string;
  readonly [extension: string]: unknown;
}

/** Builds the `type` URI for a problem code. A URN, so no hostname is baked into responses. */
export function problemType(code: string): string {
  return `urn:plotpal:problem:${code}`;
}

/**
 * Converts an {@link AppError} into Problem Details.
 * Extension members are spread first so they can never overwrite a standard member.
 */
export function toProblemDetails(error: AppError, instance?: string): ProblemDetails {
  return {
    ...error.extensions,
    type: problemType(error.code),
    title: error.title,
    status: error.status,
    detail: error.detail,
    ...(instance === undefined ? {} : { instance }),
  };
}
