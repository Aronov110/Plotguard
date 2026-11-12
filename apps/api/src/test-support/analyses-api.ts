import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { vi } from "vitest";
import { createdDocument } from "./documents-api.ts";
import { bearer, createdProject, newPerson, type Person } from "./projects-api.ts";

export interface AnalysisJson {
  id: string;
  projectId: string;
  documentId: string | null;
  kind: string;
  scope: string;
  status: "pending" | "succeeded" | "failed";
  model: string;
  inputTokens: number;
  outputTokens: number;
  result: {
    summary: string;
    findings: {
      title: string;
      severity: string;
      category: string;
      explanation: string;
      suggestion: string;
      evidence: { documentId: string | null; quote: string; verified: boolean }[];
    }[];
    read: { items: number; characters: number };
  } | null;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface EstimateJson {
  available: boolean;
  model: string;
  characters: number;
  inputTokens: { low: number; high: number };
  outputTokens: { low: number; high: number };
  costUsd: { low: number; high: number } | null;
  fits: boolean;
  maxInputTokens: number;
  remaining: { runs: number; tokens: number };
}

export interface AnalysisListJson {
  items: AnalysisJson[];
  nextCursor: string | null;
}

/** The analysis routes of one project, called the way the web app will call them. */
export function analysesApi(app: FastifyInstance) {
  const base = (projectId: string) => `/projects/${projectId}/analyses`;
  return {
    estimate: (
      person: Person,
      projectId: string,
      query: Record<string, string>,
    ): Promise<LightMyRequestResponse> =>
      app.inject({
        method: "GET",
        url: `${base(projectId)}/estimate`,
        query,
        headers: bearer(person),
      }),
    start: (
      person: Person,
      projectId: string,
      body: string | object,
    ): Promise<LightMyRequestResponse> =>
      app.inject({ method: "POST", url: base(projectId), headers: bearer(person), payload: body }),
    list: (
      person: Person,
      projectId: string,
      query: Record<string, string> = {},
    ): Promise<LightMyRequestResponse> =>
      app.inject({ method: "GET", url: base(projectId), query, headers: bearer(person) }),
    get: (person: Person, projectId: string, id: string): Promise<LightMyRequestResponse> =>
      app.inject({ method: "GET", url: `${base(projectId)}/${id}`, headers: bearer(person) }),
    cancel: (person: Person, projectId: string, id: string): Promise<LightMyRequestResponse> =>
      app.inject({
        method: "POST",
        url: `${base(projectId)}/${id}/cancel`,
        headers: bearer(person),
      }),
    remove: (person: Person, projectId: string, id: string): Promise<LightMyRequestResponse> =>
      app.inject({ method: "DELETE", url: `${base(projectId)}/${id}`, headers: bearer(person) }),
  };
}

/** The usual request: look for plot holes in the whole project. */
export const WHOLE_PROJECT = { kind: "plot_holes", scope: "project" } as const;

/** Starts a run through the API and returns it. Fails the test if the API refuses. */
export async function startedAnalysis(
  app: FastifyInstance,
  person: Person,
  projectId: string,
  body: string | object = WHOLE_PROJECT,
): Promise<AnalysisJson> {
  const response = await analysesApi(app).start(person, projectId, body);
  if (response.statusCode !== 202) {
    throw new Error(`Could not start a run: ${response.statusCode} ${response.body}`);
  }
  return response.json<AnalysisJson>();
}

/** Reads a run again and again, as the web screen does, until it is no longer pending. */
export async function finishedAnalysis(
  app: FastifyInstance,
  person: Person,
  projectId: string,
  id: string,
): Promise<AnalysisJson> {
  return vi.waitFor(
    async () => {
      const response = await analysesApi(app).get(person, projectId, id);
      const analysis = response.json<AnalysisJson>();
      if (analysis.status === "pending") throw new Error("Still pending.");
      return analysis;
    },
    { timeout: 5000, interval: 20 },
  );
}

/** What the test story says, so tests can look for it in what was sent. */
export const ACT_TEXT =
  "The lighthouse stands alone on the cliff. Nobody has lived there for years.";
export const SCENE_TEXT = "Waves crash on the rocks. The keeper climbs the stairs to the lamp.";

/** A person with a project that holds an act and a scene inside it, both with text. */
export async function storyWithText(app: FastifyInstance) {
  const person = await newPerson(app);
  const project = await createdProject(app, person);
  const act = await createdDocument(app, person, project.id, {
    title: "Act One",
    content: ACT_TEXT,
  });
  const scene = await createdDocument(app, person, project.id, {
    title: "The Storm",
    parentId: act.id,
    content: SCENE_TEXT,
  });
  return { person, project, act, scene };
}
