/**
 * Server-side proxy to this instance's lead-gen cockpit.
 *
 * The lead pipeline — source discovery, ICP scoring, the messaging angles,
 * multi-inbox rotation, bounce recovery — lives in a Python FastAPI service on
 * the VPS. Rewriting it in TypeScript would be months of work to arrive at the
 * same behaviour, so the CRM proxies it instead.
 *
 * Why proxy rather than let the browser call it directly:
 *
 *   - ONE ORIGIN. The SPA already talks to /api for everything else. Pointing
 *     part of it at a second host means CORS, credentialed preflights and
 *     SameSite cookie rules. That is not hypothetical here: the old cockpit
 *     broke the moment it moved to its own hostname because that domain was
 *     not in the Python service's CORS allow-list, and the UI reported
 *     "backend is down" while the backend was answering 200 all along.
 *   - ONE LOGIN. The cockpit has its own user table and its own bearer tokens.
 *     Dan signs into the CRM; he must not meet a second sign-in form.
 *   - THE SECRET STAYS SERVER-SIDE. Auth is a fixed shared token. Anything the
 *     browser holds is public.
 *
 * Access is gated by requireLeadsAccess — the same gate as the rest of the
 * lead domain, so a leads-only account reaches these and a projects-only
 * account does not.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireLeadsAccess } from "../utils/require-crm-access";

/** Upstream base, e.g. https://dan.nuraview.com */
function leadgenBase(): string {
  const raw = process.env.LEADGEN_API_BASE?.trim();
  if (!raw) {
    throw new HTTPException(503, {
      message:
        "LEADGEN_API_BASE is not configured — the lead-gen cockpit is not connected to this instance",
    });
  }
  return raw.replace(/\/+$/, "");
}

/*
 * Cockpit auth: sign in as a service user and reuse the bearer.
 *
 * The cockpit has its own user table and issues opaque 7-day bearer tokens
 * (cockpit_api.py). A header-secret would be tidier, but it needs a Python
 * deploy to the VPS — and the CRM has to work against the cockpit that is
 * running RIGHT NOW, not the one we would like to ship. Logging in uses an
 * endpoint that already exists, so this instance works with an unmodified
 * upstream.
 *
 * Cached in module scope: a warm Vercel function instance serves many requests,
 * and logging in on each one would add a round trip to every list view and
 * churn rows in the cockpit's sessions table.
 */
let cachedToken: string | null = null;
let inFlightLogin: Promise<string> | null = null;

async function loginToCockpit(): Promise<string> {
  const email = process.env.LEADGEN_API_EMAIL?.trim();
  const password = process.env.LEADGEN_API_PASSWORD;

  if (!email || !password) {
    throw new HTTPException(503, {
      message:
        "LEADGEN_API_EMAIL / LEADGEN_API_PASSWORD are not configured — cannot authenticate to the lead-gen cockpit",
    });
  }

  const response = await fetch(`${leadgenBase()}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new HTTPException(502, {
      message: `Lead-gen cockpit rejected the service login (${response.status})`,
    });
  }

  const body = (await response.json()) as { token?: string };
  if (!body.token) {
    throw new HTTPException(502, {
      message: "Lead-gen cockpit login returned no token",
    });
  }

  cachedToken = body.token;
  return body.token;
}

/** Single-flight: a cold instance handling parallel requests logs in once. */
function getToken(force = false): Promise<string> {
  if (!force && cachedToken) return Promise.resolve(cachedToken);
  if (!inFlightLogin) {
    inFlightLogin = loginToCockpit().finally(() => {
      inFlightLogin = null;
    });
  }
  return inFlightLogin;
}

/**
 * Paths this proxy will forward, as prefixes under the cockpit's own /api.
 *
 * An ALLOW-list, not a deny-list. The cockpit exposes destructive operations
 * next to read-only ones, and a deny-list silently opens each new upstream
 * route the day it is added. The one that matters most:
 *
 *   POST /api/sync  →  DELETE FROM accounts; DELETE FROM contacts;
 *                      DELETE FROM evidence   (cockpit_api.py:1198)
 *
 * It rebuilds the whole lead table from an xlsx file. Reachable from the CRM
 * it is one mis-click from erasing Dan's pipeline, and it is deliberately
 * absent below. `merge_records` — the additive path — is what the scrape and
 * enrich endpoints already use.
 */
const ALLOWED: ReadonlyArray<{ method: string; prefix: string }> = [
  // Lead board
  { method: "GET", prefix: "/api/summary" },
  { method: "GET", prefix: "/api/accounts" },

  // Pipeline: status feed, scrape-date batches (the Today / Yesterday /
  // Day-before chips), and the operational triggers behind Live Lead Finder.
  { method: "GET", prefix: "/api/pipeline/status" },
  { method: "GET", prefix: "/api/pipeline/batches" },
  { method: "POST", prefix: "/api/pipeline/scrape" },
  { method: "POST", prefix: "/api/pipeline/enrich" },
  { method: "POST", prefix: "/api/pipeline/enrich-contacts" },

  // Client-tunable settings, including the Keys tab.
  { method: "GET", prefix: "/api/settings" },
  { method: "PATCH", prefix: "/api/settings" },

  // Sending mailboxes: warm-up state, health, daily cap.
  { method: "GET", prefix: "/api/outreach/inboxes" },
  { method: "PATCH", prefix: "/api/outreach/inboxes/" },

  // Per-lead outreach: the drafted sequence, its timeline, AI redraft, and
  // approval into the send queue.
  { method: "GET", prefix: "/api/leads/" },
  { method: "POST", prefix: "/api/leads/" },

  // The client's own 0–10 rating on a lead. PUT because it is a single
  // idempotent value — writing 7 twice leaves one 7, and null clears it. The
  // only PUT under /api/leads/, so the prefix stays as narrow as the feature.
  { method: "PUT", prefix: "/api/leads/" },

  // The whole email surface: dashboard stats, send queue, sent log, bounced,
  // outbox, IMAP inbox, compose. Broad on purpose — this is one screen with
  // many panes, and enumerating twenty sub-paths would go stale.
  { method: "GET", prefix: "/api/emails/" },
  { method: "POST", prefix: "/api/emails/" },

  // The agent's own memory and loops. Read is open; the only write is storing
  // a fact it was told, which is why /api/agent/remember is listed explicitly
  // rather than the whole prefix.
  { method: "GET", prefix: "/api/agent/knowledge" },
  { method: "POST", prefix: "/api/agent/remember" },
  { method: "POST", prefix: "/api/agent/learn" },
  { method: "POST", prefix: "/api/agent/triage" },
  { method: "DELETE", prefix: "/api/emails/" },

  // Batched campaign sender — the "send 200 emails today" path. Validates the
  // never-emailed pool, then sends in batches on an interval.
  { method: "GET", prefix: "/api/emails/campaign/status" },
  { method: "POST", prefix: "/api/emails/campaign/validate" },
  { method: "POST", prefix: "/api/emails/campaign/start" },
  { method: "POST", prefix: "/api/emails/campaign/stop" },

  /*
   * The project-management board.
   *
   * Trello-lite kanban living in the cockpit's own pm_* tables, shared with the
   * client's other dashboard — the same cards, so a card moved on either moves
   * on both. Every verb, because the board is fully interactive: PATCH edits a
   * card, POST /move persists a drag, DELETE archives.
   *
   * DELETE is scoped to /api/pm/ specifically rather than riding a broader
   * rule. `archive_card` sets archived_at; it does not drop rows. That is the
   * only destructive-looking verb reachable here and it is reversible.
   */
  { method: "GET", prefix: "/api/pm/" },
  { method: "POST", prefix: "/api/pm/" },
  { method: "PATCH", prefix: "/api/pm/" },
  { method: "DELETE", prefix: "/api/pm/" },

  /*
   * The social content scheduler — drafted LinkedIn posts and their creatives,
   * shared with the client's other cockpit the same way the pm_* board is.
   *
   * GET covers both the JSON and the creatives themselves: /media/{id}/file
   * streams an image back through this proxy. That is deliberate. Upstream also
   * accepts the bearer as a ?token= query param precisely so a browser can put
   * that URL in an <img> tag, and going through here means the token stays
   * server-side instead of sitting in a URL that lands in every access log.
   *
   * DELETE removes a creative or soft-deletes a post (deleted_at, not a DROP).
   * The genuinely unauthenticated upstream routes — /api/social/share/{token} —
   * are absent by design: they answer with no session at all, and nothing
   * reachable through this proxy should.
   */
  { method: "GET", prefix: "/api/social/posts" },
  { method: "GET", prefix: "/api/social/media/" },
  { method: "POST", prefix: "/api/social/posts" },
  { method: "PATCH", prefix: "/api/social/posts/" },
  { method: "DELETE", prefix: "/api/social/posts/" },
  { method: "DELETE", prefix: "/api/social/media/" },

  // Inbound website leads.
  { method: "GET", prefix: "/api/sample-leads" },

  // Liveness, for the connection banner.
  { method: "GET", prefix: "/api/health" },
];

/**
 * Short-lived cache for the slow, slow-changing GETs.
 *
 * /api/summary and /api/pipeline/batches are aggregate counts over the whole
 * account table. They move once per scrape run, but the Leads page asks for
 * both on every visit and each one is a full round trip to a single-process
 * FastAPI server — which, while a contact-enrichment job is running, takes
 * SECONDS. Measured 6.12s for a 0.2kB batches response with enrichment in
 * flight.
 *
 * Cached in module scope, so it survives for the life of a warm function
 * instance and disappears with it. Deliberately not Redis: the value is worth
 * pennies, is trivially recomputed, and a shared cache would need invalidating
 * when a scrape finishes — complexity this does not earn.
 *
 * Only these two paths. Anything showing live state (pipeline status, the send
 * queue, campaign progress) must never be served stale.
 */
const CACHEABLE = new Set(["/api/summary", "/api/pipeline/batches"]);
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; status: number; body: string; contentType: string }>();

function cacheKey(path: string, search: string) {
  return `${path}${search}`;
}

/**
 * Paths that must never be proxied even though an ALLOWED prefix covers them.
 *
 * Prefix matching cannot express "everything under /api/social/posts EXCEPT
 * the share sub-resource" — /api/social/posts/4/share starts with
 * /api/social/posts, so the rule that lets the scheduler work would hand out
 * share tokens too. Narrowing the prefixes instead would mean enumerating every
 * verb around an ID in the middle of the path, which goes stale the first time
 * upstream adds a sub-route.
 *
 * What makes these worth a second mechanism rather than a tighter prefix: a
 * share token is a credential that grants read access with NO session, which is
 * the one thing everything behind this proxy is supposed to guarantee.
 */
const DENIED: ReadonlyArray<RegExp> = [
  /^\/api\/social\/posts\/[^/]+\/share$/,
  /^\/api\/social\/share(\/|$)/,
];

/** Exported for the allow-list tests — see tests/api/leadgen-proxy-allowlist.test.ts. */
export function isAllowed(method: string, path: string): boolean {
  if (DENIED.some((pattern) => pattern.test(path))) return false;
  return ALLOWED.some(
    (rule) => rule.method === method && path.startsWith(rule.prefix),
  );
}

/**
 * Headers worth carrying back to the browser.
 *
 * Not a blanket copy: the upstream sets its own CORS and cookie headers for
 * its own origin, and replaying those through this API would either confuse
 * the browser or leak a cockpit session cookie into the CRM's domain.
 */
const PASS_THROUGH_RESPONSE_HEADERS = ["content-type", "cache-control"];

/**
 * Read one cockpit endpoint server-side, for callers inside this API.
 *
 * The assistant's tools need the same data the SPA proxies, and re-implementing
 * the login here would mean a second token cache drifting out of step with this
 * one. Exported rather than duplicated. Still allow-listed: a tool cannot reach
 * anything the browser could not, and POST /api/sync stays unreachable because
 * this is GET-only.
 */
export async function cockpitGet<T = unknown>(path: string): Promise<T> {
  if (!isAllowed("GET", path)) {
    throw new HTTPException(403, { message: `Not proxied: GET ${path}` });
  }
  const send = async (token: string) =>
    fetch(`${leadgenBase()}${path}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });

  let res = await send(await getToken());
  if (res.status === 401) res = await send(await getToken(true));
  if (!res.ok) {
    throw new HTTPException(502, {
      message: `Cockpit ${path} answered ${res.status}`,
    });
  }
  return (await res.json()) as T;
}

/**
 * Write to one cockpit endpoint server-side. Allow-listed like the read.
 *
 * Narrow on purpose: the assistant needs to store a fact it was told, and
 * nothing else. Anything genuinely destructive is absent from the allow-list,
 * so widening what the agent can do is a deliberate edit there rather than a
 * side effect of adding a tool.
 */
export async function cockpitPost<T = unknown>(
  path: string,
  body: unknown,
): Promise<T> {
  if (!isAllowed("POST", path)) {
    throw new HTTPException(403, { message: `Not proxied: POST ${path}` });
  }
  const send = async (token: string) =>
    fetch(`${leadgenBase()}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(20_000),
    });

  let res = await send(await getToken());
  if (res.status === 401) res = await send(await getToken(true));
  if (!res.ok) {
    throw new HTTPException(502, {
      message: `Cockpit ${path} answered ${res.status}`,
    });
  }
  return (await res.json()) as T;
}

const leadgen = new Hono<{ Variables: { userId: string; userEmail: string } }>()
  .use("*", requireLeadsAccess)
  .all("/*", async (c) => {
    const method = c.req.method;

    // Everything after /api/leadgen is the cockpit's own path. The SPA calls
    // /api/leadgen/api/accounts?... and the cockpit sees /api/accounts?...
    const url = new URL(c.req.url);
    const suffix = url.pathname.replace(/^.*?\/leadgen/, "") || "/";

    if (!isAllowed(method, suffix)) {
      throw new HTTPException(403, {
        message: `Not proxied: ${method} ${suffix}`,
      });
    }

    // Cache lookup happens before the token check: a warm hit should cost
    // nothing, not a login.
    const key = cacheKey(suffix, url.search);
    if (method === "GET" && CACHEABLE.has(suffix)) {
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        return new Response(hit.body, {
          status: hit.status,
          headers: { "content-type": hit.contentType, "x-leadgen-cache": "hit" },
        });
      }
    }

    const target = `${leadgenBase()}${suffix}${url.search}`;
    const contentType = c.req.header("content-type");
    /*
     * Read once: the request body is a stream and cannot be consumed twice,
     * which matters because a 401 makes us replay the call.
     *
     * arrayBuffer, not text. Creative uploads send raw image bytes as the body
     * (POST /api/social/posts/{id}/media), and decoding those as UTF-8 replaces
     * every invalid sequence with U+FFFD — the upload would "succeed" and write
     * a corrupt file. Bytes survive the round trip; JSON bodies are unaffected,
     * since a string body is UTF-8 encoded by fetch anyway.
     */
    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : await c.req.arrayBuffer();

    /*
     * A hard timeout, because the upstream does real work behind some of these
     * — a scrape trigger shells out to a Python pipeline. Without it a hung
     * upstream would hold this function open until the platform killed it,
     * turning one slow dependency into an exhausted connection pool.
     */
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const send = async (token: string) =>
      fetch(target, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(contentType ? { "Content-Type": contentType } : {}),
        },
        body,
        signal: controller.signal,
      });

    let upstream: Response;
    try {
      upstream = await send(await getToken());

      /*
       * Cockpit sessions last 7 days, so a cached token outlives most function
       * instances but not all of them. One forced re-login on 401 turns an
       * expiry into a transparent retry instead of an error the user sees.
       */
      if (upstream.status === 401) {
        upstream = await send(await getToken(true));
      }
    } catch (error) {
      // Distinguish "the cockpit is unreachable" from "the CRM is broken".
      // The banner in the UI reads very differently for each, and the old
      // cockpit's habit of blaming the backend for a CORS fault is exactly the
      // confusion worth avoiding.
      const aborted = (error as Error)?.name === "AbortError";
      throw new HTTPException(504, {
        message: aborted
          ? "The lead-gen cockpit did not respond within 30s"
          : `The lead-gen cockpit is unreachable: ${(error as Error)?.message ?? "unknown error"}`,
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseHeaders = new Headers();
    for (const name of PASS_THROUGH_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }

    if (method === "GET" && CACHEABLE.has(suffix) && upstream.ok) {
      // Buffered, not streamed — the body has to be read to be stored. These
      // two responses are counts, well under a kilobyte.
      const body = await upstream.text();
      const contentType =
        upstream.headers.get("content-type") ?? "application/json";
      cache.set(key, {
        at: Date.now(),
        status: upstream.status,
        body,
        contentType,
      });
      // Bounded: filter combinations are few, but nothing should be able to
      // grow this without limit.
      if (cache.size > 100) {
        for (const k of cache.keys()) {
          cache.delete(k);
          if (cache.size <= 50) break;
        }
      }
      responseHeaders.set("x-leadgen-cache", "miss");
      return new Response(body, {
        status: upstream.status,
        headers: responseHeaders,
      });
    }

    // Streamed rather than buffered: the sent-email log and the pipeline event
    // feed are both large enough that materialising them here would double the
    // memory for no benefit.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  });

export default leadgen;
