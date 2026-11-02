import type { z } from "zod";
import { readCsrfToken } from "../auth/csrf-cookie.ts";
import { getAccessToken } from "../auth/token-store.ts";
import { NetworkError, ResponseShapeError, readProblem } from "./problem.ts";

export interface RequestOptions {
  readonly method?: "GET" | "POST";
  /** Sent as the JSON body. Leave it out for no body and no content type at all. */
  readonly json?: unknown;
  /** Send `Authorization: Bearer <access token>` when a token exists. */
  readonly auth?: boolean;
  /** Copy the CSRF cookie into the `X-CSRF-Token` header when the cookie exists. */
  readonly csrf?: boolean;
  readonly signal?: AbortSignal;
}

/**
 * Resolves an API path against this page's own origin. The access token and the CSRF code must
 * never be sent anywhere else, so anything that would leave the origin (`//host`, `https://host`,
 * `/\host`) is refused before a request is made.
 */
function ownOriginUrl(path: string): URL {
  if (!path.startsWith("/")) {
    throw new TypeError("An API path must start with a slash.");
  }
  const origin = window.location.origin;
  const url = new URL(path, origin);
  if (url.origin !== origin) {
    throw new TypeError("An API path must stay on this page's own origin.");
  }
  return url;
}

// Checked by name, as the standard defines it, instead of with `instanceof DOMException`: the
// error can come from another realm (a test environment, an iframe) with its own DOMException.
function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Calls the API and returns the response when it succeeded.
 *
 * @throws ApiError when the API answered with an error status.
 * @throws NetworkError when there was no answer at all.
 * @throws TypeError when `path` would leave this page's origin.
 * @throws DOMException named `AbortError` when `signal` was aborted (passed through unchanged).
 */
export async function apiRequest(path: string, options: RequestOptions = {}): Promise<Response> {
  const url = ownOriginUrl(path);

  const headers = new Headers({ Accept: "application/json, application/problem+json" });
  if (options.json !== undefined) headers.set("Content-Type", "application/json");
  if (options.auth === true) {
    const token = getAccessToken();
    if (token !== undefined) headers.set("Authorization", `Bearer ${token}`);
  }
  if (options.csrf === true) {
    const code = readCsrfToken();
    if (code !== undefined) headers.set("X-CSRF-Token", code);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      credentials: "same-origin",
      ...(options.json === undefined ? {} : { body: JSON.stringify(options.json) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new NetworkError({ cause: error });
  }

  if (!response.ok) throw await readProblem(response);
  return response;
}

/**
 * Like {@link apiRequest}, then reads the JSON body and checks it against `schema`.
 *
 * @throws ResponseShapeError when the body is not JSON or does not match the schema. The message
 *   never repeats the data, which may contain tokens.
 */
export async function apiJson<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const response = await apiRequest(path, options);

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new ResponseShapeError("The API's answer was not valid JSON.", { cause });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ResponseShapeError("The API's answer did not have the expected shape.", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
