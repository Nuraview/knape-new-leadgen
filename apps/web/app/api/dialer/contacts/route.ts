import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { createContact, getContacts } from "@/lib/dialer/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const contacts = await getContacts();
  return NextResponse.json({ contacts });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const name = (body?.name as string | undefined)?.trim();
  const phone = (body?.phone as string | undefined)?.trim();
  if (!name || !phone) {
    return NextResponse.json(
      { error: "name and phone are required" },
      { status: 400 },
    );
  }

  const contact = await createContact({
    name,
    phone,
    email: (body?.email as string | undefined)?.trim() || null,
    requirementTag: (body?.requirementTag as string | undefined)?.trim() || null,
    smsEnabled: body?.smsEnabled ?? true,
    whatsappEnabled: body?.whatsappEnabled ?? false,
  });
  return NextResponse.json({ success: true, contact });
}
