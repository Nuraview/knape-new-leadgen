import { NextRequest, NextResponse } from "next/server";
import { pollBounces, isImapConfigured } from "@/lib/marketing/bounce-poller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron")) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  if (new URL(req.url).searchParams.get("secret") === secret) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isImapConfigured()) {
    return NextResponse.json({ skipped: "IMAP not configured (MAILU_IMAP_*)" });
  }
  try {
    const result = await pollBounces();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "bounce poll failed" },
      { status: 500 },
    );
  }
}
