/**
 * Shared-secret auth for the machine callers: the Upwork scraper and the
 * WhatsApp bridge.
 *
 * Ported from apps/web/lib/ingest-auth.ts. These are NOT session routes — the
 * callers are containers on the VPS holding a bearer token, so they mount
 * BEFORE the session middleware and must be listed in PUBLIC_PREFIXES.
 *
 *   nuraview-scraper   Authorization: Bearer ${SCRAPER_API_KEY}
 *   nuraview-whatsapp  Authorization: Bearer ${WHATSAPP_API_KEY}
 *
 * A missing key on the server is a 500, not a 401: it means the operator
 * misconfigured the deploy, and answering 401 would send the scraper into a
 * retry loop against a server that can never accept it.
 */
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

function bearer(c: Context): string {
  const header = c.req.header("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

/**
 * Length check first, then compare. Not constant-time, and deliberately so —
 * matching the legacy behaviour. The threat model is a shared secret between
 * two containers on the same host, not a public credential endpoint.
 */
function requireKey(c: Context, envName: string) {
  const expected = process.env[envName];

  if (!expected) {
    throw new HTTPException(500, {
      message: `${envName} is not configured on the server`,
    });
  }

  const token = bearer(c);
  if (token.length !== expected.length || token !== expected) {
    throw new HTTPException(401, {
      message: "Invalid or missing Bearer token",
    });
  }
}

export async function requireScraperAuth(c: Context, next: Next) {
  requireKey(c, "SCRAPER_API_KEY");
  await next();
}

export async function requireWhatsappAuth(c: Context, next: Next) {
  requireKey(c, "WHATSAPP_API_KEY");
  await next();
}
