import { HttpResponse, http } from "msw";
import type { Analysis, AnalysisPage, Estimate, Finding } from "../lib/api/analyses-api.ts";
import { server } from "./msw-server.ts";

let counter = 0;

/** A run with made-up details. It is `pending`, as a run just started is. */
export function makeAnalysis(overrides: Partial<Analysis> = {}): Analysis {
  counter += 1;
  return {
    id: `0190c000-0000-7000-8000-${String(counter).padStart(12, "0")}`,
    projectId: "project-1",
    documentId: null,
    kind: "plot_holes",
    scope: "project",
    status: "pending",
    model: "claude-opus-5-5",
    inputTokens: 0,
    outputTokens: 0,
    result: null,
    errorCode: null,
    createdAt: "2026-11-12T10:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

/** One finding, with one verified quote. */
export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  counter += 1;
  return {
    title: `Problem ${counter}`,
    severity: "major",
    category: "continuity",
    explanation: "It does not add up.",
    evidence: [{ documentId: "doc-1", quote: "A quoted passage.", verified: true }],
    suggestion: "Change one of the two scenes.",
    ...overrides,
  };
}

/** A finished run with these findings. */
export function makeSucceeded(
  findings: readonly Finding[],
  overrides: Partial<Analysis> = {},
): Analysis {
  return makeAnalysis({
    status: "succeeded",
    inputTokens: 1700,
    outputTokens: 1200,
    completedAt: "2026-11-12T10:00:20.000Z",
    result: {
      summary: "The story mostly holds together.",
      findings: [...findings],
      read: { items: 2, characters: 525 },
    },
    ...overrides,
  });
}

/** A run that ended with this code. */
export function makeFailed(errorCode: string, overrides: Partial<Analysis> = {}): Analysis {
  return makeAnalysis({
    status: "failed",
    errorCode,
    completedAt: "2026-11-12T10:00:20.000Z",
    ...overrides,
  });
}

/** An estimate that says a run is possible and costs a few cents. */
export function makeEstimate(overrides: Partial<Estimate> = {}): Estimate {
  return {
    available: true,
    model: "claude-opus-5-5",
    characters: 5000,
    inputTokens: { low: 2750, high: 3500 },
    outputTokens: { low: 4000, high: 16000 },
    costUsd: { low: 0.09, high: 0.33 },
    fits: true,
    maxInputTokens: 200000,
    remaining: { runs: 10, tokens: 1000000 },
    ...overrides,
  };
}

export function page(items: readonly Analysis[], nextCursor: string | null = null): AnalysisPage {
  return { items: [...items], nextCursor };
}

export interface SeenAnalysisCall {
  readonly url: URL;
  readonly headers: Headers;
  readonly projectId: string;
  readonly id: string | undefined;
  /** The JSON that was sent, or `undefined` when there was no body. */
  readonly body: unknown;
}

/** Something a fake route can answer with: JSON, or a function that builds a whole response. */
export type Reply<T> = T | (() => Response | Promise<Response>);

type Method = "get" | "post" | "delete";

/**
 * Answers a route of the analyses API with the replies in order (the last one repeats) and records
 * the calls. A reply that is a function builds the whole response, for errors and for slow answers.
 */
function answer<T>(
  method: Method,
  path: string,
  replies: readonly Reply<T>[],
  status = 200,
): SeenAnalysisCall[] {
  const calls: SeenAnalysisCall[] = [];
  const make = method === "get" ? http.get : method === "post" ? http.post : http.delete;
  server.use(
    make(path, async ({ request, params }) => {
      // `/analyses/estimate` also matches `/analyses/:id`. Letting it fall through means the order
      // in which a test sets up its answers cannot matter.
      if (params.id === "estimate") return undefined;
      const text = await request.text();
      calls.push({
        url: new URL(request.url),
        headers: request.headers,
        projectId: String(params.projectId),
        id: params.id === undefined ? undefined : String(params.id),
        body: text === "" ? undefined : JSON.parse(text),
      });
      const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (reply === undefined) throw new Error(`No answer was planned for ${method} ${path}.`);
      if (typeof reply === "function") return (reply as () => Response | Promise<Response>)();
      return HttpResponse.json(reply, { status });
    }),
  );
  return calls;
}

export function answerEstimate(...replies: readonly Reply<Estimate>[]): SeenAnalysisCall[] {
  return answer("get", "/projects/:projectId/analyses/estimate", replies);
}

export function answerStart(...replies: readonly Reply<Analysis>[]): SeenAnalysisCall[] {
  return answer("post", "/projects/:projectId/analyses", replies, 202);
}

export function answerRun(...replies: readonly Reply<Analysis>[]): SeenAnalysisCall[] {
  return answer("get", "/projects/:projectId/analyses/:id", replies);
}

export function answerRunList(...replies: readonly Reply<AnalysisPage>[]): SeenAnalysisCall[] {
  return answer("get", "/projects/:projectId/analyses", replies);
}

export function answerCancel(...replies: readonly Reply<Analysis>[]): SeenAnalysisCall[] {
  return answer("post", "/projects/:projectId/analyses/:id/cancel", replies);
}

/** Answers `DELETE` with 204 and records the calls. */
export function answerRemove(
  reply: () => Response | Promise<Response> = () => new HttpResponse(null, { status: 204 }),
): SeenAnalysisCall[] {
  return answer("delete", "/projects/:projectId/analyses/:id", [reply]);
}
