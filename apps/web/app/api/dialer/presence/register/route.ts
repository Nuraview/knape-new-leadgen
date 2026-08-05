import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { upsertClientSession } from "@/lib/dialer/db";
import { identityForUser } from "@/lib/dialer/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const identity = identityForUser(session.user.id);
  const userAgent = req.headers.get("user-agent");
  const clientSession = await upsertClientSession(
    identity,
    session.user.id,
    userAgent,
  );
  return NextResponse.json({ success: true, identity, session: clientSession });
}
