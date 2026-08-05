// The bridge service POSTs the outcome of each /outbox claim here.

import { NextRequest, NextResponse } from "next/server";

import { sql as dsql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireWhatsappServiceAuth } from "@/lib/whatsapp-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ResultSchema = z.object({
  id: z.uuid(),
  status: z.enum(["sent", "failed"]),
  message_id: z.string().optional().nullable(),
  error: z.string().optional().nullable(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const unauth = requireWhatsappServiceAuth(req);
  if (unauth) return unauth;

  let body: z.infer<typeof ResultSchema>;
  try {
    body = ResultSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid result", issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.status === "sent") {
    await db.execute(dsql`
      UPDATE whatsapp_outbox
         SET status     = 'sent',
             message_id = ${body.message_id ?? null},
             error      = NULL,
             sent_at    = now()
       WHERE id = ${body.id}::uuid
    `);
    // Mirror the row into the message log for the unified thread view.
    await db.execute(dsql`
      INSERT INTO whatsapp_message (message_id, direction, jid, body, lead_id)
      SELECT message_id, 'out', to_jid, body, lead_id
        FROM whatsapp_outbox
       WHERE id = ${body.id}::uuid
    `);
  } else {
    await db.execute(dsql`
      UPDATE whatsapp_outbox
         SET status = 'failed',
             error  = ${body.error ?? "unknown"}
       WHERE id = ${body.id}::uuid
    `);
  }

  return NextResponse.json({ ok: true });
}
