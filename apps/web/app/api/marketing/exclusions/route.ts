import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { mktSequenceExclusions as sequenceExclusions } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const { email, reason } = body;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    await db.insert(sequenceExclusions).values({
      email,
      reason: reason || "Manual exclusion",
      addedBy: null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Add exclusion error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
