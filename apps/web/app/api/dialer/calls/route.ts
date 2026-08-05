import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getCallHistory } from "@/lib/dialer/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const leadId = req.nextUrl.searchParams.get("leadId") ?? undefined;
  const calls = await getCallHistory({ leadId });
  return NextResponse.json({ calls });
}
