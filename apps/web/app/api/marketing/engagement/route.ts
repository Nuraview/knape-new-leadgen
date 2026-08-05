import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getEngagementDetails } from "@/lib/marketing/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/marketing/engagement?kind=opened|clicked
// Returns the recipients behind the dashboard's Opened / Clicked counts, with
// company + phone (from their lead card) and the sent email for previewing.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const kindParam = new URL(req.url).searchParams.get("kind");
  const kind =
    kindParam === "clicked"
      ? "clicked"
      : kindParam === "unsubscribed"
        ? "unsubscribed"
        : "opened";

  const rows = await getEngagementDetails(kind);
  return NextResponse.json(rows);
}
