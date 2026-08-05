// The Baileys bridge service POSTs here every 30s (and immediately on QR
// refresh) with its current pairing state. Stored as a single upsert row.

import { NextRequest, NextResponse } from "next/server";

import { sql as dsql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireWhatsappServiceAuth } from "@/lib/whatsapp-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HeartbeatSchema = z.object({
  // Which paired account this heartbeat is for. Older bridge builds (and the
  // single-number setup) omit it — default to 'primary' so they keep working.
  account: z.string().min(1).max(64).optional(),
  label: z.string().max(120).optional().nullable(),
  connected: z.boolean().optional().nullable(),
  jid: z.string().optional().nullable(),
  last_seen_at: z.string().optional().nullable(),
  qr_data_url: z.string().optional().nullable(),
  qr_issued_at: z.string().optional().nullable(),
  last_error: z.string().optional().nullable(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const unauth = requireWhatsappServiceAuth(req);
  if (unauth) return unauth;

  let body: z.infer<typeof HeartbeatSchema>;
  try {
    body = HeartbeatSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid heartbeat", issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const account = body.account ?? "primary";

  // qr_data_url and last_error get full overwrite (cleared on reconnect/pair).
  // jid/label only get overwritten with non-null so a transient null doesn't
  // wipe them. One row per account (keyed by the account slug).
  await db.execute(dsql`
    INSERT INTO whatsapp_session (
      account, label, updated_at, connected, jid, last_seen_at, qr_data_url, qr_issued_at, last_error
    ) VALUES (
      ${account},
      ${body.label ?? null},
      now(),
      ${body.connected ?? null},
      ${body.jid ?? null},
      ${body.last_seen_at ?? null}::timestamptz,
      ${body.qr_data_url ?? null},
      ${body.qr_issued_at ?? null}::timestamptz,
      ${body.last_error ?? null}
    )
    ON CONFLICT (account) DO UPDATE SET
      label        = COALESCE(EXCLUDED.label,      whatsapp_session.label),
      updated_at   = now(),
      connected    = COALESCE(EXCLUDED.connected, whatsapp_session.connected),
      jid          = COALESCE(EXCLUDED.jid,        whatsapp_session.jid),
      last_seen_at = COALESCE(EXCLUDED.last_seen_at, whatsapp_session.last_seen_at),
      qr_data_url  = EXCLUDED.qr_data_url,
      qr_issued_at = EXCLUDED.qr_issued_at,
      last_error   = EXCLUDED.last_error
  `);

  return NextResponse.json({ ok: true });
}
