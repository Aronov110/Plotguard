import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { AuthTestApp } from "./auth-app.ts";
import { bearer, type Person } from "./projects-api.ts";

export interface DocumentJson {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  content: string;
  position: number;
  wordCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OutlineItemJson {
  id: string;
  parentId: string | null;
  title: string;
  position: number;
  wordCount: number;
  updatedAt: string;
}

export interface OutlineJson {
  items: OutlineItemJson[];
}

/** The five document routes of one project, called the way the web app will call them. */
export function documentsApi(app: FastifyInstance) {
  const base = (projectId: string) => `/projects/${projectId}/documents`;
  return {
    outline: (person: Person, projectId: string): Promise<LightMyRequestResponse> =>
      app.inject({ method: "GET", url: base(projectId), headers: bearer(person) }),
    create: (
      person: Person,
      projectId: string,
      body: string | object,
    ): Promise<LightMyRequestResponse> =>
      app.inject({ method: "POST", url: base(projectId), headers: bearer(person), payload: body }),
    get: (person: Person, projectId: string, id: string): Promise<LightMyRequestResponse> =>
      app.inject({ method: "GET", url: `${base(projectId)}/${id}`, headers: bearer(person) }),
    /** `ifMatch` is sent as given (pass `undefined` to send no header at all). */
    patch: (
      person: Person,
      projectId: string,
      id: string,
      body: string | object,
      ifMatch?: string,
    ): Promise<LightMyRequestResponse> =>
      app.inject({
        method: "PATCH",
        url: `${base(projectId)}/${id}`,
        headers: { ...bearer(person), ...(ifMatch === undefined ? {} : { "if-match": ifMatch }) },
        payload: body,
      }),
    remove: (person: Person, projectId: string, id: string): Promise<LightMyRequestResponse> =>
      app.inject({ method: "DELETE", url: `${base(projectId)}/${id}`, headers: bearer(person) }),
  };
}

/** Creates a document through the API and returns it. Fails the test if the API refuses. */
export async function createdDocument(
  app: FastifyInstance,
  person: Person,
  projectId: string,
  overrides: Record<string, unknown> = {},
): Promise<DocumentJson> {
  const response = await documentsApi(app).create(person, projectId, {
    title: "Act One",
    ...overrides,
  });
  if (response.statusCode !== 201) {
    throw new Error(`Could not create a document: ${response.statusCode} ${response.body}`);
  }
  return response.json<DocumentJson>();
}

/**
 * Opens `count` database connections at once. Opening one takes longer than a whole create, so
 * without this a test of simultaneous requests can end up running them one after another, and then
 * it could not notice a missing lock.
 */
export async function openConnections(
  pool: AuthTestApp["handle"]["pool"],
  count: number,
): Promise<void> {
  await Promise.all(Array.from({ length: count }, () => pool.query("select pg_sleep(0.1)")));
}

/** The outline as a list of titles, in reading order. Handy for asserting an order. */
export async function outlineTitles(
  app: FastifyInstance,
  person: Person,
  projectId: string,
): Promise<string[]> {
  const response = await documentsApi(app).outline(person, projectId);
  return response.json<OutlineJson>().items.map((item) => item.title);
}
