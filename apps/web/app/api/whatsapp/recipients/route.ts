import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns the list of WhatsApp reminder recipients configured via
// WHATSAPP_RECIPIENTS env var (format: "Name:+phone,Name:+phone").
// The lead drawer fetches this to populate the "Send reminder to" dropdown.
export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const raw = process.env.WHATSAPP_RECIPIENTS ?? "";
  const recipients: { name: string; phone: string }[] = [];

  for (const part of raw.split(",")) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const phone = part.slice(idx + 1).trim();
    if (name && phone) recipients.push({ name, phone });
  }

  return NextResponse.json({ recipients });
}
