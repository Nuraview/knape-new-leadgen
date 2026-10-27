/**
 * The one place this app talks to a language model: Anthropic's Messages API.
 *
 * Every AI feature in apps/api goes through here — the dashboard assistant
 * (tool loop), LinkedIn drafting and proposal drafting (structured JSON). One
 * key (ANTHROPIC_API_KEY), one model setting (ANTHROPIC_MODEL), one error
 * vocabulary, so "is AI configured" has a single answer.
 *
 * RAW FETCH, NO SDK, ON PURPOSE. Neither `@anthropic-ai/sdk` nor `openai` is a
 * dependency of apps/api, and the deploy image ships only what
 * deploy/package.api.json lists. An SDK import would build locally through
 * workspace hoisting and be missing in production.
 */

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-haiku-5-5";

/**
 * Generous, because a proposal is one long generation and not a page load.
 * Callers that answer a person waiting on a spinner pass a shorter one.
 */
const DEFAULT_TIMEOUT_MS = 180_000;

export class AiNotConfigured extends Error {}
export class AiUpstreamError extends Error {}

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function aiModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

/* ------------------------------------------------------------ wire types -- */

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | { type: string; [key: string]: unknown };

export type Message = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
};

export type ToolDefinition = {
  name: string;
  description?: string;
  input_schema: unknown;
};

export type MessagesRequest = {
  system?: string;
  messages: Message[];
  max_tokens: number;
  // No `temperature`: claude-haiku-5-5 rejects it ("`temperature` is
  // deprecated for this model"), so the field is not offered at all.
  tools?: ToolDefinition[];
  tool_choice?:
    | { type: "auto" | "any" | "none" }
    | { type: "tool"; name: string };
};

export type MessagesResponse = {
  model: string;
  content: ContentBlock[];
  stop_reason:
    | "end_turn"
    | "max_tokens"
    | "stop_sequence"
    | "tool_use"
    | "pause_turn"
    | "refusal"
    | null;
  usage?: { input_tokens?: number; output_tokens?: number };
};

/* ---------------------------------------------------------------- client -- */

/**
 * One Messages API call. Throws AiNotConfigured without a key and
 * AiUpstreamError for anything the API or the network got wrong, each with a
 * sentence fit to show a salesperson.
 */
export async function createMessage(
  request: MessagesRequest,
  options: { timeoutMs?: number } = {},
): Promise<MessagesResponse> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    throw new AiNotConfigured(
      "AI is not configured — ANTHROPIC_API_KEY is not set on the API.",
    );
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": API_VERSION,
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ model: aiModel(), ...request }),
  }).catch((error: unknown) => {
    // A timeout surfaces as a bare AbortError, which says nothing useful in
    // a toast.
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new AiUpstreamError(
        `The model took longer than ${Math.round(timeoutMs / 1000)} seconds and the request was given up.`,
      );
    }
    throw new AiUpstreamError(
      `Could not reach Anthropic: ${(error as Error).message}`,
    );
  });

  const text = await response.text();
  if (!response.ok) {
    let detail = `Anthropic responded ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      if (text) detail = text.slice(0, 400);
    }
    throw new AiUpstreamError(detail);
  }

  try {
    return JSON.parse(text) as MessagesResponse;
  } catch {
    throw new AiUpstreamError("Anthropic returned something that was not JSON.");
  }
}

/** The visible text of a response, tool calls and other blocks left out. */
export function responseText(response: MessagesResponse): string {
  return response.content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export type CompletionResult<T> = {
  data: T;
  model: string;
  promptTokens: number;
  completionTokens: number;
};

/**
 * Ask for a JSON object matching `schema` and return it parsed.
 *
 * The schema is offered as the input of a single tool the model is forced to
 * call, so the answer arrives as an already-parsed tool_use input rather than
 * prose that might be wrapped in a code fence. What is left to fail is a
 * refusal or a truncated response, both reported as such.
 */
export async function completeJson<T>(options: {
  system: string;
  user: string;
  schemaName: string;
  schema: unknown;
  maxOutputTokens?: number;
}): Promise<CompletionResult<T>> {
  const response = await createMessage({
    system: options.system,
    messages: [{ role: "user", content: options.user }],
    max_tokens: options.maxOutputTokens ?? 16_000,
    tools: [
      {
        name: options.schemaName,
        description: "Return the finished result. Call this exactly once.",
        input_schema: options.schema,
      },
    ],
    tool_choice: { type: "tool", name: options.schemaName },
  });

  if (response.stop_reason === "refusal") {
    throw new AiUpstreamError("The model declined to answer.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new AiUpstreamError(
      "The model ran out of output budget before finishing. Try again, or shorten the input.",
    );
  }

  const call = response.content.find(
    (b): b is ToolUseBlock =>
      b.type === "tool_use" && b.name === options.schemaName,
  );
  if (!call) {
    throw new AiUpstreamError("The model returned no structured answer.");
  }

  return {
    data: call.input as T,
    model: response.model ?? aiModel(),
    promptTokens: response.usage?.input_tokens ?? 0,
    completionTokens: response.usage?.output_tokens ?? 0,
  };
}
