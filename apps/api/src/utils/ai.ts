/**
 * The one place this app talks to a language model.
 *
 * Every AI feature in apps/api goes through here — the dashboard assistant
 * (tool loop), LinkedIn drafting and proposal drafting (structured JSON). The
 * contract callers see is Anthropic-shaped (messages of text / tool_use /
 * tool_result blocks, tools with `input_schema`), and each provider translates
 * to and from it, so switching provider is one setting and no caller changes.
 *
 * PROVIDER. `AI_PROVIDER` ("openai" | "anthropic") picks it. Unset, Anthropic
 * is used when ANTHROPIC_API_KEY exists, otherwise OpenAI when OPENAI_API_KEY
 * exists. Models: ANTHROPIC_MODEL (default claude-haiku-5-5) and OPENAI_MODEL
 * (default gpt-5.4-mini).
 *
 * NO TEMPERATURE, anywhere. claude-haiku-5-5 rejects it ("`temperature` is
 * deprecated for this model") and the gpt-5 family accepts only its default.
 *
 * RAW FETCH, NO SDK, ON PURPOSE. Neither `@anthropic-ai/sdk` nor `openai` is a
 * dependency of apps/api, and the deploy image ships only what
 * deploy/package.api.json lists. An SDK import would build locally through
 * workspace hoisting and be missing in production.
 */

export type AiProvider = "openai" | "anthropic";

const KEY_ENV: Record<AiProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-5-5";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENAI_DEFAULT_MODEL = "gpt-5.4-mini";
/**
 * Reasoning tokens count against max_output_tokens on the OpenAI side, so the
 * caller's visible-output budget gets this much headroom on top.
 */
const OPENAI_REASONING_HEADROOM = 4_000;

/**
 * Generous, because a proposal is one long generation and not a page load.
 * Callers that answer a person waiting on a spinner pass a shorter one.
 */
const DEFAULT_TIMEOUT_MS = 180_000;

export class AiNotConfigured extends Error {}
export class AiUpstreamError extends Error {}

/** The provider in force, or null when neither key is set and none is chosen. */
export function aiProvider(): AiProvider | null {
  const chosen = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (chosen === "openai" || chosen === "anthropic") return chosen;
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  return null;
}

export function isAiConfigured(): boolean {
  const provider = aiProvider();
  return provider !== null && Boolean(process.env[KEY_ENV[provider]]?.trim());
}

export function aiModel(): string {
  return (aiProvider() ?? "anthropic") === "openai"
    ? process.env.OPENAI_MODEL?.trim() || OPENAI_DEFAULT_MODEL
    : process.env.ANTHROPIC_MODEL?.trim() || ANTHROPIC_DEFAULT_MODEL;
}

/* -------------------------------------------------------- shared contract -- */

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
/**
 * The raw OpenAI output of one assistant turn. Carried inside the turn so it
 * can go back on the wire verbatim — reasoning items included — when the
 * caller echoes the turn into the next request. Invisible to responseText().
 */
export type OpenAiOutputBlock = { type: "openai_output"; items: OpenAiItem[] };
export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | OpenAiOutputBlock;

export type Message = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
};

export type ToolDefinition = {
  name: string;
  description?: string;
  input_schema: unknown;
  /**
   * OpenAI only: enforce the schema while decoding. Requires a schema with
   * every property required and additionalProperties false.
   */
  strict?: boolean;
};

export type MessagesRequest = {
  system?: string;
  messages: Message[];
  max_tokens: number;
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
 * One model call through the active provider. Throws AiNotConfigured without a
 * key and AiUpstreamError for anything the API or the network got wrong, each
 * with a sentence fit to show a salesperson.
 */
export async function createMessage(
  request: MessagesRequest,
  options: { timeoutMs?: number } = {},
): Promise<MessagesResponse> {
  const provider = aiProvider();
  const key = provider ? process.env[KEY_ENV[provider]]?.trim() : undefined;
  if (!provider || !key) {
    throw new AiNotConfigured(
      provider
        ? `AI is not configured — AI_PROVIDER is ${provider} but ${KEY_ENV[provider]} is not set on the API.`
        : "AI is not configured — set OPENAI_API_KEY or ANTHROPIC_API_KEY on the API.",
    );
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const model = aiModel();

  if (provider === "anthropic") {
    const payload = await postJson(
      ANTHROPIC_ENDPOINT,
      {
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      {
        model,
        system: request.system,
        // openai_output blocks exist only to round-trip OpenAI turns.
        messages: request.messages.map((m) =>
          typeof m.content === "string"
            ? m
            : { ...m, content: m.content.filter((b) => b.type !== "openai_output") },
        ),
        max_tokens: request.max_tokens,
        tools: request.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })),
        tool_choice: request.tool_choice,
      },
      "Anthropic",
      timeoutMs,
    );
    return payload as MessagesResponse;
  }

  const payload = (await postJson(
    OPENAI_ENDPOINT,
    { Authorization: `Bearer ${key}` },
    {
      model,
      instructions: request.system,
      input: toOpenAiInput(request.messages),
      tools: request.tools?.map((t) => ({
        type: "function",
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
        strict: t.strict ?? false,
      })),
      tool_choice: toOpenAiToolChoice(request.tool_choice),
      max_output_tokens: request.max_tokens + OPENAI_REASONING_HEADROOM,
      reasoning: { effort: "low" },
    },
    "OpenAI",
    timeoutMs,
  )) as OpenAiResponse;
  return fromOpenAiResponse(payload, model);
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  vendor: string,
  timeoutMs: number,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(body),
  }).catch((error: unknown) => {
    // A timeout surfaces as a bare AbortError, which says nothing useful in
    // a toast.
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new AiUpstreamError(
        `The model took longer than ${Math.round(timeoutMs / 1000)} seconds and the request was given up.`,
      );
    }
    throw new AiUpstreamError(
      `Could not reach ${vendor}: ${(error as Error).message}`,
    );
  });

  const text = await response.text();
  if (!response.ok) {
    // Both vendors put the readable sentence at error.message.
    let detail = `${vendor} responded ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      if (text) detail = text.slice(0, 400);
    }
    throw new AiUpstreamError(detail);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new AiUpstreamError(`${vendor} returned something that was not JSON.`);
  }
}

/* ------------------------------------------------- OpenAI Responses API -- */

type OpenAiItem = {
  type?: string;
  role?: string;
  content?: { type?: string; text?: string; refusal?: string }[] | string;
  name?: string;
  arguments?: string;
  call_id?: string;
  [key: string]: unknown;
};

type OpenAiResponse = {
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: OpenAiItem[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

function toOpenAiToolChoice(choice: MessagesRequest["tool_choice"]) {
  if (!choice) return undefined;
  if (choice.type === "tool") return { type: "function", name: choice.name };
  return choice.type === "any" ? "required" : choice.type;
}

/** The shared message list as Responses API input items. */
function toOpenAiInput(messages: Message[]): OpenAiItem[] {
  const input: OpenAiItem[] = [];
  for (const message of messages) {
    if (typeof message.content === "string") {
      input.push({ role: message.role, content: message.content });
      continue;
    }

    // A turn that came from OpenAI goes back exactly as it arrived: reasoning
    // models expect their reasoning items beside the function calls they led
    // to, and the derived text/tool_use blocks would only duplicate it.
    const raw = message.content.find(
      (b): b is OpenAiOutputBlock => b.type === "openai_output",
    );
    if (raw) {
      input.push(...raw.items);
      continue;
    }

    for (const block of message.content) {
      if (block.type === "text") {
        input.push({ role: message.role, content: block.text });
      } else if (block.type === "tool_use") {
        input.push({
          type: "function_call",
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        });
      } else if (block.type === "tool_result") {
        input.push({
          type: "function_call_output",
          call_id: block.tool_use_id,
          output: block.content,
        });
      }
    }
  }
  return input;
}

/** A Responses API payload as shared content blocks and a stop reason. */
function fromOpenAiResponse(
  payload: OpenAiResponse,
  model: string,
): MessagesResponse {
  const items = payload.output ?? [];
  const content: ContentBlock[] = [{ type: "openai_output", items }];
  let refused = false;

  for (const item of items) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part.type === "output_text" && part.text) {
          content.push({ type: "text", text: part.text });
        } else if (part.type === "refusal") {
          refused = true;
        }
      }
    } else if (item.type === "function_call" && item.name) {
      let input: Record<string, unknown> = {};
      try {
        input = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        // Malformed arguments reach the tool as {}, and its error goes back to
        // the model, which is better placed to retry than a 502.
      }
      content.push({
        type: "tool_use",
        id: item.call_id ?? "",
        name: item.name,
        input,
      });
    }
  }

  const stop_reason: MessagesResponse["stop_reason"] = refused
    ? "refusal"
    : payload.status === "incomplete" &&
        payload.incomplete_details?.reason === "max_output_tokens"
      ? "max_tokens"
      : content.some((b) => b.type === "tool_use")
        ? "tool_use"
        : "end_turn";

  return {
    model: payload.model ?? model,
    content,
    stop_reason,
    usage: payload.usage,
  };
}

/* --------------------------------------------------------------- helpers -- */

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
 * call, so the answer arrives as an already-parsed tool input rather than
 * prose that might be wrapped in a code fence. On OpenAI the tool is strict, so
 * the schema is enforced while decoding. What is left to fail is a refusal or a
 * truncated response, both reported as such.
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
        strict: true,
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
