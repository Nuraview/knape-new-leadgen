import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { upsertClientSession } from "@/lib/dialer/db";
import { identityForUser } from "@/lib/dialer/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Called every 15s while the dialer tab is open (also via sendBeacon, whose
// content-type varies — we never read the body, so that's fine).
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const identity = identityForUser(session.user.id);
  await upsertClientSession(
    identity,
    session.user.id,
    req.headers.get("user-agent"),
  );
  return NextResponse.json({ success: true });
}
