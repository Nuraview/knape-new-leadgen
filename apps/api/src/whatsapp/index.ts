/**
 * WhatsApp bridge — the human-facing side.
 *
 * Ported from apps/web/app/api/whatsapp/{status,send,recipients}. The bridge
 * itself (a Baileys container) talks to /api/ingest/whatsapp-* with a bearer
 * token; these are the session-authed endpoints the Administration page and the
 * lead drawer use.
 *
 * Sending is an OUTBOX write, never a direct send: the bridge owns the socket
 * and drains the queue. That is what makes a reminder survive the bridge being
 * offline — it sits pending until the socket comes back.
 */
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import crmDb from "../database/crm";
import { requireCrmAccess } from "../utils/require-crm-access";
import { normalizeJid } from "./jid";

function rows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return ((result as { rows?: unknown[] })?.rows ?? []) as Record<
    string,
    unknown
  >[];
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  const hasOffset = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(s);
  const parsed = new Date(hasOffset ? s : `${s}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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
  // Alive if the heartbeat landed in the last 90s (3x the 30s cadence).
  const updatedAt = toIso(row.updated_at);
  const isStale = updatedAt
    ? Date.now() - new Date(updatedAt).getTime() > 90_000
    : true;

  return {
    account: String(row.account ?? "primary"),
    label: (row.label as string | null) ?? null,
    service_seen: true,
    service_stale: isStale,
    connected: Boolean(row.connected),
    jid: (row.jid as string | null) ?? null,
    last_seen_at: toIso(row.last_seen_at),
    updated_at: updatedAt,
    // Deliberately drop the QR when the service is stale: a stale QR is worse
    // than none — someone wastes time scanning a code that already expired.
    qr_data_url: isStale ? null : ((row.qr_data_url as string | null) ?? null),
    qr_issued_at: toIso(row.qr_issued_at),
    last_error: (row.last_error as string | null) ?? null,
  };
}

const whatsapp = new Hono<{
  Variables: { userId: string; userEmail: string };
}>()
  .use("*", requireCrmAccess)
  .get("/status", async (c) => {
    const result = await crmDb.execute(sql`
      SELECT account, label, updated_at, connected, jid, last_seen_at,
             qr_data_url, qr_issued_at, last_error
        FROM whatsapp_session
       ORDER BY account = 'primary' DESC, account ASC
    `);

    const accounts = rows(result).map(rowToStatus);
    // Legacy flat mirror of the primary account so older callers keep working.
    const primary =
      accounts.find((a) => a.account === "primary") ?? accounts[0] ?? null;

    if (!primary) {
      return c.json({
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

    return c.json({ ...primary, accounts });
  })
  /**
   * Reminder recipients from WHATSAPP_RECIPIENTS ("Name:+phone,Name:+phone").
   * Feeds the lead drawer's "send reminder to" dropdown.
   */
  .get("/recipients", (c) => {
    const raw = process.env.WHATSAPP_RECIPIENTS ?? "";
    const recipients: { name: string; phone: string }[] = [];

    for (const part of raw.split(",")) {
      const idx = part.indexOf(":");
      if (idx <= 0) continue;
      const name = part.slice(0, idx).trim();
      const phone = part.slice(idx + 1).trim();
      if (name && phone) recipients.push({ name, phone });
    }

    return c.json({ recipients });
  })
  /** Enqueue a message. The bridge drains whatsapp_outbox and reports back. */
  .post("/send", async (c) => {
    const body = await c.req
      .json<{
        to?: string;
        body?: string;
        lead_id?: string | null;
        account?: string;
      }>()
      .catch(() => ({}) as Record<string, never>);

    if (!body.to || !body.body) {
      throw new HTTPException(400, { message: "`to` and `body` are required" });
    }
    if (body.body.length > 4096) {
      throw new HTTPException(400, { message: "Message is too long" });
    }

    let toJid: string;
    try {
      toJid = normalizeJid(body.to);
    } catch (e) {
      throw new HTTPException(400, { message: (e as Error).message });
    }

    // enqueued_by is a provenance LABEL, not a user id — the reminder cron
    // writes 'reminder-cron' into the same column. It answers "what put this in
    // the queue" when a message turns up unexpectedly on someone's phone.
    const inserted = rows(
      await crmDb.execute(sql`
        INSERT INTO whatsapp_outbox (to_jid, body, lead_id, account, enqueued_by)
        VALUES (
          ${toJid},
          ${body.body},
          ${body.lead_id ?? null}::uuid,
          ${body.account ?? "primary"},
          'admin-ui'
        )
        RETURNING id
      `),
    )[0];

    return c.json({ ok: true, id: inserted?.id ?? null });
  });

export default whatsapp;
