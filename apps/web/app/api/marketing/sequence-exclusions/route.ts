import { NextRequest, NextResponse } from "next/server";

import { desc, eq } from "drizzle-orm";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { mktSequenceExclusions as sequenceExclusions } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/marketing/sequence-exclusions - List all exclusions
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  try {
    const searchParams = request.nextUrl.searchParams;
    const email = searchParams.get("email");
    const limit = parseInt(searchParams.get("limit") || "100");
    const offset = parseInt(searchParams.get("offset") || "0");

    let query = db.select().from(sequenceExclusions).$dynamic();

    if (email) {
      query = query.where(eq(sequenceExclusions.email, email)) as typeof query;
    }

    const results = await query
      .orderBy(desc(sequenceExclusions.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json(results);
  } catch (error) {
    console.error("[Exclusions] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch exclusions" },
      { status: 500 },
    );
  }
}

// POST /api/marketing/sequence-exclusions - Add an exclusion
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

    const [existing] = await db
      .select()
      .from(sequenceExclusions)
      .where(eq(sequenceExclusions.email, email))
      .limit(1);

    if (existing) {
      await db
        .update(sequenceExclusions)
        .set({
          reason: reason || existing.reason,
          createdAt: new Date(),
        })
        .where(eq(sequenceExclusions.id, existing.id));

      return NextResponse.json({
        success: true,
        message: "Exclusion updated",
        id: existing.id,
      });
    }

    const [result] = await db
      .insert(sequenceExclusions)
      .values({
        email,
        reason: reason || null,
        addedBy: null,
      })
      .returning();

    console.log(`[Exclusions] Added exclusion: ${email}`);

    return NextResponse.json({
      success: true,
      message: "Exclusion added",
      id: result.id,
    });
  } catch (error) {
    console.error("[Exclusions] Error:", error);
    return NextResponse.json(
      { error: "Failed to add exclusion" },
      { status: 500 },
    );
  }
}

// DELETE /api/marketing/sequence-exclusions - Remove an exclusion
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  try {
    const searchParams = request.nextUrl.searchParams;
    const email = searchParams.get("email");
    const id = searchParams.get("id");

    if (!email && !id) {
      return NextResponse.json(
        { error: "Email or ID is required" },
        { status: 400 },
      );
    }

    if (email) {
      await db
        .delete(sequenceExclusions)
        .where(eq(sequenceExclusions.email, email));
      console.log(`[Exclusions] Removed exclusion: ${email}`);
    } else if (id) {
      await db
        .delete(sequenceExclusions)
        .where(eq(sequenceExclusions.id, parseInt(id)));
      console.log(`[Exclusions] Removed exclusion by ID: ${id}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Exclusions] Error:", error);
    return NextResponse.json(
      { error: "Failed to remove exclusion" },
      { status: 500 },
    );
  }
}
