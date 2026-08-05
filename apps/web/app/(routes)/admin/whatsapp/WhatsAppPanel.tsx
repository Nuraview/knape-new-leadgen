"use client";

import { useState } from "react";

import useSWR from "swr";

// One paired number's status. The endpoint returns these in `accounts`, plus a
// flat mirror of the primary account at the top level (legacy callers).
type AccountStatus = {
  account: string;
  label: string | null;
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

type Status = AccountStatus & { accounts?: AccountStatus[] };

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => r.json());

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function jidToPhone(jid: string | null): string | null {
  if (!jid) return null;
  const digits = jid.split("@")[0]?.split(":")[0] ?? "";
  return digits ? `+${digits}` : null;
}

function accountTitle(a: AccountStatus): string {
  if (a.label?.trim()) return a.label.trim();
  return a.account.charAt(0).toUpperCase() + a.account.slice(1);
}

export function WhatsAppPanel() {
  const { data, error, mutate } = useSWR<Status>(
    "/api/whatsapp/status",
    fetcher,
    { refreshInterval: 10_000, revalidateOnFocus: true },
  );

  if (error) {
    return (
      <div className="rounded-lg border bg-red-500/10 border-l-4 border-l-red-500 px-4 py-3 text-sm">
        Failed to load WhatsApp status: {String(error)}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  // Prefer the per-account list; fall back to the flat top-level fields so the
  // panel still renders an "offline" card before any account has reported in.
  const accounts: AccountStatus[] =
    data.accounts && data.accounts.length > 0 ? data.accounts : [data];

  return (
    <div className="space-y-6 max-w-2xl">
      <p className="text-xs text-muted-foreground">
        Link one WhatsApp number per card. To add another number, set{" "}
        <code>WHATSAPP_ACCOUNTS</code> on the bridge (e.g.{" "}
        <code>primary,secondary</code>) and redeploy — a new card with its own
        QR appears here automatically.
      </p>
      {accounts.map((acc) => (
        <AccountCard key={acc.account} data={acc} onSent={() => mutate()} />
      ))}
    </div>
  );
}

function AccountCard({
  data,
  onSent,
}: {
  data: AccountStatus;
  onSent: () => void;
}) {
  const phone = jidToPhone(data.jid);
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{accountTitle(data)}</span>
        <code className="px-1.5 py-0.5 rounded bg-muted text-[11px] text-muted-foreground">
          {data.account}
        </code>
        {phone ? (
          <span className="ml-auto text-xs text-muted-foreground">{phone}</span>
        ) : null}
      </div>

      <StatusHeader data={data} />

      {data.qr_data_url && !data.connected ? (
        <QrPanel qr={data.qr_data_url} issuedAt={data.qr_issued_at} />
      ) : null}

      {data.connected ? (
        <SendTest account={data.account} jid={data.jid} onSent={onSent} />
      ) : null}

      {data.last_error ? (
        <div className="rounded-lg border bg-amber-500/10 border-l-4 border-l-amber-500 px-4 py-3 text-sm">
          <div className="font-medium">Last error</div>
          <div className="text-muted-foreground text-xs mt-0.5">
            {data.last_error}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatusHeader({ data }: { data: AccountStatus }) {
  if (!data.service_seen || data.service_stale) {
    return (
      <div className="rounded-lg border bg-red-500/10 border-l-4 border-l-red-500 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
          <span className="font-medium">Bridge service offline</span>
          <span className="text-xs text-muted-foreground">
            Last heartbeat {relTime(data.updated_at)}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          The Baileys bridge container on the VPS is silent. Check{" "}
          <code>docker logs nuraview-whatsapp</code> on{" "}
          <code>185.245.182.175</code>.
        </div>
      </div>
    );
  }
  if (data.connected) {
    const phone = jidToPhone(data.jid);
    return (
      <div className="rounded-lg border bg-green-500/10 border-l-4 border-l-green-500 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
          <span className="font-medium">Connected</span>
          <code className="px-1.5 py-0.5 rounded bg-background border text-xs">
            {phone ?? data.jid}
          </code>
          <span className="ml-auto text-xs text-muted-foreground">
            last seen {relTime(data.last_seen_at)}
          </span>
        </div>
      </div>
    );
  }
  if (data.qr_data_url) {
    return (
      <div className="rounded-lg border bg-amber-500/10 border-l-4 border-l-amber-500 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
          <span className="font-medium">Waiting for scan</span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Open WhatsApp on the phone you want to pair, go to Settings → Linked
          Devices → Link a Device, and scan the QR below.
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border bg-muted/20 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-zinc-400" />
        <span className="font-medium">Initialising</span>
        <span className="text-xs text-muted-foreground">
          Heartbeat {relTime(data.updated_at)} — bridge is starting
        </span>
      </div>
    </div>
  );
}

function QrPanel({ qr, issuedAt }: { qr: string; issuedAt: string | null }) {
  return (
    <div className="rounded-lg border bg-background px-4 py-4 flex flex-col items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qr}
        alt="WhatsApp pairing QR code"
        width={320}
        height={320}
        className="rounded border"
      />
      <div className="text-xs text-muted-foreground">
        QR refreshed {relTime(issuedAt)} — codes auto-renew every ~20s.
      </div>
    </div>
  );
}

function SendTest({
  account,
  jid,
  onSent,
}: {
  account: string;
  jid: string | null;
  onSent: () => void;
}) {
  const phoneFromJid = jidToPhone(jid) ?? "";
  const [to, setTo] = useState(phoneFromJid);
  const [body, setBody] = useState("Hello from NuraView CRM 👋");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, body, account }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setResult(`Queued (id: ${json.id?.slice(0, 8) ?? "—"})`);
      onSent();
    } catch (e) {
      setResult(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border bg-muted/20 px-4 py-3 space-y-2">
      <div className="text-sm font-medium">Send a test message</div>
      <div className="text-xs text-muted-foreground">
        Sends through this account — defaults to its own paired number so you
        can verify end-to-end without messaging anyone else. Messages are
        throttled to one every 5 seconds.
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="+15551234567"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
        />
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={send}
          disabled={busy || !to.trim() || !body.trim()}
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send"}
        </button>
        {result ? (
          <span className="text-xs text-muted-foreground">{result}</span>
        ) : null}
      </div>
    </div>
  );
}
