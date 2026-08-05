import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getSmsHistory } from "@/lib/dialer/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SMS/WhatsApp history. `?leadId=` or `?phone=` filters to one thread;
// otherwise returns the recent stream (client groups into conversations).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const leadId = searchParams.get("leadId") ?? undefined;
  const phone = searchParams.get("phone") ?? undefined;

  const messages = await getSmsHistory({ leadId, phone });
  return NextResponse.json({ messages });
}
