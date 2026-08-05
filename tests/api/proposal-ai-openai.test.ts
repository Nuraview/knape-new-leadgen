/**
 * The OpenAI request shape.
 *
 * Worth testing because it cannot be verified any other way here: there is no
 * API key in the dev environment, so the only check on "does this request look
 * right" is this file. The parameter names are the specific risk — the gpt-5
 * family and everything before it disagree about how to spell the output
 * budget, and PROPOSAL_AI_MODEL is configurable, so both spellings have to
 * work.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiNotConfigured,
  AiUpstreamError,
  completeJson,
} from "../../apps/api/src/proposal/ai/openai";

const okBody = (content: unknown) =>
  JSON.stringify({
    model: "gpt-5",
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 11, completion_tokens: 22 },
  });

const response = (body: string, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => body }) as Response;

const call = () =>
  completeJson<{ ok: boolean }>({
    system: "sys",
    user: "usr",
    schemaName: "proposal_draft",
    schema: { type: "object" },
  });

/** The JSON body of the nth fetch call. */
const sentBody = (fetchMock: ReturnType<typeof vi.fn>, n = 0) =>
  JSON.parse((fetchMock.mock.calls[n]?.[1] as RequestInit).body as string);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
  delete process.env.PROPOSAL_AI_MODEL;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
});

describe("completeJson", () => {
  it("refuses to call out without a key", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(call()).rejects.toBeInstanceOf(AiNotConfigured);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the gpt-5 parameter spelling and no temperature", async () => {
    fetchMock.mockResolvedValue(response(okBody({ ok: true })));
    await call();

    const body = sentBody(fetchMock);
    expect(body.max_completion_tokens).toBeGreaterThan(0);
    expect(body).not.toHaveProperty("max_tokens");
    // gpt-5 400s on any explicit temperature, including 1.
    expect(body).not.toHaveProperty("temperature");
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it("honours PROPOSAL_AI_MODEL", async () => {
    process.env.PROPOSAL_AI_MODEL = "gpt-4o";
    fetchMock.mockResolvedValue(response(okBody({ ok: true })));
    await call();
    expect(sentBody(fetchMock).model).toBe("gpt-4o");
  });

  it("retries with max_tokens for a model that rejects the new name", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response(
          JSON.stringify({
            error: { message: "Unsupported parameter: 'max_completion_tokens'" },
          }),
          400,
        ),
      )
      .mockResolvedValueOnce(response(okBody({ ok: true })));

    const result = await call();

    expect(result.data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(fetchMock, 1)).toHaveProperty("max_tokens");
    expect(sentBody(fetchMock, 1)).not.toHaveProperty("max_completion_tokens");
  });

  it("does not retry a 400 that is about something else", async () => {
    // A bad schema or a bad key must surface, not be papered over by a second
    // identical failure.
    fetchMock.mockResolvedValue(
      response(JSON.stringify({ error: { message: "Invalid schema" } }), 400),
    );

    await expect(call()).rejects.toThrow(/invalid schema/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces the upstream message rather than a bare status", async () => {
    fetchMock.mockResolvedValue(
      response(
        JSON.stringify({ error: { message: "You exceeded your current quota" } }),
        429,
      ),
    );
    await expect(call()).rejects.toThrow(/quota/i);
  });

  it("reports a truncated answer as such", async () => {
    // Silently parsing a cut-off response yields a proposal missing its last
    // sections, which reads as a model quality problem rather than a budget one.
    fetchMock.mockResolvedValue(
      response(
        JSON.stringify({
          choices: [{ finish_reason: "length", message: { content: "{" } }],
        }),
      ),
    );
    await expect(call()).rejects.toThrow(/output budget/i);
  });

  it("reports a refusal", async () => {
    fetchMock.mockResolvedValue(
      response(
        JSON.stringify({
          choices: [{ message: { refusal: "I cannot help with that" } }],
        }),
      ),
    );
    await expect(call()).rejects.toThrow(/declined/i);
  });

  it("turns a timeout into something readable", async () => {
    const timeout = new Error("aborted");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValue(timeout);

    await expect(call()).rejects.toBeInstanceOf(AiUpstreamError);
    await expect(call()).rejects.toThrow(/three minutes/i);
  });

  it("returns the token counts for the activity trail", async () => {
    fetchMock.mockResolvedValue(response(okBody({ ok: true })));
    const result = await call();
    expect(result).toMatchObject({ promptTokens: 11, completionTokens: 22 });
  });
});
