// The bridge service forwards each incoming WhatsApp message here. We only
// log it for now — Phase 2.x will add lead-matching by phone number.

import { NextRequest, NextResponse } from "next/server";

import { sql as dsql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireWhatsappServiceAuth } from "@/lib/whatsapp-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const InboundSchema = z.object({
  message_id: z.string().nullable().optional(),
  from_jid: z.string(),
  pushname: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  timestamp: z.number().nullable().optional(),
  has_media: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const unauth = requireWhatsappServiceAuth(req);
  if (unauth) return unauth;

  let body: z.infer<typeof InboundSchema>;
  try {
    body = InboundSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid inbound", issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  await db.execute(dsql`
    INSERT INTO whatsapp_message (
      message_id, direction, jid, pushname, body, has_media, wa_timestamp
    ) VALUES (
      ${body.message_id ?? null},
      'in',
      ${body.from_jid},
      ${body.pushname ?? null},
      ${body.body ?? null},
      ${body.has_media},
      ${body.timestamp ?? null}
    )
  `);

  return NextResponse.json({ ok: true });
}
