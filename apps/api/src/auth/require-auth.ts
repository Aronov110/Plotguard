import type { FastifyRequest } from "fastify";
import { UnauthorizedError } from "../errors/app-error.ts";
import type { AuthService } from "./service.ts";

/**
 * `Bearer <token>` with exactly one space, as RFC 6750 writes it. The scheme name is not case
 * sensitive. The token may only use the characters of a base64url or base64 string, so a header
 * with spaces, quotes or a second token never reaches the token check.
 */
const BEARER_HEADER = /^bearer ([A-Za-z0-9\-._~+/]+=*)$/i;

/**
 * Builds the hook for routes that need a signed-in user. It reads the access token from the
 * `Authorization` header, checks it without touching the database, and puts the user id on
 * `request.userId`. Every failure gives the same answer, so the reason is never revealed.
 */
export function createRequireAuth(auth: AuthService) {
  return async function requireAuth(request: FastifyRequest): Promise<void> {
    const header = request.headers.authorization;
    const token = typeof header === "string" ? BEARER_HEADER.exec(header)?.[1] : undefined;
    const verified = token === undefined ? undefined : await auth.authenticate(token);
    if (verified === undefined) throw new UnauthorizedError();
    request.userId = verified.userId;
  };
}
