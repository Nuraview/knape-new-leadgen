// Frontend polls this to show live scraper activity on /leads.

import { NextResponse } from "next/server";

import { sql as dsql } from "drizzle-orm";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  // Two queries: the running rows (should be 0 or 1 in practice) and the
  // last 20 finished ones. One round-trip to keep it snappy.
  const result: any = await db.execute(dsql`
    (
      SELECT 'running' AS bucket, "id", "tick_id", "query", "status",
             "started_at", "finished_at",
             "jobs_expected", "jobs_found", "jobs_inserted", "jobs_updated",
             "error"
      FROM "scrape_runs"
      WHERE "status" = 'running'
      ORDER BY "started_at" DESC
    )
    UNION ALL
    (
      SELECT 'recent' AS bucket, "id", "tick_id", "query", "status",
             "started_at", "finished_at",
             "jobs_expected", "jobs_found", "jobs_inserted", "jobs_updated",
             "error"
      FROM "scrape_runs"
      WHERE "status" <> 'running'
      ORDER BY "started_at" DESC
      LIMIT 20
    )
  `);

  const rows: any[] = Array.isArray(result) ? result : (result?.rows ?? []);
  const running = rows.filter((r) => r.bucket === "running");
  const recent = rows.filter((r) => r.bucket === "recent");
  return NextResponse.json({ running, recent });
}
