import type { APIRequestContext } from "@playwright/test";
import { API_ORIGIN, WEB_ORIGIN } from "./targets.ts";
import type { TestUser } from "./users.ts";

async function post(request: APIRequestContext, path: string, data?: unknown): Promise<void> {
  const response = await request.post(`${API_ORIGIN}${path}`, data === undefined ? {} : { data });
  if (!response.ok()) {
    throw new Error(`The end-to-end API refused ${path} (status ${response.status()}).`);
  }
}

/** Holds back the reply to the next logout; the logout itself still happens at once. */
export function holdNextLogoutReply(request: APIRequestContext): Promise<void> {
  return post(request, "/__e2e/hold-next-logout-reply");
}

/** Lets a held logout reply go. Safe to call when nothing is held. */
export function releaseLogoutReply(request: APIRequestContext): Promise<void> {
  return post(request, "/__e2e/release-logout-reply");
}

/**
 * Tells the fake AI model what to do with the next run: answer, refuse, be cut off, or wait until
 * {@link releaseAi}. The fake exists only in the end-to-end API, so no real model is ever called.
 */
export function aiNext(
  request: APIRequestContext,
  kind: "ok" | "refused" | "truncated" | "hold",
): Promise<void> {
  return post(request, "/__e2e/ai/next", { kind });
}

/** Lets a held AI run go on. Safe to call when nothing is held. */
export function releaseAi(request: APIRequestContext): Promise<void> {
  return post(request, "/__e2e/ai/release");
}

/**
 * Creates an account straight through the API, so a test about logging in does not have to sign up
 * through the form first. It uses the API's own address and the web app's origin, which is what the
 * browser would send. The login cookies it receives stay in `request`, not in the browser.
 */
export async function createAccount(request: APIRequestContext, user: TestUser): Promise<void> {
  const response = await request.post(`${API_ORIGIN}/auth/register`, {
    headers: { Origin: WEB_ORIGIN },
    data: { email: user.email, password: user.password, displayName: user.displayName },
  });
  if (response.status() !== 201) {
    throw new Error(`Could not create the test account (status ${response.status()}).`);
  }
}

/**
 * Creates projects for an existing account straight through the API, oldest first (so the last
 * title is the newest and tops the list). A test about a long list then does not have to fill in the
 * form many times. It logs in to get an access token; the login cookies stay in `request`, not in
 * the browser.
 */
export async function createProjects(
  request: APIRequestContext,
  user: TestUser,
  projects: readonly { readonly title: string; readonly logline?: string }[],
): Promise<void> {
  const login = await request.post(`${API_ORIGIN}/auth/login`, {
    headers: { Origin: WEB_ORIGIN },
    data: { email: user.email, password: user.password },
  });
  if (login.status() !== 200) {
    throw new Error(`Could not log in the test account (status ${login.status()}).`);
  }
  const body: unknown = await login.json();
  const token =
    typeof body === "object" && body !== null && "accessToken" in body
      ? body.accessToken
      : undefined;
  if (typeof token !== "string") throw new Error("The login answer had no access token.");

  for (const project of projects) {
    const response = await request.post(`${API_ORIGIN}/projects`, {
      headers: { Origin: WEB_ORIGIN, Authorization: `Bearer ${token}` },
      data: { format: "screenplay", ...project },
    });
    if (response.status() !== 201) {
      throw new Error(`Could not create a test project (status ${response.status()}).`);
    }
  }
}

/** One outline item to seed: a scene names the act it goes into by that act's title. */
export interface SeedDocument {
  readonly title: string;
  /** The title of the act or chapter this scene goes into. Leave it out for the top level. */
  readonly inside?: string;
  readonly content?: string;
}

/**
 * Creates one project with an outline straight through the API, so a test about writing does not
 * have to click through the form first. The items are created in the order given (acts before their
 * scenes). Returns the project's id and the id of each item by its title.
 */
export async function createProjectWithDocuments(
  request: APIRequestContext,
  user: TestUser,
  project: { readonly title: string; readonly documents: readonly SeedDocument[] },
): Promise<{ readonly projectId: string; readonly ids: Readonly<Record<string, string>> }> {
  const login = await request.post(`${API_ORIGIN}/auth/login`, {
    headers: { Origin: WEB_ORIGIN },
    data: { email: user.email, password: user.password },
  });
  if (login.status() !== 200) {
    throw new Error(`Could not log in the test account (status ${login.status()}).`);
  }
  const body: unknown = await login.json();
  const token =
    typeof body === "object" && body !== null && "accessToken" in body
      ? body.accessToken
      : undefined;
  if (typeof token !== "string") throw new Error("The login answer had no access token.");
  const headers = { Origin: WEB_ORIGIN, Authorization: `Bearer ${token}` };

  const created = await request.post(`${API_ORIGIN}/projects`, {
    headers,
    data: { title: project.title, format: "screenplay" },
  });
  if (created.status() !== 201) {
    throw new Error(`Could not create a test project (status ${created.status()}).`);
  }
  const projectId = ((await created.json()) as { id: string }).id;

  const ids: Record<string, string> = {};
  for (const document of project.documents) {
    const parentId = document.inside === undefined ? undefined : ids[document.inside];
    const response = await request.post(`${API_ORIGIN}/projects/${projectId}/documents`, {
      headers,
      data: {
        title: document.title,
        ...(parentId === undefined ? {} : { parentId }),
        ...(document.content === undefined ? {} : { content: document.content }),
      },
    });
    if (response.status() !== 201) {
      throw new Error(`Could not create a test document (status ${response.status()}).`);
    }
    ids[document.title] = ((await response.json()) as { id: string }).id;
  }
  return { projectId, ids };
}

/** Deletes one document straight through the API, as another device of the same person could. */
export async function deleteDocument(
  request: APIRequestContext,
  user: TestUser,
  projectId: string,
  documentId: string,
): Promise<void> {
  const login = await request.post(`${API_ORIGIN}/auth/login`, {
    headers: { Origin: WEB_ORIGIN },
    data: { email: user.email, password: user.password },
  });
  if (login.status() !== 200) {
    throw new Error(`Could not log in the test account (status ${login.status()}).`);
  }
  const body: unknown = await login.json();
  const token =
    typeof body === "object" && body !== null && "accessToken" in body
      ? body.accessToken
      : undefined;
  if (typeof token !== "string") throw new Error("The login answer had no access token.");
  const response = await request.delete(
    `${API_ORIGIN}/projects/${projectId}/documents/${documentId}`,
    { headers: { Origin: WEB_ORIGIN, Authorization: `Bearer ${token}` } },
  );
  if (response.status() !== 204) {
    throw new Error(`Could not delete a test document (status ${response.status()}).`);
  }
}

/** One item of a project's outline as the API reports it. */
export interface OutlineEntry {
  readonly id: string;
  readonly title: string;
  readonly parentId: string | null;
  readonly position: number;
}

/**
 * Reads a project's outline straight through the API, so a test can check what the server really
 * has after the screen renamed, moved or deleted something (and not only what the screen shows).
 * Each top-level item is followed by its children, as the API gives them.
 */
export async function readOutline(
  request: APIRequestContext,
  user: TestUser,
  projectId: string,
): Promise<readonly OutlineEntry[]> {
  const login = await request.post(`${API_ORIGIN}/auth/login`, {
    headers: { Origin: WEB_ORIGIN },
    data: { email: user.email, password: user.password },
  });
  if (login.status() !== 200) {
    throw new Error(`Could not log in the test account (status ${login.status()}).`);
  }
  const body: unknown = await login.json();
  const token =
    typeof body === "object" && body !== null && "accessToken" in body
      ? body.accessToken
      : undefined;
  if (typeof token !== "string") throw new Error("The login answer had no access token.");
  const response = await request.get(`${API_ORIGIN}/projects/${projectId}/documents`, {
    headers: { Origin: WEB_ORIGIN, Authorization: `Bearer ${token}` },
  });
  if (response.status() !== 200) {
    throw new Error(`Could not read the test outline (status ${response.status()}).`);
  }
  const outline = (await response.json()) as { items: OutlineEntry[] };
  return outline.items.map(({ id, title, parentId, position }) => ({
    id,
    title,
    parentId,
    position,
  }));
}
