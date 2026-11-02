import { z } from "zod";
import { apiJson, apiRequest } from "./http.ts";

// These mirror the API's response schemas (apps/api/src/auth/schemas.ts). Every answer is checked
// when it arrives, so a changed API fails loudly here instead of showing garbage on a page.

const userSchema = z.object({
  id: z.string().min(1),
  email: z.string(),
  displayName: z.string().nullable(),
});

const sessionSchema = z.object({
  user: userSchema,
  accessToken: z.string().min(1),
  expiresIn: z.number().int().positive(),
});

const meSchema = z.object({ user: userSchema });

export type PublicUser = z.infer<typeof userSchema>;
export type SessionResponse = z.infer<typeof sessionSchema>;

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly displayName?: string;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

/** The five auth routes. Each call throws `ApiError`, `NetworkError` or `ResponseShapeError`. */
export interface AuthApi {
  register(input: RegisterInput): Promise<SessionResponse>;
  login(input: LoginInput): Promise<SessionResponse>;
  /** Uses the refresh cookie (sent by the browser) and the CSRF cookie. Sends no body. */
  refresh(): Promise<SessionResponse>;
  /** Ends the login on the server. Sends no body. */
  logout(): Promise<void>;
  /** The signed-in user. Needs the access token. */
  me(): Promise<PublicUser>;
}

export const authApi: AuthApi = {
  register: ({ email, password, displayName }) =>
    apiJson("/auth/register", sessionSchema, {
      method: "POST",
      json: { email, password, ...(displayName === undefined ? {} : { displayName }) },
    }),

  login: ({ email, password }) =>
    apiJson("/auth/login", sessionSchema, { method: "POST", json: { email, password } }),

  // No `json`: the API rejects a refresh or logout that has a JSON content type but an empty body.
  refresh: () => apiJson("/auth/refresh", sessionSchema, { method: "POST", csrf: true }),

  logout: async () => {
    await apiRequest("/auth/logout", { method: "POST", csrf: true });
  },

  me: async () => (await apiJson("/auth/me", meSchema, { auth: true })).user,
};
