/**
 * Auth for the scheduled-job endpoints.
 *
 * These are called by the VPS crontab (and, later, by whatever scheduler
 * replaces it), not by a browser, so they mount before the session middleware
 * and carry a shared secret instead of a cookie.
 *
 * ---------------------------------------------------------------------------
 * Deliberately NOT a copy of the legacy check. apps/web's cron routes did:
 *
 *     if (req.headers.get("x-vercel-cron")) return true;   // (1)
 *     const secret = process.env.CRON_SECRET;
 *     if (!secret) return true;                            // (2)
 *
 * (1) was safe on Vercel, where the platform sets that header and strips it
 *     from inbound requests. NuraView is self-hosted behind nginx now, where
 *     nothing strips it — so ANY caller could set the header and run the job
 *     unauthenticated. Confirmed against production on 2026-07-28:
 *     `curl -H "x-vercel-cron: 1" .../api/cron/marketing-bounces` ran a real
 *     bounce poll. The three routes carrying this check include
 *     marketing-followups, which sends email.
 *
 * (2) fails OPEN: forget to set CRON_SECRET and every job becomes public.
 *
 * Both are gone. The secret is required, and it is the only way in.
 * ---------------------------------------------------------------------------
 */
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

/**
 * Length-then-value compare. Not constant-time, matching the rest of the
 * codebase's shared-secret checks — the secret is a 32+ char random string on
 * a private host, not a user-supplied password.
 */
function matches(candidate: string, expected: string): boolean {
  return candidate.length === expected.length && candidate === expected;
}

export async function requireCronSecret(c: Context, next: Next) {
  const expected = process.env.CRON_SECRET;

  // Fail CLOSED. An unset secret is a deployment error, not permission to run
  // the job — and answering 500 makes that obvious in the cron log instead of
  // silently leaving the endpoint open.
  if (!expected) {
    throw new HTTPException(500, {
      message: "CRON_SECRET is not configured on the server",
    });
  }

  const header = c.req.header("authorization") ?? "";
  const headerToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  // The VPS crontab passes ?secret=… ; keep accepting it so the existing
  // /usr/local/bin/nuraview-reminder-cron.sh keeps working unchanged.
  const queryToken = c.req.query("secret") ?? "";

  if (!matches(headerToken, expected) && !matches(queryToken, expected)) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  await next();
}
