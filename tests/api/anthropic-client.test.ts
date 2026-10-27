/**
 * The Anthropic Messages API request shape.
 *
 * Worth testing because there is no API key in the dev environment, so the only
 * check on "does this request look right" is this file: the headers, the
 * forced structured-output tool, and how each failure reaches a salesperson.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiNotConfigured,
  AiUpstreamError,
  completeJson,
} from "../../apps/api/src/utils/anthropic";

const okBody = (input: unknown, stop_reason = "tool_use") =>
  JSON.stringify({
    model: "claude-haiku-5-5",
    stop_reason,
    content: [
      { type: "tool_use", id: "toolu_1", name: "proposal_draft", input },
    ],
    usage: { input_tokens: 11, output_tokens: 22 },
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

/** The nth fetch call's init. */
const sentInit = (fetchMock: ReturnType<typeof vi.fn>, n = 0) =>
  fetchMock.mock.calls[n]?.[1] as RequestInit;
const sentBody = (fetchMock: ReturnType<typeof vi.fn>, n = 0) =>
  JSON.parse(sentInit(fetchMock, n).body as string);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-a-real-key";
  delete process.env.ANTHROPIC_MODEL;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ANTHROPIC_API_KEY;
});

describe("completeJson", () => {
  it("refuses to call out without a key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(call()).rejects.toBeInstanceOf(AiNotConfigured);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the Messages API headers, default model and a forced tool", async () => {
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
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.tools[0]).toMatchObject({
      name: "proposal_draft",
      input_schema: { type: "object" },
    });
    expect(body.tool_choice).toEqual({ type: "tool", name: "proposal_draft" });
    expect(result.data).toEqual({ ok: true });
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
        JSON.stringify({
          type: "error",
          error: { type: "rate_limit_error", message: "Rate limit exceeded" },
        }),
        429,
      ),
    );
    await expect(call()).rejects.toThrow(/rate limit/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a truncated answer as such", async () => {
    // Silently using a cut-off response yields a proposal missing its last
    // sections, which reads as a model quality problem rather than a budget one.
    fetchMock.mockResolvedValue(response(okBody({ ok: true }, "max_tokens")));
    await expect(call()).rejects.toThrow(/output budget/i);
  });

  it("reports a refusal", async () => {
    fetchMock.mockResolvedValue(
      response(JSON.stringify({ stop_reason: "refusal", content: [] })),
    );
    await expect(call()).rejects.toThrow(/declined/i);
  });

  it("reports a response with no structured answer", async () => {
    fetchMock.mockResolvedValue(
      response(
        JSON.stringify({
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Here you go" }],
        }),
      ),
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

  it("returns the token counts for the activity trail", async () => {
    fetchMock.mockResolvedValue(response(okBody({ ok: true })));
    const result = await call();
    expect(result).toMatchObject({ promptTokens: 11, completionTokens: 22 });
  });
});
