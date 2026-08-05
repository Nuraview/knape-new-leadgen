// Pusher reports diagnostics here once per tick. Stored as a single upsert
// row so the UI can show current cookies/gemini/scraper state.

import { NextRequest, NextResponse } from "next/server";

import { sql as dsql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireScraperAuth } from "@/lib/ingest-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HeartbeatSchema = z.object({
  cookies_count: z.number().int().nonnegative().optional().nullable(),
  cookies_present: z.boolean().optional().nullable(),
  cookies_min_expiry: z.string().optional().nullable(),
  cookies_hard_expired: z.boolean().optional().nullable(),
  cookies_working: z.boolean().optional().nullable(),
  // "no-info" replaces "expired" as the low-data signal — see pusher's
  // behavioural_cookie_health(). Both are still accepted so an old pusher
  // and a new one can both report cleanly. Without "no-info" here the
  // signal-bearing heartbeats 400 and only the lightweight cycle-start
  // probes refresh updated_at, which falsely trips the "container down"
  // banner during long cycles.
  cookies_signal: z
    .enum(["working", "degraded", "expired", "no-info", "no-data"])
    .optional()
    .nullable(),
  cookies_client_info_rate: z.number().min(0).max(1).optional().nullable(),
  scraper_healthy: z.boolean().optional().nullable(),
  scraper_version: z.string().optional().nullable(),
  gemini_enabled: z.boolean().optional().nullable(),
  keywords: z.array(z.string()).optional().nullable(),
  current_keyword: z.string().optional().nullable(),
  last_error: z.string().optional().nullable(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const unauth = requireScraperAuth(req);
  if (unauth) return unauth;

  let body: z.infer<typeof HeartbeatSchema>;
  try {
    body = HeartbeatSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid heartbeat", issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // keywords is jsonb in Postgres — serialize the JS array as JSON text.
  const keywordsJson = body.keywords ? JSON.stringify(body.keywords) : null;

  const updateCurrentKeyword = body.current_keyword !== undefined
    ? dsql`EXCLUDED.current_keyword`
    : dsql`scraper_heartbeat.current_keyword`;

  await db.execute(dsql`
    INSERT INTO scraper_heartbeat (
      id, updated_at,
      cookies_count, cookies_present, cookies_min_expiry, cookies_hard_expired,
      cookies_working, cookies_signal, cookies_client_info_rate,
      scraper_healthy, scraper_version, gemini_enabled,
      keywords, current_keyword, last_error
    ) VALUES (
      1, now(),
      ${body.cookies_count ?? null},
      ${body.cookies_present ?? null},
      ${body.cookies_min_expiry ?? null}::timestamptz,
      ${body.cookies_hard_expired ?? null},
      ${body.cookies_working ?? null},
      ${body.cookies_signal ?? null},
      ${body.cookies_client_info_rate ?? null},
      ${body.scraper_healthy ?? null},
      ${body.scraper_version ?? null},
      ${body.gemini_enabled ?? null},
      ${keywordsJson}::jsonb,
      ${body.current_keyword ?? null},
      ${body.last_error ?? null}
    )
    ON CONFLICT (id) DO UPDATE SET
      updated_at               = now(),
      cookies_count            = COALESCE(EXCLUDED.cookies_count,            scraper_heartbeat.cookies_count),
      cookies_present          = COALESCE(EXCLUDED.cookies_present,          scraper_heartbeat.cookies_present),
      cookies_min_expiry       = COALESCE(EXCLUDED.cookies_min_expiry,       scraper_heartbeat.cookies_min_expiry),
      cookies_hard_expired     = COALESCE(EXCLUDED.cookies_hard_expired,     scraper_heartbeat.cookies_hard_expired),
      cookies_working          = COALESCE(EXCLUDED.cookies_working,          scraper_heartbeat.cookies_working),
      cookies_signal           = COALESCE(EXCLUDED.cookies_signal,           scraper_heartbeat.cookies_signal),
      cookies_client_info_rate = COALESCE(EXCLUDED.cookies_client_info_rate, scraper_heartbeat.cookies_client_info_rate),
      scraper_healthy          = COALESCE(EXCLUDED.scraper_healthy,          scraper_heartbeat.scraper_healthy),
      scraper_version          = COALESCE(EXCLUDED.scraper_version,          scraper_heartbeat.scraper_version),
      gemini_enabled           = COALESCE(EXCLUDED.gemini_enabled,           scraper_heartbeat.gemini_enabled),
      keywords                 = COALESCE(EXCLUDED.keywords,                 scraper_heartbeat.keywords),
      current_keyword          = ${updateCurrentKeyword},
      last_error               = EXCLUDED.last_error
  `);
  return NextResponse.json({ ok: true });
}
