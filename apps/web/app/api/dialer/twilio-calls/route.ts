import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { lookupCallerByPhone } from "@/lib/dialer/db";
import { twilioClient, twilioPhoneNumber } from "@/lib/dialer/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Call log read straight from Twilio's REST API rather than our own
// dialer_calls table. This makes the log work regardless of whether the
// status-callback webhooks reach us (the number's webhooks may be routed
// elsewhere) — Twilio is the source of truth for call history.

type LogCall = {
  id: string;
  phoneNumber: string;
  direction: "inbound" | "outbound";
  status: string;
  duration: number | null;
  createdAt: string;
  leadName: string | null;
};

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  let raw;
  try {
    raw = await twilioClient().calls.list({ limit: 200 });
  } catch (error) {
    console.error("twilio call list failed:", error);
    return NextResponse.json({ error: "Twilio fetch failed" }, { status: 502 });
  }

  const ourNumber = twilioPhoneNumber();
  const calls: LogCall[] = [];

  // Each real call shows up as two legs (the customer leg + the agent/client
  // leg). Keep only the leg that faces the external number, and derive a clean
  // inbound/outbound direction from it.
  for (const c of raw) {
    const from = c.from ?? "";
    const to = c.to ?? "";
    let phoneNumber: string | null = null;
    let direction: "inbound" | "outbound" | null = null;

    if (c.direction === "inbound" && to === ourNumber && from.startsWith("+")) {
      phoneNumber = from;
      direction = "inbound";
    } else if (
      c.direction.startsWith("outbound") &&
      from === ourNumber &&
      to.startsWith("+")
    ) {
      phoneNumber = to;
      direction = "outbound";
    } else {
      continue; // agent/client legs, conference legs, etc.
    }

    const when = c.startTime ?? c.dateCreated ?? new Date();
    calls.push({
      id: c.sid,
      phoneNumber,
      direction,
      status: c.status,
      duration: c.duration ? parseInt(c.duration, 10) || null : null,
      createdAt: new Date(when).toISOString(),
      leadName: null,
    });
  }

  // Resolve a display name per distinct number from contacts/leads.
  const distinct = Array.from(new Set(calls.map((c) => c.phoneNumber)));
  const nameByPhone = new Map<string, string | null>();
  await Promise.all(
    distinct.map(async (phone) => {
      try {
        const match = await lookupCallerByPhone(phone);
        nameByPhone.set(phone, match?.displayName ?? null);
      } catch {
        nameByPhone.set(phone, null);
      }
    }),
  );
  for (const c of calls) c.leadName = nameByPhone.get(c.phoneNumber) ?? null;

  return NextResponse.json({ calls });
}
