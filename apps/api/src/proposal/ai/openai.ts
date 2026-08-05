/**
 * The one place this app talks to OpenAI.
 *
 * RAW FETCH, NO SDK, ON PURPOSE. `openai` is not a dependency of apps/api — the
 * enrichment code that imports it resolves only through workspace hoisting from
 * apps/web, and apps/web is deliberately absent from the deploy image (see
 * deploy/package.api.json, which ships dotenv-mono and nothing else). An import
 * added here would build locally and be missing in production. The HTTP API
 * gives us structured outputs anyway; there is nothing the SDK adds that is
 * worth that failure mode.
 */

const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-5";

/**
 * Generous, because this is one long generation and not a page load. nginx
 * allows 300s on /api/ (deploy/nginx/crmx1.cutover.conf), so the request is
 * given up here first and the client sees an error rather than a dead socket.
 */
const TIMEOUT_MS = 180_000;

export class AiNotConfigured extends Error {}
export class AiUpstreamError extends Error {}

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function aiModel(): string {
  return process.env.PROPOSAL_AI_MODEL || DEFAULT_MODEL;
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
 * `strict: true` makes the API enforce the schema during decoding rather than
 * asking the model nicely, so the only parse failure left is a refusal or a
 * truncated response — both of which are reported as such instead of throwing
 * a bare SyntaxError.
 */
export async function completeJson<T>(options: {
  system: string;
  user: string;
  schemaName: string;
  schema: unknown;
  maxOutputTokens?: number;
}): Promise<CompletionResult<T>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AiNotConfigured(
      "Proposal AI is not configured — OPENAI_API_KEY is not set on the API.",
    );
  }

  const model = aiModel();
  const budget = options.maxOutputTokens ?? 16_000;

  const post = (legacyTokenParam: boolean) =>
    fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.user },
        ],
        // The gpt-5 family rejects `max_tokens` outright and wants
        // `max_completion_tokens`; models before it accept only the old name.
        // PROPOSAL_AI_MODEL is configurable, so both spellings have to work
        // rather than the default being the only one that does. The budget is
        // generous because a reasoning model spends part of it before writing
        // a single visible token.
        ...(legacyTokenParam
          ? { max_tokens: budget }
          : { max_completion_tokens: budget }),
        // `temperature` is deliberately absent: gpt-5 accepts only its default
        // and 400s on any explicit value, including 1. Omitting it is the one
        // spelling every model agrees on.
        response_format: {
          type: "json_schema",
          json_schema: {
            name: options.schemaName,
            strict: true,
            schema: options.schema,
          },
        },
      }),
    }).catch((error: unknown) => {
      // A timeout surfaces as a bare AbortError, which says nothing useful in
      // a toast.
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new AiUpstreamError(
          "The model took longer than three minutes and the request was given up.",
        );
      }
      throw new AiUpstreamError(
        `Could not reach OpenAI: ${(error as Error).message}`,
      );
    });

  const readError = (body: string, status: number) => {
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      if (parsed.error?.message) return parsed.error.message;
    } catch {
      if (body) return body.slice(0, 400);
    }
    return `OpenAI responded ${status}`;
  };

  let response = await post(false);
  let text = await response.text();

  if (!response.ok) {
    const detail = readError(text, response.status);
    // The only 400 worth retrying: an older model that wants the old parameter
    // name. Anything else (bad key, quota, malformed schema) is reported.
    if (response.status === 400 && /max_completion_tokens/i.test(detail)) {
      response = await post(true);
      text = await response.text();
    }
    if (!response.ok) {
      throw new AiUpstreamError(readError(text, response.status));
    }
  }

  const payload = JSON.parse(text) as {
    model?: string;
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string | null; refusal?: string | null };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const choice = payload.choices?.[0];

  if (choice?.message?.refusal) {
    throw new AiUpstreamError(`The model declined: ${choice.message.refusal}`);
  }
  if (choice?.finish_reason === "length") {
    throw new AiUpstreamError(
      "The model ran out of output budget before finishing the proposal. Try again, or shorten the call notes.",
    );
  }

  const content = choice?.message?.content;
  if (!content) {
    throw new AiUpstreamError("OpenAI returned an empty response.");
  }

  let data: T;
  try {
    data = JSON.parse(content) as T;
  } catch {
    throw new AiUpstreamError("OpenAI returned something that was not JSON.");
  }

  return {
    data,
    model: payload.model ?? model,
    promptTokens: payload.usage?.prompt_tokens ?? 0,
    completionTokens: payload.usage?.completion_tokens ?? 0,
  };
}
