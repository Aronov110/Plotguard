import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  createAnthropicAiClient,
  FALLBACK_BETA,
  outcomeOf,
  providerErrorFor,
  type StreamingSdk,
} from "../anthropic-client.ts";
import { AiProviderError, type AiRequest } from "../client.ts";
import { plotHoleOutputSchema } from "../schemas.ts";

type FinalMessage = Awaited<
  ReturnType<ReturnType<StreamingSdk["beta"]["messages"]["stream"]>["finalMessage"]>
>;

const request: AiRequest = {
  system: "SYSTEM TEXT",
  manuscript: "MANUSCRIPT TEXT",
  task: "TASK TEXT",
  schema: plotHoleOutputSchema,
  model: "claude-opus-5-5",
  effort: "high",
  maxOutputTokens: 24_000,
};

const answer = { summary: "Fine.", findings: [] };

function message(overrides: Record<string, unknown> = {}): FinalMessage {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text: JSON.stringify(answer) }],
    stop_reason: "end_turn",
    stop_details: null,
    usage: { input_tokens: 1000, output_tokens: 200 },
    ...overrides,
  } as unknown as FinalMessage;
}

/** A fake SDK that records what it was asked to send and answers with `result`. */
function fakeSdk(result: FinalMessage | Error = message()) {
  const stream = vi.fn((_params: unknown, _options?: { signal?: AbortSignal }) => ({
    finalMessage: () =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  }));
  const sdk = { beta: { messages: { stream } } } as unknown as StreamingSdk;
  return { sdk, stream };
}

const run = (sdk: StreamingSdk, signal = new AbortController().signal) =>
  createAnthropicAiClient({ apiKey: "sk-ant-test-key-0123456789", sdk }).run(request, signal);

function apiError(status: number, text = "an error") {
  return Anthropic.APIError.generate(
    status,
    { type: "error", error: { type: "x", message: text } },
    text,
    new Headers(),
  );
}

describe("the request that is sent", () => {
  it("names the model, asks for adaptive thinking at the set effort, and limits the output", async () => {
    const { sdk, stream } = fakeSdk();
    await run(sdk);
    const params = stream.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.max_tokens).toBe(24_000);
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config).toMatchObject({ effort: "high" });
  });

  it("asks for the answer in the shape of the schema", async () => {
    const { sdk, stream } = fakeSdk();
    await run(sdk);
    const params = stream.mock.calls[0]?.[0] as {
      output_config: { format: { type: string; schema: unknown } };
    };
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.output_config.format.schema).toMatchObject({ type: "object" });
    expect(JSON.stringify(params.output_config.format.schema)).toContain("findings");
  });

  it("switches on the server-side fallback, so a declined request is retried on another model", async () => {
    const { sdk, stream } = fakeSdk();
    await run(sdk);
    const params = stream.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.betas).toEqual([FALLBACK_BETA]);
    expect(FALLBACK_BETA).toBe("server-side-fallback-2026-07-01");
    expect(params.fallbacks).toBe("default");
  });

  it("sends the instructions as the system prompt, and the text then the task as the one message", async () => {
    const { sdk, stream } = fakeSdk();
    await run(sdk);
    const params = stream.mock.calls[0]?.[0] as { system: string; messages: unknown[] };
    expect(params.system).toBe("SYSTEM TEXT");
    expect(params.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "MANUSCRIPT TEXT", cache_control: { type: "ephemeral" } },
          { type: "text", text: "TASK TEXT" },
        ],
      },
    ]);
  });

  it("marks only the manuscript for caching, so the task can change without losing it", async () => {
    const { sdk, stream } = fakeSdk();
    await run(sdk);
    const params = stream.mock.calls[0]?.[0] as {
      messages: { content: { cache_control?: unknown }[] }[];
    };
    const blocks = params.messages[0]?.content ?? [];
    expect(blocks.filter((block) => block.cache_control !== undefined)).toHaveLength(1);
    expect(blocks[1]?.cache_control).toBeUndefined();
  });

  it("sends nothing the newest models refuse: no sampling settings, no thinking budget, no prefill, no tools", async () => {
    const { sdk, stream } = fakeSdk();
    await run(sdk);
    const params = stream.mock.calls[0]?.[0] as Record<string, unknown>;
    for (const name of ["temperature", "top_p", "top_k", "tools", "tool_choice", "stream"]) {
      expect(params).not.toHaveProperty(name);
    }
    expect(JSON.stringify(params.thinking)).not.toContain("budget_tokens");
    const messages = params.messages as { role: string }[];
    expect(messages.at(-1)?.role).toBe("user");
  });

  it("hands the abort signal on, so cancelling stops the call", async () => {
    const { sdk, stream } = fakeSdk();
    const controller = new AbortController();
    await run(sdk, controller.signal);
    expect(stream.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it("uses the model and effort it is given, not fixed ones", async () => {
    const { sdk, stream } = fakeSdk();
    await createAnthropicAiClient({ apiKey: "sk-ant-test-key-0123456789", sdk }).run(
      { ...request, model: "claude-sonnet-5-5", effort: "low", maxOutputTokens: 8000 },
      new AbortController().signal,
    );
    const params = stream.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.max_tokens).toBe(8000);
    expect(params.output_config).toMatchObject({ effort: "low" });
  });
});

describe("reading the answer", () => {
  it("gives the JSON the model wrote, with what it used", async () => {
    const { sdk } = fakeSdk(
      message({
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          cache_read_input_tokens: 5000,
          cache_creation_input_tokens: 300,
        },
      }),
    );
    expect(await run(sdk)).toEqual({
      kind: "ok",
      output: answer,
      usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 5000, cacheWriteTokens: 300 },
    });
  });

  it("counts a missing cache figure as zero", () => {
    const outcome = outcomeOf(message());
    expect(outcome).toMatchObject({ usage: { cacheReadTokens: 0, cacheWriteTokens: 0 } });
  });

  it("joins the text blocks, and ignores thinking blocks", () => {
    const outcome = outcomeOf(
      message({
        content: [
          { type: "thinking", thinking: "", signature: "x" },
          { type: "text", text: '{"summary":"Fi' },
          { type: "text", text: 'ne.","findings":[]}' },
        ],
      }),
    );
    expect(outcome).toMatchObject({ kind: "ok", output: answer });
  });

  it("says refused, with the category, when the safety systems declined", () => {
    expect(
      outcomeOf(
        message({
          stop_reason: "refusal",
          stop_details: { type: "refusal", category: "general_harms", explanation: null },
          content: [],
        }),
      ),
    ).toMatchObject({ kind: "refused", category: "general_harms" });
  });

  it("says refused with no category when none is given", () => {
    expect(
      outcomeOf(message({ stop_reason: "refusal", stop_details: null, content: [] })),
    ).toMatchObject({
      kind: "refused",
      category: null,
    });
  });

  it("says truncated when the answer hit the output limit, even if some text came", () => {
    expect(
      outcomeOf(
        message({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"summ' }] }),
      ),
    ).toMatchObject({ kind: "truncated" });
  });

  it("says unparseable when the text is not JSON, or there is no text", () => {
    expect(
      outcomeOf(message({ content: [{ type: "text", text: "Sorry, I cannot." }] })),
    ).toMatchObject({
      kind: "unparseable",
    });
    expect(outcomeOf(message({ content: [] }))).toMatchObject({ kind: "unparseable" });
    expect(
      outcomeOf(message({ content: [{ type: "thinking", thinking: "", signature: "x" }] })),
    ).toMatchObject({ kind: "unparseable" });
  });

  it("gives the JSON as it is, leaving the checking of its shape to the service", () => {
    expect(outcomeOf(message({ content: [{ type: "text", text: "[1,2,3]" }] }))).toMatchObject({
      kind: "ok",
      output: [1, 2, 3],
    });
  });
});

describe("naming a failed call", () => {
  it.each([
    ["too many requests (429)", apiError(429), "rate_limited"],
    ["a key that is refused (401)", apiError(401), "not_configured"],
    ["no permission (403)", apiError(403), "not_configured"],
    [
      "a text that is too long for the model",
      apiError(400, "prompt is too long: 250000 tokens > 200000 maximum"),
      "too_long",
    ],
    ["a request that is too large (413)", apiError(413), "too_long"],
    ["a server error (500)", apiError(500), "overloaded"],
    ["the service overloaded (529)", apiError(529), "overloaded"],
    ["a bad gateway (502)", apiError(502), "overloaded"],
    ["another bad request (400)", apiError(400, "something else is wrong"), "unavailable"],
    ["a missing page (404)", apiError(404), "unavailable"],
    ["no connection", new Anthropic.APIConnectionError({ message: "no route" }), "overloaded"],
    ["a call that took too long", new Anthropic.APIConnectionTimeoutError(), "timeout"],
    ["a call that was aborted", new Anthropic.APIUserAbortError(), "canceled"],
    ["something nobody expected", new Error("what"), "unavailable"],
    ["something that is not an error", "oops", "unavailable"],
  ])("calls %s %s", (_name, error, code) => {
    expect(providerErrorFor(error).code).toBe(code);
  });

  it("passes an error that is already named through unchanged", () => {
    const named = new AiProviderError("timeout");
    expect(providerErrorFor(named)).toBe(named);
  });

  it("keeps the original error as the cause, and never copies its message", () => {
    const secret = "A line of the writer's private manuscript";
    const original = apiError(400, `prompt is too long. Text: ${secret}`);
    const named = providerErrorFor(original);
    expect(named.cause).toBe(original);
    expect(named.message).not.toContain(secret);
    expect(named.message).toBe("The AI request failed: too_long.");
  });

  it("turns whatever the SDK throws into a named error from run()", async () => {
    const { sdk } = fakeSdk(apiError(429));
    await expect(run(sdk)).rejects.toMatchObject({ name: "AiProviderError", code: "rate_limited" });
  });
});

describe("creating the client", () => {
  it("makes the real SDK client without calling the network", () => {
    expect(() => createAnthropicAiClient({ apiKey: "sk-ant-test-key-0123456789" })).not.toThrow();
  });
});
