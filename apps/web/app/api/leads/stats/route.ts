import { NextResponse } from "next/server";

import { isNull, sql } from "drizzle-orm";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { crmLeads } from "@/drizzle/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  // Single round-trip — one query with conditional aggregates.
  // Pipeline counters (total / withCompany / highlighted / etc.) deliberately
  // exclude irrelevant rows — they're noise the reviewer marked away. The
  // `irrelevant` counter is separate so the archive tab can show its own
  // tally without polluting the active pipeline numbers.
  const isActive = sql`${crmLeads.irrelevantAt} IS NULL`;
  const [row] = await db
    .select({
      total: sql<number>`COUNT(*) FILTER (WHERE ${isActive})::int`,
      withCompany: sql<number>`COUNT(*) FILTER (WHERE ${isActive} AND ${crmLeads.company} IS NOT NULL AND ${crmLeads.company} <> '')::int`,
      highlighted: sql<number>`COUNT(*) FILTER (WHERE ${isActive} AND ${crmLeads.highlightedAt} IS NOT NULL)::int`,
      pendingReminders: sql<number>`COUNT(*) FILTER (WHERE ${isActive} AND ${crmLeads.reminderAt} IS NOT NULL AND ${crmLeads.reminderSentAt} IS NULL)::int`,
      fromUpwork: sql<number>`COUNT(*) FILTER (WHERE ${isActive} AND ${crmLeads.upworkJobUrl} IS NOT NULL)::int`,
      irrelevant: sql<number>`COUNT(*) FILTER (WHERE ${crmLeads.irrelevantAt} IS NOT NULL)::int`,
      // Serialize naked TIMESTAMP (no tz) as an ISO-8601 string ending in 'Z'
      // so the browser treats it as UTC. Prevents a ~5.5h drift on IST.
      latestExtractedAt: sql<string | null>`to_char(MAX(${crmLeads.extractedAt}) FILTER (WHERE ${isActive}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      leadsInLast15min: sql<number>`COUNT(*) FILTER (WHERE ${isActive} AND ${crmLeads.extractedAt} > now() - interval '15 minutes')::int`,
      leadsInLastHour: sql<number>`COUNT(*) FILTER (WHERE ${isActive} AND ${crmLeads.extractedAt} > now() - interval '1 hour')::int`,
    })
    .from(crmLeads)
    .where(isNull(crmLeads.deletedAt));

  return NextResponse.json(row);
}
