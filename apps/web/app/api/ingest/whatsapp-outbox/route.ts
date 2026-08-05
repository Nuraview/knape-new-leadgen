// The bridge service polls this every few seconds. We atomically claim up to
// N pending rows and return them; the service then sends each via Baileys
// and POSTs the outcome back to /api/ingest/whatsapp-outbox/result.
//
// Returning rows in a single UPDATE...RETURNING avoids a TOCTOU race where
// two service replicas could claim the same row. We're singleton today, but
// keep the contract correct for future scaling.

import { NextRequest, NextResponse } from "next/server";

import { sql as dsql } from "drizzle-orm";

import { db } from "@/lib/db";
import { requireWhatsappServiceAuth } from "@/lib/whatsapp-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_BATCH = 10;
const MAX_BATCH = 50;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauth = requireWhatsappServiceAuth(req);
  if (unauth) return unauth;

  const url = new URL(req.url);
  const requested = parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(requested)
    ? Math.min(MAX_BATCH, Math.max(1, requested))
    : DEFAULT_BATCH;

  // Each bridge socket claims only the rows tagged for its own account. The
  // param is required in practice; default to 'primary' so an older bridge
  // build that doesn't send it still drains the default account's queue.
  const account = url.searchParams.get("account") || "primary";

  const result: { rows?: unknown[] } = (await db.execute(dsql`
    UPDATE whatsapp_outbox
       SET status       = 'sending',
           attempts     = attempts + 1,
           attempted_at = now()
     WHERE id IN (
       SELECT id FROM whatsapp_outbox
        WHERE status = 'pending'
          AND account = ${account}
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
     RETURNING id, to_jid, body
  `)) as { rows?: unknown[] };

  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  return NextResponse.json({ items: rows });
}
