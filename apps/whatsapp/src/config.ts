function required(key: string): string {
  const v = process.env[key];
  if (!v || !v.trim()) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v.trim();
}

function optional(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : fallback;
}

function int(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Env ${key} must be an integer, got ${v}`);
  return n;
}

// One paired WhatsApp number = one account. Configure via WHATSAPP_ACCOUNTS
// (comma-separated slugs, e.g. "primary,secondary"); defaults to a single
// "primary" so existing single-number deployments behave exactly as before.
//
//   - 'primary' keeps its Baileys creds in the base AUTH_DIR (the existing
//     pairing — no re-scan on upgrade).
//   - every other account gets its own subdir under the same mounted volume
//     (AUTH_DIR/<id>), so all pairings survive deploys together.
//
// Optional per-account display name: WHATSAPP_LABEL_<ID> (e.g.
// WHATSAPP_LABEL_SECONDARY="Support line"). Falls back to the capitalised slug.
export type AccountConfig = { id: string; label: string; authDir: string };

function defaultLabel(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function parseAccounts(baseAuthDir: string): AccountConfig[] {
  const raw = optional("WHATSAPP_ACCOUNTS", "primary");
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const base = baseAuthDir.replace(/\/+$/, "");
  const seen = new Set<string>();
  const out: AccountConfig[] = [];
  for (const id of ids.length ? ids : ["primary"]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: optional(`WHATSAPP_LABEL_${id.toUpperCase()}`, defaultLabel(id)),
      authDir: id === "primary" ? baseAuthDir : `${base}/${id}`,
    });
  }
  // The default account must always exist so reminders that don't name an
  // account (or name a now-removed one) still have somewhere to route.
  if (!out.some((a) => a.id === "primary")) {
    out.unshift({
      id: "primary",
      label: defaultLabel("primary"),
      authDir: baseAuthDir,
    });
  }
  return out;
}

const baseAuthDir = optional("AUTH_DIR", "/app/auth");

export const config = {
  port: int("PORT", 3001),
  // Shared secret used in BOTH directions:
  //   - CRM -> service: must include `Authorization: Bearer <key>` on /qr, /status, /send
  //   - service -> CRM: included on heartbeat + inbound POSTs
  apiKey: required("WHATSAPP_API_KEY"),
  crmUrl: required("NEXTCRM_URL"),
  authDir: baseAuthDir,
  accounts: parseAccounts(baseAuthDir),
  heartbeatIntervalMs: int("HEARTBEAT_INTERVAL_MS", 30_000),
  // Outbox poll cadence. We poll fast while there's a backlog to drain, then
  // back off exponentially up to the max while idle. Idle polling is the bulk
  // of CRM serverless invocations, so the idle ceiling is what controls cost.
  outboxPollMinMs: int("OUTBOX_POLL_MIN_MS", 5_000),
  outboxPollMaxMs: int("OUTBOX_POLL_MAX_MS", 60_000),
  // Outbound throttle: minimum ms between successive /send calls.
  // Defends against bulk-send patterns that get WA accounts banned.
  sendMinIntervalMs: int("SEND_MIN_INTERVAL_MS", 5_000),
  sendDailyCap: int("SEND_DAILY_CAP", 200),
  logLevel: optional("LOG_LEVEL", "info"),
};
