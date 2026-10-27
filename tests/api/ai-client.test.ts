/**
 * The request shapes of utils/ai.ts, for both providers.
 *
 * Worth testing because there is no API key in the dev environment, so the only
 * check on "does this request look right" is this file: provider selection,
 * the headers, the forced structured-output tool, the OpenAI translation of the
 * shared message contract, and how each failure reaches a salesperson.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiNotConfigured,
  AiUpstreamError,
  aiModel,
  aiProvider,
  completeJson,
  createMessage,
  isAiConfigured,
} from "../../apps/api/src/utils/ai";

const ENV = [
  "AI_PROVIDER",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
];

const response = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }) as Response;

const call = () =>
  completeJson<{ ok: boolean }>({
    system: "sys",
    user: "usr",
    schemaName: "proposal_draft",
    schema: { type: "object" },
  });

const sentInit = (fetchMock: ReturnType<typeof vi.fn>, n = 0) =>
  fetchMock.mock.calls[n]?.[1] as RequestInit;
const sentBody = (fetchMock: ReturnType<typeof vi.fn>, n = 0) =>
  JSON.parse(sentInit(fetchMock, n).body as string);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const name of ENV) delete process.env[name];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ENV) delete process.env[name];
});

describe("provider selection", () => {
  it("is unconfigured with no key", async () => {
    expect(aiProvider()).toBeNull();
    expect(isAiConfigured()).toBe(false);
    await expect(call()).rejects.toBeInstanceOf(AiNotConfigured);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prefers Anthropic when its key is set and no provider is chosen", () => {
    process.env.ANTHROPIC_API_KEY = "a";
    process.env.OPENAI_API_KEY = "o";
    expect(aiProvider()).toBe("anthropic");
    expect(aiModel()).toBe("claude-haiku-5-5");
  });

  it("falls back to OpenAI when only its key is set", () => {
    process.env.OPENAI_API_KEY = "o";
    expect(aiProvider()).toBe("openai");
    expect(isAiConfigured()).toBe(true);
    expect(aiModel()).toBe("gpt-5.4-mini");
  });

  it("honours AI_PROVIDER over the key-based default", () => {
    process.env.ANTHROPIC_API_KEY = "a";
    process.env.OPENAI_API_KEY = "o";
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_MODEL = "gpt-5.4";
    expect(aiProvider()).toBe("openai");
    expect(aiModel()).toBe("gpt-5.4");
  });

  it("is unconfigured when the chosen provider has no key", async () => {
    process.env.ANTHROPIC_API_KEY = "a";
    process.env.AI_PROVIDER = "openai";
    expect(isAiConfigured()).toBe(false);
    await expect(call()).rejects.toThrow(/OPENAI_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Anthropic", () => {
  const okBody = (input: unknown, stop_reason = "tool_use") => ({
    model: "claude-haiku-5-5",
    stop_reason,
    content: [{ type: "tool_use", id: "toolu_1", name: "proposal_draft", input }],
    usage: { input_tokens: 11, output_tokens: 22 },
  });

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-a-real-key";
  });

  it("sends the Messages API headers, model and a forced tool", async () => {
    fetchMock.mockResolvedValue(response(okBody({ ok: true })));
    const result = await call();

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    const headers = sentInit(fetchMock).headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test-not-a-real-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");

    const body = sentBody(fetchMock);
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.system).toBe("sys");
    expect(body.messages).toEqual([{ role: "user", content: "usr" }]);
    expect(body).not.toHaveProperty("temperature");
    expect(body.tools[0]).toEqual({
      name: "proposal_draft",
      description: expect.any(String),
      input_schema: { type: "object" },
    });
    expect(body.tool_choice).toEqual({ type: "tool", name: "proposal_draft" });
    expect(result).toMatchObject({
      data: { ok: true },
      promptTokens: 11,
      completionTokens: 22,
    });
  });

  it("honours ANTHROPIC_MODEL", async () => {
    process.env.ANTHROPIC_MODEL = "claude-sonnet-4-5";
    fetchMock.mockResolvedValue(response(okBody({ ok: true })));
    await call();
    expect(sentBody(fetchMock).model).toBe("claude-sonnet-4-5");
  });

  it("surfaces the upstream message rather than a bare status", async () => {
    fetchMock.mockResolvedValue(
      response(
        { type: "error", error: { type: "rate_limit_error", message: "Rate limit exceeded" } },
        429,
      ),
    );
    await expect(call()).rejects.toThrow(/rate limit/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a truncated answer as such", async () => {
    fetchMock.mockResolvedValue(response(okBody({ ok: true }, "max_tokens")));
    await expect(call()).rejects.toThrow(/output budget/i);
  });

  it("reports a refusal", async () => {
    fetchMock.mockResolvedValue(response({ stop_reason: "refusal", content: [] }));
    await expect(call()).rejects.toThrow(/declined/i);
  });

  it("reports a response with no structured answer", async () => {
    fetchMock.mockResolvedValue(
      response({ stop_reason: "end_turn", content: [{ type: "text", text: "Here you go" }] }),
    );
    await expect(call()).rejects.toThrow(/no structured answer/i);
  });

  it("turns a timeout into something readable", async () => {
    const timeout = new Error("aborted");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValue(timeout);
    await expect(call()).rejects.toBeInstanceOf(AiUpstreamError);
    await expect(call()).rejects.toThrow(/180 seconds/i);
  });
});

describe("OpenAI", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
  });

  const functionCall = (args: string) => ({
    model: "gpt-5.4-mini",
    status: "completed",
    output: [
      { type: "reasoning", id: "rs_1", summary: [] },
      { type: "function_call", call_id: "call_1", name: "proposal_draft", arguments: args },
    ],
    usage: { input_tokens: 5, output_tokens: 7 },
  });

  it("sends a Responses API request with a strict forced function", async () => {
    fetchMock.mockResolvedValue(response(functionCall('{"ok":true}')));
    const result = await call();

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/responses");
    const headers = sentInit(fetchMock).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test-not-a-real-key");

    const body = sentBody(fetchMock);
    expect(body.model).toBe("gpt-5.4-mini");
    expect(body.instructions).toBe("sys");
    expect(body.input).toEqual([{ role: "user", content: "usr" }]);
    expect(body).not.toHaveProperty("temperature");
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body.max_output_tokens).toBeGreaterThan(16_000);
    expect(body.tools[0]).toEqual({
      type: "function",
      name: "proposal_draft",
      description: expect.any(String),
      parameters: { type: "object" },
      strict: true,
    });
    expect(body.tool_choice).toEqual({ type: "function", name: "proposal_draft" });
    expect(result).toMatchObject({
      data: { ok: true },
      model: "gpt-5.4-mini",
      promptTokens: 5,
      completionTokens: 7,
    });
  });

  it("maps output text, tool calls and stop reasons onto the shared shape", async () => {
    fetchMock.mockResolvedValueOnce(response(functionCall('{"q":"offshore"}')));
    const withCall = await createMessage({
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 100,
      tools: [{ name: "proposal_draft", input_schema: { type: "object" } }],
    });
    expect(withCall.stop_reason).toBe("tool_use");
    expect(withCall.content).toContainEqual({
      type: "tool_use",
      id: "call_1",
      name: "proposal_draft",
      input: { q: "offshore" },
    });
    // Non-structured tools are not strict: their schemas leave fields optional.
    expect(sentBody(fetchMock).tools[0].strict).toBe(false);

    fetchMock.mockResolvedValueOnce(
      response({
        status: "completed",
        output: [
          { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] },
        ],
      }),
    );
    const plain = await createMessage({
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 100,
    });
    expect(plain.stop_reason).toBe("end_turn");
    expect(plain.content).toContainEqual({ type: "text", text: "Done." });
  });

  it("echoes an OpenAI turn verbatim and sends tool results as function_call_output", async () => {
    fetchMock.mockResolvedValueOnce(response(functionCall("{}")));
    const first = await createMessage({
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 100,
    });

    fetchMock.mockResolvedValueOnce(
      response({ status: "completed", output: [] }),
    );
    await createMessage({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: first.content },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "call_1", content: '{"found":3}' }],
        },
      ],
      max_tokens: 100,
    });

    expect(sentBody(fetchMock, 1).input).toEqual([
      { role: "user", content: "hi" },
      { type: "reasoning", id: "rs_1", summary: [] },
      { type: "function_call", call_id: "call_1", name: "proposal_draft", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: '{"found":3}' },
    ]);
  });

  it("translates hand-built tool_use blocks into function calls", async () => {
    fetchMock.mockResolvedValue(response({ status: "completed", output: [] }));
    await createMessage({
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Looking." },
            { type: "tool_use", id: "c9", name: "search_leads", input: { query: "x" } },
          ],
        },
      ],
      max_tokens: 100,
    });
    expect(sentBody(fetchMock).input.slice(1)).toEqual([
      { role: "assistant", content: "Looking." },
      { type: "function_call", call_id: "c9", name: "search_leads", arguments: '{"query":"x"}' },
    ]);
  });

  it("reports a truncated answer as such", async () => {
    fetchMock.mockResolvedValue(
      response({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
      }),
    );
    await expect(call()).rejects.toThrow(/output budget/i);
  });

  it("reports a refusal", async () => {
    fetchMock.mockResolvedValue(
      response({
        status: "completed",
        output: [{ type: "message", content: [{ type: "refusal", refusal: "No." }] }],
      }),
    );
    await expect(call()).rejects.toThrow(/declined/i);
  });

  it("surfaces the upstream message rather than a bare status", async () => {
    fetchMock.mockResolvedValue(
      response({ error: { message: "You exceeded your current quota" } }, 429),
    );
    await expect(call()).rejects.toThrow(/quota/i);
  });
});
