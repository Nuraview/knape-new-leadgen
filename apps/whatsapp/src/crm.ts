import type { proto } from "@whiskeysockets/baileys";

import { config } from "./config";
import type { Account } from "./socket";

const TIMEOUT_MS = 5_000;

async function postJson(path: string, body: unknown): Promise<void> {
  const url = `${config.crmUrl.replace(/\/+$/, "")}${path}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${path} -> ${res.status}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(t);
  }
}

async function getJson<T>(path: string): Promise<T> {
  const url = `${config.crmUrl.replace(/\/+$/, "")}${path}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${path} -> ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export async function postHeartbeat(account: Account): Promise<void> {
  try {
    await postJson("/api/ingest/whatsapp-heartbeat", {
      account: account.id,
      label: account.label,
      connected: account.state.connected,
      jid: account.state.jid,
      last_seen_at: account.state.lastSeenAt?.toISOString() ?? null,
      // Push the QR up so the CRM Settings page can render it inline.
      // The whole point of this design is no inbound connectivity from
      // Vercel back to the VPS — heartbeat carries everything needed.
      qr_data_url: account.state.qrDataUrl,
      qr_issued_at: account.state.qrIssuedAt?.toISOString() ?? null,
      last_error: account.state.lastError,
    });
  } catch (e) {
    console.warn(`[hb:${account.id}] failed: ${(e as Error).message}`);
  }
}

export async function onIncomingMessage(
  account: Account,
  msg: proto.IWebMessageInfo,
): Promise<void> {
  const text =
    msg.message?.conversation ??
    msg.message?.extendedTextMessage?.text ??
    null;

  await postJson("/api/ingest/whatsapp-inbound", {
    account: account.id,
    message_id: msg.key.id,
    from_jid: msg.key.remoteJid,
    pushname: msg.pushName ?? null,
    body: text,
    timestamp:
      typeof msg.messageTimestamp === "number"
        ? msg.messageTimestamp
        : null,
    has_media:
      msg.message?.imageMessage != null ||
      msg.message?.videoMessage != null ||
      msg.message?.documentMessage != null ||
      msg.message?.audioMessage != null,
  });
}

export type OutboxItem = { id: string; to_jid: string; body: string };

export async function fetchOutboxBatch(
  limit: number,
  accountId: string,
): Promise<OutboxItem[]> {
  const r = await getJson<{ items: OutboxItem[] }>(
    `/api/ingest/whatsapp-outbox?limit=${limit}&account=${encodeURIComponent(accountId)}`,
  );
  return r.items ?? [];
}

export async function reportOutboxResult(
  id: string,
  result: { status: "sent"; message_id: string | null } | { status: "failed"; error: string },
): Promise<void> {
  await postJson("/api/ingest/whatsapp-outbox/result", { id, ...result });
}
