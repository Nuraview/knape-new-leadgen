import { NextRequest, NextResponse } from "next/server";

import { desc, eq, sql } from "drizzle-orm";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  mktSequenceItems as sequenceItems,
  mktSequences as sequences,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/marketing/sequences - List all sequences
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    let query = db
      .select({
        id: sequences.id,
        campaign: sequences.campaign,
        status: sequences.status,
        createdAt: sequences.createdAt,
        updatedAt: sequences.updatedAt,
        itemCount: sql<number>`COUNT(${sequenceItems.id})`.as("item_count"),
        sentCount:
          sql<number>`SUM(CASE WHEN ${sequenceItems.status} = 'sent' THEN 1 ELSE 0 END)`.as(
            "sent_count",
          ),
      })
      .from(sequences)
      .leftJoin(sequenceItems, eq(sequences.id, sequenceItems.sequenceId))
      .groupBy(sequences.id)
      .$dynamic();

    if (
      status &&
      ["active", "cancelled", "complete", "paused"].includes(status)
    ) {
      query = query.where(
        eq(
          sequences.status,
          status as "active" | "cancelled" | "complete" | "paused",
        ),
      ) as typeof query;
    }

    const results = await query
      .orderBy(desc(sequences.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json(results);
  } catch (error) {
    console.error("[Sequences] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch sequences" },
      { status: 500 },
    );
  }
}
