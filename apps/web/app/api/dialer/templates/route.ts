import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import {
  createMessageTemplate,
  getMessageTemplates,
  type MessageType,
} from "@/lib/dialer/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const type = req.nextUrl.searchParams.get("type") as MessageType | null;
  const templates = await getMessageTemplates(type);
  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const name = body?.name as string | undefined;
  const messageBody = body?.messageBody as string | undefined;
  const messageType = (body?.messageType as MessageType | undefined) ?? "sms";
  if (!name || !messageBody) {
    return NextResponse.json(
      { error: "name and messageBody are required" },
      { status: 400 },
    );
  }

  const template = await createMessageTemplate(name, messageBody, messageType);
  return NextResponse.json({ success: true, template });
}
