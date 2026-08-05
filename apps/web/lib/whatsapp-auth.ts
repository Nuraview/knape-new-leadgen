// Shared-secret auth for the Baileys WhatsApp bridge service running on the
// VPS at /root/nuraview-whatsapp/. Set WHATSAPP_API_KEY in both the service
// container and Vercel/local (.env). The service sends:
//   Authorization: Bearer ${WHATSAPP_API_KEY}

import { NextRequest, NextResponse } from "next/server";

export function requireWhatsappServiceAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.WHATSAPP_API_KEY;
  if (!expected) {
    return NextResponse.json(
      { error: "WHATSAPP_API_KEY not configured on server" },
      { status: 500 },
    );
  }
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token.length !== expected.length || token !== expected) {
    return NextResponse.json(
      { error: "Invalid or missing Bearer token" },
      { status: 401 },
    );
  }
  return null;
}
