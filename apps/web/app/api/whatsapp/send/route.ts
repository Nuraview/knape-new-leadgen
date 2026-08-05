// CRM users hit this from the Settings → WhatsApp page (test send) or the
// lead drawer composer. We just enqueue into whatsapp_outbox; the bridge
// service drains the queue and reports back via /api/ingest/whatsapp-outbox.

import { NextRequest, NextResponse } from "next/server";

import { sql as dsql } from "drizzle-orm";
import { z } from "zod";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SendSchema = z.object({
  to: z.string().min(1),
  body: z.string().min(1).max(4096),
  lead_id: z.string().optional().nullable(),
  // Which paired account to send FROM. Defaults to 'primary'.
  account: z.string().min(1).max(64).optional(),
});

function normalizeJid(input: string): string {
  if (input.includes("@")) return input;
  const digits = input.replace(/\D/g, "");
  if (!digits) throw new Error("invalid recipient");
  return `${digits}@s.whatsapp.net`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  let body: z.infer<typeof SendSchema>;
  try {
    body = SendSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let jid: string;
  try {
    jid = normalizeJid(body.to);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const enqueuedBy = session.user.email;
  const account = body.account ?? "primary";

  const res: { rows?: { id: string }[] } = (await db.execute(dsql`
    INSERT INTO whatsapp_outbox (to_jid, body, enqueued_by, lead_id, account)
    VALUES (${jid}, ${body.body}, ${enqueuedBy}, ${body.lead_id ?? null}, ${account})
    RETURNING id
  `)) as { rows?: { id: string }[] };
  const rows = Array.isArray(res) ? res : (res.rows ?? []);

  return NextResponse.json({ id: rows[0]?.id ?? null, queued: true });
}
