// Job IDs we already hold, so the scraper can skip re-scraping them.
//
// Without this the scraper clicks into all 20 search results every cycle and
// only then discovers (CRM-side, at upsert) that 19 are duplicates — ~17 min of
// browser work for 0-3 new leads. The pusher pulls this list once per cycle and
// passes it as `skip_job_ids`, so only genuinely new cards get the expensive
// detail scrape.
//
// A short window is enough: cards are fetched newest-first, so an id older than
// the window can't appear near the top of a recency-sorted search.

import { NextRequest, NextResponse } from "next/server";

import { sql as dsql } from "drizzle-orm";

import { db } from "@/lib/db";
import { requireScraperAuth } from "@/lib/ingest-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireScraperAuth(req);
  if (unauthorized) return unauthorized;

  const days = Math.min(
    Math.max(1, parseInt(req.nextUrl.searchParams.get("days") ?? "") || DEFAULT_DAYS),
    MAX_DAYS,
  );

  const res: any = await db.execute(dsql`
    SELECT DISTINCT "upwork_job_id"
      FROM "crm_Leads"
     WHERE "upwork_job_id" IS NOT NULL
       AND COALESCE("extracted_at", "createdAt") > now() - ${days} * interval '1 day'
  `);
  const rows = Array.isArray(res) ? res : (res?.rows ?? []);

  return NextResponse.json({
    days,
    jobIds: rows.map((r: any) => r.upwork_job_id).filter(Boolean),
  });
}
