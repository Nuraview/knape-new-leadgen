import { NextRequest, NextResponse } from "next/server";

import { and, eq, inArray } from "drizzle-orm";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  mktSequenceItems as sequenceItems,
  mktSequences as sequences,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  try {
    const { id } = await params;
    const sequenceId = parseInt(id);

    if (isNaN(sequenceId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    await db
      .update(sequences)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(sequences.id, sequenceId));

    await db
      .update(sequenceItems)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(sequenceItems.sequenceId, sequenceId),
          inArray(sequenceItems.status, ["pending", "scheduled"]),
        ),
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Stop sequence error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
