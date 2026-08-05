import { NextResponse } from "next/server";
import { getEmailSenders } from "@/lib/email-senders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sender identities for the compose "Send from" picker. Auth is enforced by
// proxy.ts (any /api route requires a session) — only CRM users reach this.
export async function GET() {
  return NextResponse.json({
    senders: getEmailSenders().map((s) => ({ id: s.id, label: s.label })),
  });
}
