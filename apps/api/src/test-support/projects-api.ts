import { randomBytes } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { signUp } from "./auth-app.ts";

/** A signed-up person with a working access token. */
export interface Person {
  readonly id: string;
  readonly token: string;
}

/** Signs up someone with a random address, so tests never meet each other's data. */
export async function newPerson(app: FastifyInstance): Promise<Person> {
  const email = `person-${randomBytes(6).toString("hex")}@example.com`;
  const { body } = await signUp(app, { email });
  return { id: body.user.id, token: body.accessToken };
}

export const bearer = (person: Person) => ({ authorization: `Bearer ${person.token}` });

export interface ProjectJson {
  id: string;
  title: string;
  format: "screenplay" | "prose" | "other";
  logline: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListJson {
  items: ProjectJson[];
  nextCursor: string | null;
}

/** The five project routes, called the way the web app will call them. */
export function projectsApi(app: FastifyInstance) {
  return {
    list: (person: Person, query = ""): Promise<LightMyRequestResponse> =>
      app.inject({
        method: "GET",
        url: query === "" ? "/projects" : `/projects?${query}`,
        headers: bearer(person),
      }),
    create: (person: Person, body: string | object): Promise<LightMyRequestResponse> =>
      app.inject({ method: "POST", url: "/projects", headers: bearer(person), payload: body }),
    get: (person: Person, id: string): Promise<LightMyRequestResponse> =>
      app.inject({ method: "GET", url: `/projects/${id}`, headers: bearer(person) }),
    patch: (person: Person, id: string, body: string | object): Promise<LightMyRequestResponse> =>
      app.inject({
        method: "PATCH",
        url: `/projects/${id}`,
        headers: bearer(person),
        payload: body,
      }),
    remove: (person: Person, id: string): Promise<LightMyRequestResponse> =>
      app.inject({ method: "DELETE", url: `/projects/${id}`, headers: bearer(person) }),
  };
}

/** Creates a project through the API and returns it. Fails the test if the API refuses. */
export async function createdProject(
  app: FastifyInstance,
  person: Person,
  overrides: Record<string, unknown> = {},
): Promise<ProjectJson> {
  const response = await projectsApi(app).create(person, {
    title: "The Lighthouse",
    format: "screenplay",
    ...overrides,
  });
  if (response.statusCode !== 201) {
    throw new Error(`Could not create a project: ${response.statusCode} ${response.body}`);
  }
  return response.json<ProjectJson>();
}
