import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  type AiClient,
  type AiOutcome,
  AiProviderError,
  type AiRequest,
  type AiUsage,
} from "./client.ts";

/** The beta that switches on the server-side fallback: a declined request is retried on another model. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

type StreamParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type FinalMessage = Anthropic.Beta.Messages.BetaMessage;

/**
 * The one part of the SDK this adapter uses. Tests hand in a fake with this shape, so what would be
 * sent can be checked without a network call.
 */
export interface StreamingSdk {
  readonly beta: {
    readonly messages: {
      stream(
        params: StreamParams,
        options?: { signal?: AbortSignal },
      ): { finalMessage(): Promise<FinalMessage> };
    };
  };
}

export interface AnthropicAiClientOptions {
  readonly apiKey: string;
  /** For tests: replaces the real SDK. */
  readonly sdk?: StreamingSdk;
}

function usageOf(message: FinalMessage): AiUsage {
  return {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
  };
}

/** What the model wrote, as one text, or `undefined` when it wrote no text. */
function textOf(message: FinalMessage): string | undefined {
  const parts = message.content.flatMap((block) => (block.type === "text" ? [block.text] : []));
  return parts.length === 0 ? undefined : parts.join("");
}

/** Reads the model's finished message into an outcome the service understands. */
export function outcomeOf(message: FinalMessage): AiOutcome {
  const usage = usageOf(message);
  if (message.stop_reason === "refusal") {
    return { kind: "refused", category: message.stop_details?.category ?? null, usage };
  }
  if (message.stop_reason === "max_tokens") return { kind: "truncated", usage };
  const text = textOf(message);
  if (text === undefined) return { kind: "unparseable", usage };
  try {
    return { kind: "ok", output: JSON.parse(text) as unknown, usage };
  } catch {
    return { kind: "unparseable", usage };
  }
}

/** True for a 400 that says the prompt is longer than the model can read. */
function isPromptTooLong(error: unknown): boolean {
  return (
    error instanceof Anthropic.BadRequestError &&
    /prompt is too long|too many tokens|exceeds the (maximum|context)/i.test(error.message)
  );
}

/**
 * Names a failed call. Messages from the API can repeat parts of the request, so they are never
 * copied into the error: only the code is kept, and the original error stays as the `cause`.
 */
export function providerErrorFor(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  const cause = { cause: error };
  if (error instanceof Anthropic.APIUserAbortError) return new AiProviderError("canceled", cause);
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiProviderError("timeout", cause);
  }
  if (error instanceof Anthropic.RateLimitError) return new AiProviderError("rate_limited", cause);
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new AiProviderError("not_configured", cause);
  }
  if (isPromptTooLong(error) || error instanceof Anthropic.ContentTooLargeError) {
    return new AiProviderError("too_long", cause);
  }
  if (
    error instanceof Anthropic.InternalServerError ||
    error instanceof Anthropic.APIConnectionError
  ) {
    return new AiProviderError("overloaded", cause);
  }
  return new AiProviderError("unavailable", cause);
}

/**
 * The adapter for Claude. One request per run: thinking decided by the model, the depth set by
 * `effort`, the answer in the shape of the Zod schema, the manuscript marked for caching (so a second
 * run on the same text within minutes costs less), and the server-side fallback switched on (a
 * request the safety systems decline is retried on another model, inside the same call).
 *
 * It streams and waits for the whole message: a long answer would otherwise run into HTTP timeouts.
 */
export function createAnthropicAiClient(options: AnthropicAiClientOptions): AiClient {
  const sdk: StreamingSdk = options.sdk ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 2 });

  return {
    async run(request: AiRequest, signal: AbortSignal): Promise<AiOutcome> {
      const params: StreamParams = {
        model: request.model,
        max_tokens: request.maxOutputTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: request.effort, format: zodOutputFormat(request.schema) },
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        system: request.system,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: request.manuscript, cache_control: { type: "ephemeral" } },
              { type: "text", text: request.task },
            ],
          },
        ],
      };
      try {
        const message = await sdk.beta.messages.stream(params, { signal }).finalMessage();
        return outcomeOf(message);
      } catch (error) {
        throw providerErrorFor(error);
      }
    },
  };
}
