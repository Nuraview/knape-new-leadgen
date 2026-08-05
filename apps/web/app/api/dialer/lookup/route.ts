import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { lookupCallerByPhone } from "@/lib/dialer/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const phone = req.nextUrl.searchParams.get("phone");
  if (!phone) {
    return NextResponse.json({ error: "phone is required" }, { status: 400 });
  }

  const caller = await lookupCallerByPhone(phone);
  return NextResponse.json({ caller });
}
