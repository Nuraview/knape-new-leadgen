import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liveness + DB readiness. Used by the container HEALTHCHECK and as the gate in
// the GitHub Actions deploy — a container that can't reach Postgres must not be
// promoted, so a DB failure is a 503, not a soft warning.
export async function GET(): Promise<NextResponse> {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok", db: "up" });
  } catch (e) {
    return NextResponse.json(
      { status: "degraded", db: "down", error: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    );
  }
}
