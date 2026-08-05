// Pusher pulls cookies here on each tick. Bearer-auth'd with SCRAPER_API_KEY.
// Returns:
//   { uploaded_at: ISO8601, cookies: [...] }  — if ?since is older or missing
//   { uploaded_at: ISO8601, unchanged: true } — if ?since matches

import { NextRequest, NextResponse } from "next/server";

import { sql as dsql } from "drizzle-orm";

import { db } from "@/lib/db";
import { requireScraperAuth } from "@/lib/ingest-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauth = requireScraperAuth(req);
  if (unauth) return unauth;

  const since = req.nextUrl.searchParams.get("since");

  const res: any = await db.execute(dsql`
    SELECT uploaded_at, cookies FROM scraper_cookies WHERE id = 1
  `);
  const rows = Array.isArray(res) ? res : (res?.rows ?? []);
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ uploaded_at: null, cookies: null, unchanged: false });
  }

  const uploadedAt =
    row.uploaded_at instanceof Date
      ? row.uploaded_at.toISOString()
      : row.uploaded_at;

  if (since && uploadedAt === since) {
    return NextResponse.json({ uploaded_at: uploadedAt, unchanged: true });
  }

  return NextResponse.json({
    uploaded_at: uploadedAt,
    cookies: row.cookies,
  });
}
