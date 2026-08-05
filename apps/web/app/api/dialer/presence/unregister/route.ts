import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { removeClientSession } from "@/lib/dialer/db";
import { identityForUser } from "@/lib/dialer/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  await removeClientSession(identityForUser(session.user.id));
  return NextResponse.json({ success: true });
}
