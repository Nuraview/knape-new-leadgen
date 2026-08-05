import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getContacts } from "@/lib/marketing/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const contactsList = await getContacts();
  return NextResponse.json(contactsList);
}
