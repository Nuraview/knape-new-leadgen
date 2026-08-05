import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { deleteContact, updateContact } from "@/lib/dialer/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Params): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const contactId = parseInt(id, 10);
  if (Number.isNaN(contactId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const contact = await updateContact(contactId, {
    ...(body.name !== undefined && { name: String(body.name).trim() }),
    ...(body.phone !== undefined && { phone: String(body.phone).trim() }),
    ...(body.email !== undefined && { email: body.email || null }),
    ...(body.requirementTag !== undefined && {
      requirementTag: body.requirementTag || null,
    }),
    ...(body.smsEnabled !== undefined && { smsEnabled: !!body.smsEnabled }),
    ...(body.whatsappEnabled !== undefined && {
      whatsappEnabled: !!body.whatsappEnabled,
    }),
  });
  if (!contact) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, contact });
}

export async function DELETE(
  _req: NextRequest,
  ctx: Params,
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const contactId = parseInt(id, 10);
  if (Number.isNaN(contactId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  await deleteContact(contactId);
  return NextResponse.json({ success: true });
}
