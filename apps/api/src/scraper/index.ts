/**
 * Scraper health and Upwork cookie management — the System Health tab.
 *
 * Ported from apps/web/app/api/scraper/{health,cookies}. These are the
 * session-authed, human-facing counterparts to the bearer-authed /api/ingest
 * routes the scraper itself calls.
 *
 * `/health` is what tells the team whether lead generation is actually alive.
 * It is deliberately full CRM access only — it exposes keyword lists, error
 * strings and inflow rates.
 */
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import crmDb from "../database/crm";
import { resolveCrmActorId } from "../lead/crm-actor";
import { requireCrmAccess } from "../utils/require-crm-access";

function rows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return ((result as { rows?: unknown[] })?.rows ?? []) as Record<
    string,
    unknown
  >[];
}

/**
 * Normalise whatever the driver hands back into real ISO-8601.
 *
 * Three shapes arrive here and they need different handling:
 *   - a Date              → already unambiguous
 *   - "…+00" / "…+05:30" / "…Z"  → carries an offset, parse as-is
 *   - "2026-04-23T12:51:00.000"  → naive; Postgres stored it as UTC, but
 *                                  `new Date` would read it as LOCAL time
 *
 * The legacy version appended "Z" to anything that didn't end in a two-part
 * offset. node-postgres returns `+00` here (offset with no minutes), which that
 * test misses, producing "…+00Z". JS happens to parse that anyway, so nothing
 * broke — but it is not valid ISO and a stricter consumer would reject it.
 */
function toIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();

  const s = String(v).trim();
  const hasOffset = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(s);
  const parsed = new Date(hasOffset ? s : `${s}Z`);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Shared 10s cache with in-flight coalescing.
 *
 * computeHealth runs 7 queries including a DISTINCT ON over the whole
 * scrape_runs table (~47ms). Several panels poll this and several operators may
 * have the page open, so without the cache one page-load fans out to dozens of
 * round-trips. The payload is global, not per-user, so one result serves
 * everyone. `inflight` collapses a concurrent burst into a single query.
 */
const CACHE_TTL_MS = 10_000;
type HealthPayload = Awaited<ReturnType<typeof computeHealth>>;
let cache: { at: number; data: HealthPayload } | null = null;
let inflight: Promise<HealthPayload> | null = null;

export async function getHealth(): Promise<HealthPayload> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  if (inflight) return inflight;

  inflight = computeHealth()
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

async function computeHealth() {
  // Heartbeat (singleton row, enforced by CHECK).
  const hb = rows(
    await crmDb.execute(sql`
      SELECT updated_at,
             cookies_count, cookies_present, cookies_min_expiry, cookies_hard_expired,
             cookies_working, cookies_signal, cookies_client_info_rate,
             scraper_healthy, scraper_version, gemini_enabled,
             keywords, current_keyword, last_error
        FROM scraper_heartbeat WHERE id = 1
    `),
  )[0];

  const heartbeat = hb
    ? {
        ...hb,
        updated_at: toIso(hb.updated_at),
        cookies_min_expiry: toIso(hb.cookies_min_expiry),
      }
    : null;

  // Currently running. At most one in practice — the scraper holds a mutex.
  // Rows older than 30 min are orphans from a crashed pusher and must never
  // show as live; they surface as 'failed' in the recent list below.
  const running = rows(
    await crmDb.execute(sql`
      SELECT id, query, started_at, jobs_expected
        FROM scrape_runs
       WHERE status = 'running'
         AND started_at > now() - interval '30 minutes'
       ORDER BY started_at DESC
    `),
  ).map((r) => ({ ...r, started_at: toIso(r.started_at) }));

  // Recent runs, with stale 'running' reclassified as failed so the UI labels
  // them correctly.
  const recent = rows(
    await crmDb.execute(sql`
      SELECT id, query,
             CASE
               WHEN status = 'running' AND started_at <= now() - interval '30 minutes'
                 THEN 'failed'
               ELSE status
             END AS status,
             started_at, finished_at,
             jobs_expected, jobs_found, jobs_inserted, jobs_updated,
             COALESCE(error,
               CASE WHEN status = 'running' AND started_at <= now() - interval '30 minutes'
                    THEN 'stale — no finish event (pusher likely restarted)'
                    ELSE NULL END
             ) AS error
        FROM scrape_runs
        WHERE NOT (status = 'running' AND started_at > now() - interval '30 minutes')
        ORDER BY started_at DESC
        LIMIT 20
    `),
  ).map((r) => ({
    ...r,
    started_at: toIso(r.started_at),
    finished_at: toIso(r.finished_at),
  }));

  // 24h aggregates, counting only "real" outcomes. A run interrupted by a
  // pusher restart is us rebuilding a container, not a scraper failure, and
  // must not drag down the success rate.
  const agg = rows(
    await crmDb.execute(sql`
      WITH real AS (
        SELECT status, jobs_found, jobs_inserted, jobs_updated, error
          FROM scrape_runs
         WHERE started_at > now() - interval '24 hours'
           AND NOT (
                status = 'failed'
                AND (error LIKE 'interrupted%' OR error LIKE 'stale%')
           )
           AND NOT (
                status = 'running'
                AND started_at <= now() - interval '30 minutes'
           )
      )
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_24h,
        COUNT(*) FILTER (WHERE status = 'failed')::int    AS failed_24h,
        COALESCE(SUM(jobs_found)    FILTER (WHERE status = 'completed')::int, 0) AS jobs_found_24h,
        COALESCE(SUM(jobs_inserted) FILTER (WHERE status = 'completed')::int, 0) AS jobs_inserted_24h,
        COALESCE(SUM(jobs_updated)  FILTER (WHERE status = 'completed')::int, 0) AS jobs_updated_24h
      FROM real
    `),
  )[0] ?? {
    completed_24h: 0,
    failed_24h: 0,
    jobs_found_24h: 0,
    jobs_inserted_24h: 0,
    jobs_updated_24h: 0,
  };

  // 30-min window drives the banner. The 24h number is honest but misleading
  // after an outage: thousands of failures linger for hours after recovery and
  // the banner keeps shouting "lead flow compromised" while leads visibly flow.
  const aggRecent = rows(
    await crmDb.execute(sql`
      WITH real AS (
        SELECT status
          FROM scrape_runs
         WHERE started_at > now() - interval '30 minutes'
           AND NOT (
                status = 'failed'
                AND (error LIKE 'interrupted%' OR error LIKE 'stale%')
           )
           AND NOT (
                status = 'running'
                AND started_at <= now() - interval '30 minutes'
           )
      )
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_30m,
        COUNT(*) FILTER (WHERE status = 'failed')::int    AS failed_30m
      FROM real
    `),
  )[0] ?? { completed_30m: 0, failed_30m: 0 };

  // Actual lead inflow — ground truth for "is the pipeline producing output".
  // The success rate can be poisoned by a flaky upstream while the keywords
  // that DO succeed still produce a steady trickle.
  //
  // NB: "createdAt" is CAMEL-cased in Postgres (legacy from the Mongo→Prisma
  // migration) unlike everything else here. An earlier version of this query
  // said created_at and 500'd the entire System Health panel.
  const flow = rows(
    await crmDb.execute(sql`
      SELECT
        MAX(extracted_at) AS last_extracted_at,
        COUNT(*) FILTER (WHERE extracted_at > now() - interval '30 minutes')::int
          AS inserted_30m
        FROM "crm_Leads"
       WHERE "createdAt" > now() - interval '24 hours'
         AND extracted_at IS NOT NULL
    `),
  )[0];

  const lead_flow = {
    last_extracted_at: toIso(flow?.last_extracted_at ?? null),
    inserted_30m: Number(flow?.inserted_30m ?? 0),
  };

  // Latest run per keyword, same stale reclassification so the rotation grid
  // can't show RUNNING for a tile that hasn't moved in hours.
  const per_keyword = rows(
    await crmDb.execute(sql`
      SELECT DISTINCT ON (query)
             query,
             CASE
               WHEN status = 'running' AND started_at <= now() - interval '30 minutes'
                 THEN 'failed'
               ELSE status
             END AS status,
             started_at, finished_at,
             jobs_found, jobs_inserted, jobs_updated,
             COALESCE(error,
               CASE WHEN status = 'running' AND started_at <= now() - interval '30 minutes'
                    THEN 'stale — pusher restarted'
                    ELSE NULL END
             ) AS error
        FROM scrape_runs
        ORDER BY query, started_at DESC
    `),
  ).map((r) => ({
    ...r,
    started_at: toIso(r.started_at),
    finished_at: toIso(r.finished_at),
  }));

  return {
    heartbeat,
    running,
    recent,
    aggregates_24h: agg,
    aggregates_recent_30m: aggRecent,
    lead_flow,
    per_keyword,
  };
}

type CookieRecord = { name: string; value: string; domain: string };

/** Minimal shape check — every cookie needs name + value + domain. */
function validateCookies(
  raw: unknown,
): { ok: true; cookies: CookieRecord[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "Cookies must be a JSON array" };
  if (raw.length === 0) return { ok: false, error: "Cookies array is empty" };

  for (const c of raw) {
    if (
      typeof c !== "object" ||
      c === null ||
      typeof (c as CookieRecord).name !== "string" ||
      typeof (c as CookieRecord).value !== "string" ||
      typeof (c as CookieRecord).domain !== "string"
    ) {
      return {
        ok: false,
        error: "Each cookie needs name, value, domain strings",
      };
    }
  }

  return { ok: true, cookies: raw as CookieRecord[] };
}

const scraper = new Hono<{
  Variables: { userId: string; userEmail: string };
}>()
  .use("*", requireCrmAccess)
  .get("/health", async (c) => c.json(await getHealth()))
  /** Metadata only — cookie VALUES are never returned to a browser. */
  .get("/cookies", async (c) => {
    const row = rows(
      await crmDb.execute(sql`
        SELECT uploaded_at, uploaded_by, jsonb_array_length(cookies) AS count
          FROM scraper_cookies WHERE id = 1
      `),
    )[0];

    if (!row) return c.json({ uploaded_at: null, count: 0, uploaded_by: null });

    return c.json({
      uploaded_at: toIso(row.uploaded_at),
      count: Number(row.count ?? 0),
      uploaded_by: row.uploaded_by,
    });
  })
  /**
   * Upload a fresh Upwork cookies.json — the human-in-the-loop refresh for the
   * scraper's session. Accepts a raw JSON array or a multipart file, matching
   * the legacy contract the upload button already speaks.
   */
  .post("/cookies", async (c) => {
    let parsed: unknown;
    try {
      const contentType = c.req.header("content-type") ?? "";
      if (contentType.includes("multipart/form-data")) {
        const form = await c.req.formData();
        const file = form.get("file");
        if (!file || typeof file === "string") {
          throw new Error("Missing 'file' field");
        }
        parsed = JSON.parse(await file.text());
      } else {
        parsed = await c.req.json();
      }
    } catch (e) {
      throw new HTTPException(400, {
        message: `Invalid input: ${(e as Error).message || "unparseable"}`,
      });
    }

    const validated = validateCookies(parsed);
    if (!validated.ok) {
      throw new HTTPException(400, { message: validated.error });
    }

    // uploaded_by is a CRM user uuid; our identities live in the other
    // database, so resolve by email and write NULL when unmatched rather than
    // failing the upload over attribution.
    const actorId = await resolveCrmActorId(c.get("userEmail"));

    await crmDb.execute(sql`
      INSERT INTO scraper_cookies (id, uploaded_at, uploaded_by, cookies)
      VALUES (1, now(), ${actorId}::uuid, ${JSON.stringify(validated.cookies)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        uploaded_at = now(),
        uploaded_by = EXCLUDED.uploaded_by,
        cookies     = EXCLUDED.cookies
    `);

    return c.json({ ok: true, count: validated.cookies.length });
  });

export default scraper;
