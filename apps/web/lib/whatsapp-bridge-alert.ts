// Single source of truth for "is the WhatsApp bridge link broken?". Shared by
// the global blocking modal (WhatsAppBridgeAlert), its toast, and its browser
// notification so all three surfaces always agree — mirrors scraper-alert.ts.
//
// Why this matters: reminders to leads/patients go out THROUGH this bridge. If
// it is offline or unpaired, those messages silently queue and never deliver.
// We treat ANY non-connected state as critical and surface it everywhere.

// Shape returned by GET /api/whatsapp/status.
export type WhatsAppBridgeStatus = {
  service_seen: boolean;
  service_stale?: boolean;
  connected: boolean;
  jid: string | null;
  last_seen_at: string | null;
  updated_at: string | null;
  qr_data_url: string | null;
  qr_issued_at: string | null;
  last_error: string | null;
};

export type WhatsAppAlertLevel = "none" | "critical";

export type WhatsAppAlert = {
  level: WhatsAppAlertLevel;
  reason: string;
  code: string; // stable key so the toaster/notification can dedupe across polls
  // A fresh, scannable QR — present only when the bridge is alive but unpaired.
  // null when the bridge is offline (a stale QR is worse than none).
  qrDataUrl: string | null;
};

const HEALTHY: WhatsAppAlert = {
  level: "none",
  reason: "",
  code: "none",
  qrDataUrl: null,
};

export function deriveWhatsAppAlert(
  data: WhatsAppBridgeStatus | undefined | null,
): WhatsAppAlert {
  // No data yet (initial load / network blip) — stay silent rather than flash a
  // false alarm on every cold mount.
  if (!data) return HEALTHY;

  // Paired AND heartbeat fresh — the only state in which reminders flow.
  if (data.connected && !data.service_stale) return HEALTHY;

  // Bridge container silent: heartbeat older than 90s, or never seen at all.
  if (!data.service_seen || data.service_stale) {
    return {
      level: "critical",
      code: "wa-offline",
      reason:
        "WhatsApp bridge is offline — the service has stopped sending heartbeats. Automated reminders are NOT being delivered.",
      // The status API already nulls a stale QR; never present one here.
      qrDataUrl: null,
    };
  }

  // Bridge alive but the WhatsApp session is not paired — needs a QR scan.
  return {
    level: "critical",
    code: "wa-unpaired",
    reason:
      "WhatsApp is disconnected — the linked device was logged out. Scan the QR code to re-link. Automated reminders are NOT being delivered until you do.",
    qrDataUrl: data.qr_data_url ?? null,
  };
}
