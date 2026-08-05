/**
 * Shared helpers for the Twilio-called webhooks (/api/twilio/*).
 *
 * Ported from apps/web/lib/dialer/twilio-webhook.ts, INCLUDING its central
 * design decision, which is worth restating because the obvious alternative is
 * wrong:
 *
 *   Signature validation uses a PINNED public base URL
 *   (DIALER_PUBLIC_BASE_URL), not a URL reconstructed from x-forwarded-*.
 *
 * The generic advice for "signature verification behind a reverse proxy" is to
 * rebuild the canonical URL from X-Forwarded-Proto/Host, because the framework
 * sees http://127.0.0.1:3011/... The legacy code rejected that on purpose:
 * forwarded headers are ambiguous and spoofable, and — the part that actually
 * matters — the SAME pinned base URL is used to build the TwiML action URLs we
 * hand to Twilio. So what Twilio signs is byte-for-byte what we validate. A
 * reconstructed URL can drift from the one we told Twilio to call; a pinned one
 * cannot.
 *
 * Getting this wrong does not throw. Twilio simply receives 403s and inbound
 * calls stop, silently, which is why this file is ported before anything that
 * depends on it.
 *
 * Twilio POSTs application/x-www-form-urlencoded — never JSON.
 */
import type { Context } from "hono";
import twilio from "twilio";

export type TwilioParams = Record<string, string>;

export async function readTwilioParams(c: Context): Promise<TwilioParams> {
  if (c.req.method === "GET") {
    return Object.fromEntries(new URL(c.req.url).searchParams);
  }

  const form = await c.req.formData();
  const params: TwilioParams = {};
  form.forEach((v, k) => {
    params[k] = String(v);
  });
  return params;
}

/**
 * The public origin Twilio was told to call. Pinned, never derived from the
 * request. Throws rather than guessing: a wrong base silently 403s every
 * webhook, and a loud boot-time failure is far cheaper to diagnose.
 */
export function publicBaseUrl(): string {
  const base = process.env.DIALER_PUBLIC_BASE_URL || process.env.APP_URL;
  if (!base) throw new Error("DIALER_PUBLIC_BASE_URL not configured");
  return base.replace(/\/$/, "");
}

export function validateTwilioSignature(
  c: Context,
  params: TwilioParams,
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return false;

  const requestUrl = new URL(c.req.url);
  const url = publicBaseUrl() + requestUrl.pathname + requestUrl.search;

  return twilio.validateRequest(
    authToken,
    c.req.header("x-twilio-signature") ?? "",
    url,
    // For GET the params are already inside `url`'s query string; passing them
    // again would double-count them and never match.
    c.req.method === "GET" ? {} : params,
  );
}

export function twimlResponse(c: Context, xml: string) {
  return c.body(xml, 200, { "Content-Type": "text/xml" });
}

export function forbidden(c: Context) {
  return c.json({ error: "Invalid Twilio signature" }, 403);
}
