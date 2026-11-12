import { type AiClient, AiProviderError, type AiRequest, type AiUsage } from "../client.ts";
import { type IdeasOutput, ideasOutputSchema, type PlotHoleOutput } from "../schemas.ts";

export const FAKE_USAGE: AiUsage = {
  inputTokens: 1200,
  outputTokens: 350,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** What a fake call does. Each value is one call; the fake takes them in order. */
export type FakeBehavior =
  | { readonly kind: "ok"; readonly output?: unknown; readonly usage?: Partial<AiUsage> }
  | { readonly kind: "refused"; readonly category?: string | null }
  | { readonly kind: "truncated" }
  | { readonly kind: "unparseable" }
  | { readonly kind: "error"; readonly error: Error }
  /**
   * Never answers by itself: only an abort (cancel or timeout) or `release()` ends it. With
   * `ignoreAbort` it behaves like a call that cannot be stopped: it keeps going after an abort, and
   * answers when released (a late answer).
   */
  | { readonly kind: "hold"; readonly afterwards?: FakeBehavior; readonly ignoreAbort?: boolean };

export interface FakeAiClient extends AiClient {
  /** Every request received, in order, as the real client would have sent it. */
  readonly calls: AiRequest[];
  /** Plans the next call's behaviour. Without any, a call answers `defaultOutput`. */
  next(...behaviors: readonly FakeBehavior[]): void;
  /** Lets the call that is being held finish, with its `then` behaviour (or the default answer). */
  release(): void;
  /** How many calls are being held right now. */
  readonly holding: number;
}

/** The id of the first item in the manuscript, and the start of its text, as the model would see them. */
function firstItem(request: AiRequest): { documentId: string; quote: string } {
  const header = /id: ([0-9a-f-]{36}) /.exec(request.manuscript);
  const lines = request.manuscript.split("\n");
  const headerAt = lines.findIndex((line) => /^<<<[0-9a-f]{16}>>> ITEM /.test(line));
  const text = headerAt === -1 ? undefined : lines[headerAt + 1];
  return { documentId: header?.[1] ?? "unknown", quote: (text ?? "").slice(0, 40) || "no text" };
}

/** A believable answer for a plot-hole scan: one finding, quoting the start of the manuscript. */
export function defaultOutput(request: AiRequest): PlotHoleOutput {
  const { documentId, quote } = firstItem(request);
  return {
    summary: "The story mostly holds together, with one thing worth a second look.",
    findings: [
      {
        title: "The first scene does not match the second",
        severity: "moderate",
        category: "continuity",
        explanation: "Something in the first scene is contradicted later on.",
        evidence: [{ documentId, quote }],
        suggestion: "Make the two scenes agree.",
      },
    ],
  };
}

/** A believable answer for an idea request: one idea, building on the start of the manuscript. */
export function defaultIdeasOutput(request: AiRequest): IdeasOutput {
  const { documentId, quote } = firstItem(request);
  return {
    summary: "The story could grow in a few directions; one is worth trying first.",
    ideas: [
      {
        title: "Let the first scene come back changed",
        kind: "scene",
        description: "Return to the opening place late in the story, and let it have changed.",
        whyItFits: "The opening sets up a place the story can come back to.",
        evidence: [{ documentId, quote }],
        goesIn: documentId,
      },
    ],
  };
}

/** The believable answer for whichever kind of request this is, told apart by its answer shape. */
function answerFor(request: AiRequest): PlotHoleOutput | IdeasOutput {
  return request.schema === ideasOutputSchema
    ? defaultIdeasOutput(request)
    : defaultOutput(request);
}

/**
 * A stand-in for the model, for tests and for the browser tests: it makes no network call, costs
 * nothing and answers as it is told. There is no setting that switches it on in a running server: it
 * can only be handed to the app in code, which only test code does.
 */
export function createFakeAiClient(...initial: readonly FakeBehavior[]): FakeAiClient {
  const queue: FakeBehavior[] = [...initial];
  const calls: AiRequest[] = [];
  const releases: Array<() => void> = [];

  async function perform(
    behavior: FakeBehavior | undefined,
    request: AiRequest,
    signal: AbortSignal,
  ): ReturnType<AiClient["run"]> {
    if (signal.aborted) throw new AiProviderError("canceled");
    if (behavior === undefined || behavior.kind === "ok") {
      const output = behavior?.output === undefined ? answerFor(request) : behavior.output;
      return { kind: "ok", output, usage: { ...FAKE_USAGE, ...behavior?.usage } };
    }
    switch (behavior.kind) {
      case "refused":
        return { kind: "refused", category: behavior.category ?? null, usage: FAKE_USAGE };
      case "truncated":
        return { kind: "truncated", usage: FAKE_USAGE };
      case "unparseable":
        return { kind: "unparseable", usage: FAKE_USAGE };
      case "error":
        throw behavior.error;
      case "hold": {
        await new Promise<void>((resolve, reject) => {
          const release = () => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          };
          // An aborted call is no longer held: it is dropped from the list and fails.
          const onAbort = () => {
            const at = releases.indexOf(release);
            if (at !== -1) releases.splice(at, 1);
            reject(new AiProviderError("canceled"));
          };
          if (behavior.ignoreAbort !== true)
            signal.addEventListener("abort", onAbort, { once: true });
          releases.push(release);
        });
        if (behavior.ignoreAbort === true) {
          // Answers as if nothing had been aborted.
          return perform(behavior.afterwards, request, new AbortController().signal);
        }
        return perform(behavior.afterwards, request, signal);
      }
    }
  }

  return {
    calls,
    next: (...behaviors) => {
      queue.push(...behaviors);
    },
    release: () => {
      releases.shift()?.();
    },
    get holding() {
      return releases.length;
    },
    run: (request, signal) => {
      calls.push(request);
      return perform(queue.shift(), request, signal);
    },
  };
}
