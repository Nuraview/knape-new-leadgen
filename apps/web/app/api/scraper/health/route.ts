// Consolidated health view for the UI. Combines:
//   - scraper_heartbeat row (pusher-reported diagnostics)
//   - scrape_runs aggregates (per-keyword stats, today's success/fail counts)
//   - scrape_runs active rows (currently-running query)

import { NextResponse } from "next/server";

import { sql as dsql } from "drizzle-orm";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serialize Postgres TIMESTAMP (no tz) by appending 'Z' so the browser reads
// it as UTC. `db.execute` returns timestamps as strings like
// "2026-04-23T12:51:00.000" — without the Z, Date() interprets as local.
function toIso(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(v)) return v;
  return v + "Z";
}

// This endpoint runs 7 scrape_runs/heartbeat queries per call, including a
// ~47ms DISTINCT-ON over the whole scrape_runs table. Multiple panels poll
// it (ScraperHealth, LeadsTabs, HealthAlertBanner) and several operators may
// have the page open at once. The payload is global (not per-user), so a
// short shared cache collapses all of that into at most one DB round-trip
// per TTL window. An in-flight promise also coalesces a concurrent burst so
// the first caller's query serves everyone waiting (thundering-herd guard).
const CACHE_TTL_MS = 10_000;
type HealthPayload = Awaited<ReturnType<typeof computeHealth>>;
let cache: { at: number; data: HealthPayload } | null = null;
let inflight: Promise<HealthPayload> | null = null;

async function getHealth(): Promise<HealthPayload> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.data;
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

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  return NextResponse.json(await getHealth());
}

async function computeHealth() {
  // Heartbeat row (single row, singleton enforced by CHECK).
  const hbRes: any = await db.execute(dsql`
    SELECT updated_at,
           cookies_count, cookies_present, cookies_min_expiry, cookies_hard_expired,
           cookies_working, cookies_signal, cookies_client_info_rate,
           scraper_healthy, scraper_version, gemini_enabled,
           keywords, current_keyword, last_error
      FROM scraper_heartbeat WHERE id = 1
  `);
  const hbRows = Array.isArray(hbRes) ? hbRes : (hbRes?.rows ?? []);
  const heartbeat = hbRows[0]
    ? {
        ...hbRows[0],
        updated_at: toIso(hbRows[0].updated_at),
        cookies_min_expiry: toIso(hbRows[0].cookies_min_expiry),
      }
    : null;

  // Currently running (at most 1 in practice — scraper holds a mutex).
  // Older-than-30-min 'running' rows are orphaned from crashed pusher
  // instances and should never show as 'live'. We filter them here and they
  // appear as 'failed' in the recent-runs list below.
  const runningRes: any = await db.execute(dsql`
    SELECT id, query, started_at, jobs_expected
      FROM scrape_runs
     WHERE status = 'running'
       AND started_at > now() - interval '30 minutes'
     ORDER BY started_at DESC
  `);
  const runningRows = (Array.isArray(runningRes) ? runningRes : runningRes?.rows ?? []).map(
    (r: any) => ({ ...r, started_at: toIso(r.started_at) }),
  );

  // Recent runs (last 20). We also surface stale 'running' rows here —
  // reclassified as 'failed' so the UI labels them correctly.
  const recentRes: any = await db.execute(dsql`
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
  `);
  const recent = (Array.isArray(recentRes) ? recentRes : recentRes?.rows ?? []).map(
    (r: any) => ({
      ...r,
      started_at: toIso(r.started_at),
      finished_at: toIso(r.finished_at),
    }),
  );

  // 24h aggregates — counted only for "real" outcomes. A run whose error
  // says it was interrupted by a pusher restart or went stale with no
  // finish event is operational noise (us rebuilding the container), not a
  // scraper failure — we don't hold it against the scraper's success rate.
  const aggRes: any = await db.execute(dsql`
    WITH real AS (
      SELECT status, jobs_found, jobs_inserted, jobs_updated, error
        FROM scrape_runs
       WHERE started_at > now() - interval '24 hours'
         AND NOT (
              status = 'failed'
              AND (
                   error LIKE 'interrupted%'
                OR error LIKE 'stale%'
              )
         )
         -- Stale 'running' rows also don't count until they're reaped.
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
  `);
  const aggRows = Array.isArray(aggRes) ? aggRes : aggRes?.rows ?? [];
  const agg = aggRows[0] ?? {
    completed_24h: 0,
    failed_24h: 0,
    jobs_found_24h: 0,
    jobs_inserted_24h: 0,
    jobs_updated_24h: 0,
  };

  // 30-min "right now" aggregate — drives the banner. The 24h window is
  // honest-but-misleading after an outage: thousands of failures linger
  // for hours after the system has actually recovered, and the banner
  // keeps yelling "lead flow compromised" while leads are visibly flowing.
  // The 30-min window reflects the current state — once the scraper has
  // a few successful cycles after recovery, the alert clears within minutes.
  const aggRecentRes: any = await db.execute(dsql`
    WITH real AS (
      SELECT status
        FROM scrape_runs
       WHERE started_at > now() - interval '30 minutes'
         AND NOT (
              status = 'failed'
              AND (
                   error LIKE 'interrupted%'
                OR error LIKE 'stale%'
              )
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
  `);
  const aggRecentRows = Array.isArray(aggRecentRes) ? aggRecentRes : aggRecentRes?.rows ?? [];
  const aggRecent = aggRecentRows[0] ?? { completed_30m: 0, failed_30m: 0 };

  // Actual lead inflow — the ground truth for "is the pipeline producing
  // output". The 30-min scrape success rate above can be poisoned by a
  // flaky upstream (Cloudflare blocks, captcha cycles) while the keywords
  // that DO succeed still produce a steady trickle of leads. The banner
  // says "lead flow compromised" so it should mean leads have actually
  // stopped flowing — not just that many attempts are failing. We gate
  // the critical alert on this signal in scraper-alert.ts.
  // The "createdAt" >24h filter uses the existing crm_Leads_createdAt_idx
  // so MAX/COUNT only scan recent rows. NB: drizzle's `crmLeads.createdAt`
  // maps to a CAMEL-cased Postgres column "createdAt" (legacy from the
  // Mongo→Prisma migration), not snake_case like everything else here —
  // an earlier version of this query said `created_at` and the whole
  // endpoint 500'd, breaking the System Health panel entirely.
  const leadFlowRes: any = await db.execute(dsql`
    SELECT
      MAX(extracted_at) AS last_extracted_at,
      COUNT(*) FILTER (WHERE extracted_at > now() - interval '30 minutes')::int
        AS inserted_30m
      FROM "crm_Leads"
     WHERE "createdAt" > now() - interval '24 hours'
       AND extracted_at IS NOT NULL
  `);
  const leadFlowRows = Array.isArray(leadFlowRes) ? leadFlowRes : leadFlowRes?.rows ?? [];
  const leadFlow = {
    last_extracted_at: toIso(leadFlowRows[0]?.last_extracted_at ?? null),
    inserted_30m: leadFlowRows[0]?.inserted_30m ?? 0,
  };

  // Per-keyword latest run — one row per keyword. Apply same stale
  // reclassification so the Keyword Rotation grid can't show RUNNING for a
  // tile that hasn't moved in hours.
  const perKeywordRes: any = await db.execute(dsql`
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
  `);
  const perKeyword = (Array.isArray(perKeywordRes) ? perKeywordRes : perKeywordRes?.rows ?? []).map(
    (r: any) => ({
      ...r,
      started_at: toIso(r.started_at),
      finished_at: toIso(r.finished_at),
    }),
  );

  return {
    heartbeat,
    running: runningRows,
    recent,
    aggregates_24h: agg,
    aggregates_recent_30m: aggRecent,
    lead_flow: leadFlow,
    per_keyword: perKeyword,
  };
}
