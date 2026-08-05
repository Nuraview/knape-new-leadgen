// Read-only status endpoint for the Settings → WhatsApp page. Returns one
// entry per paired account (so the UI can render a card — QR when unpaired,
// connected JID + last-seen when paired — for each), plus a legacy top-level
// mirror of the 'primary' account so the global WhatsAppBridgeAlert and any
// older callers keep working against the flat shape unchanged.

import { NextResponse } from "next/server";

import { sql as dsql } from "drizzle-orm";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toIso(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(v)) return v;
  return v + "Z";
}

type AccountStatus = {
  account: string;
  label: string | null;
  service_seen: boolean;
  service_stale: boolean;
  connected: boolean;
  jid: string | null;
  last_seen_at: string | null;
  updated_at: string | null;
  qr_data_url: string | null;
  qr_issued_at: string | null;
  last_error: string | null;
};

function rowToStatus(row: Record<string, unknown>): AccountStatus {
  // The service is considered "alive" if its heartbeat landed in the last
  // 90s (3x the 30s cadence). Beyond that, the QR is stale even if present.
  const updatedAtIso = toIso(row.updated_at as string | null);
  const isStale = updatedAtIso
    ? Date.now() - new Date(updatedAtIso).getTime() > 90_000
    : true;
  return {
    account: String(row.account ?? "primary"),
    label: (row.label as string | null) ?? null,
    service_seen: true,
    service_stale: isStale,
    connected: Boolean(row.connected),
    jid: (row.jid as string | null) ?? null,
    last_seen_at: toIso(row.last_seen_at as string | null),
    updated_at: updatedAtIso,
    // We DELIBERATELY drop qr_data_url when the service is stale — a stale
    // QR is worse than no QR (user wastes time scanning an expired code).
    qr_data_url: isStale ? null : ((row.qr_data_url as string | null) ?? null),
    qr_issued_at: toIso(row.qr_issued_at as string | null),
    last_error: (row.last_error as string | null) ?? null,
  };
}

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const res: { rows?: Record<string, unknown>[] } = (await db.execute(dsql`
    SELECT account, label, updated_at, connected, jid, last_seen_at,
           qr_data_url, qr_issued_at, last_error
      FROM whatsapp_session
     WHERE account = 'primary'
     LIMIT 1
  `)) as { rows?: Record<string, unknown>[] };
  const rows = Array.isArray(res) ? res : (res.rows ?? []);

  const accounts = rows.map(rowToStatus);
  // Legacy flat fields mirror the primary account (or the first known one).
  const primary =
    accounts.find((a) => a.account === "primary") ?? accounts[0] ?? null;

  if (!primary) {
    return NextResponse.json({
      service_seen: false,
      connected: false,
      jid: null,
      last_seen_at: null,
      updated_at: null,
      qr_data_url: null,
      qr_issued_at: null,
      last_error: null,
      accounts: [],
    });
  }

  return NextResponse.json({ ...primary, accounts });
}
