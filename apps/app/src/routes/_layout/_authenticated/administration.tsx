/**
 * Administration.
 *
 * The legacy /admin is 4,308 lines across 51 files, but most of it drives
 * tables the P0.3 usage audit found EMPTY in two independent databases:
 * invoices settings/series/tax-rates, currencies, the audit log, and the
 * CRM-core config for accounts/contacts/opportunities. Porting those would be
 * weeks of work moving zero rows for zero users.
 *
 * What is actually live, and therefore what is here:
 *   - the WhatsApp bridge panel (pairing state, QR, send test)
 *   - the lead status / source lists, which the leads module genuinely uses
 *
 * The rest is archived: the code stays in the frozen Next app and the tables
 * stay in the database. Nothing is dropped.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  QrCode,
  Send,
  Smartphone,
} from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { getApiUrl } from "@/fetchers/get-api-url";
import { cn } from "@/lib/cn";

type Account = {
  account: string;
  label: string | null;
  service_stale: boolean;
  connected: boolean;
  jid: string | null;
  last_seen_at: string | null;
  updated_at: string | null;
  qr_data_url: string | null;
  last_error: string | null;
};

type Status = { accounts: Account[]; service_seen: boolean };

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function AccountCard({ account }: { account: Account }) {
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");

  const send = useMutation({
    mutationFn: async () => {
      const response = await fetch(getApiUrl("whatsapp/send"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          body: message,
          account: account.account,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => {
      toast.success("Queued — the bridge will send it shortly");
      setMessage("");
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not queue message"),
  });

  const offline = account.service_stale;
  const paired = account.connected && !offline;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Smartphone
            className={cn(
              "mt-0.5 size-4",
              offline
                ? "text-rose-500"
                : paired
                  ? "text-emerald-500"
                  : "text-amber-500",
            )}
          />
          <div>
            <div className="text-sm font-medium">
              {account.label || account.account}
            </div>
            <div className="text-xs text-muted-foreground">
              {offline
                ? `Bridge offline — last heartbeat ${ago(account.updated_at)}`
                : paired
                  ? `Paired as ${account.jid ?? "unknown"} · seen ${ago(account.last_seen_at)}`
                  : "Not paired — scan the QR below"}
            </div>
          </div>
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-semibold",
            offline
              ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
              : paired
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          )}
        >
          {offline ? "offline" : paired ? "connected" : "needs pairing"}
        </span>
      </div>

      {account.last_error ? (
        <p className="mt-3 flex items-start gap-2 rounded border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
          {account.last_error}
        </p>
      ) : null}

      {/* A stale QR is suppressed server-side — scanning an expired code just
          wastes the operator's time. */}
      {account.qr_data_url ? (
        <div className="mt-4 flex flex-col items-center gap-2 rounded border border-border p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <QrCode className="size-3.5" />
            Scan with WhatsApp → Linked devices
          </div>
          <img
            src={account.qr_data_url}
            alt="WhatsApp pairing QR code"
            className="size-48 rounded bg-white p-2"
          />
        </div>
      ) : null}

      {paired ? (
        <div className="mt-4 space-y-2 border-t border-border pt-3">
          <div className="text-xs font-medium text-muted-foreground">
            Send a test message
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="+91 95911 94679"
              className="h-9 w-48"
            />
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Message"
              className="h-9 min-w-0 flex-1"
            />
            <Button
              size="sm"
              className="h-9 gap-1.5"
              disabled={!to.trim() || !message.trim() || send.isPending}
              onClick={() => send.mutate()}
            >
              {send.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              Send
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RouteComponent() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["whatsapp", "status"],
    queryFn: async (): Promise<Status> => {
      const response = await fetch(getApiUrl("whatsapp/status"), {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load WhatsApp status");
      return response.json();
    },
    // The bridge heartbeats every 30s and the QR rotates, so poll while the
    // page is open.
    refetchInterval: 15_000,
  });

  const recipients = useQuery({
    queryKey: ["whatsapp", "recipients"],
    queryFn: async (): Promise<{
      recipients: { name: string; phone: string }[];
    }> => {
      const response = await fetch(getApiUrl("whatsapp/recipients"), {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load recipients");
      return response.json();
    },
    staleTime: 5 * 60_000,
  });

  const accounts = data?.accounts ?? [];

  return (
    <Layout>
      <PageTitle title="Administration" />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="text-xl font-semibold">Administration</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-3xl space-y-6">
          <section>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">WhatsApp bridge</h2>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() =>
                  queryClient.invalidateQueries({ queryKey: ["whatsapp"] })
                }
              >
                Refresh
              </Button>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Reminders and lead notifications go out through this. If it is
              offline, messages queue up and send once it reconnects.
            </p>

            <div className="mt-3 space-y-3">
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : accounts.length === 0 ? (
                <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                  The bridge has never reported in. Check that the
                  nuraview-whatsapp container is running.
                </p>
              ) : (
                accounts.map((a) => <AccountCard key={a.account} account={a} />)
              )}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold">Reminder recipients</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Configured on the server via WHATSAPP_RECIPIENTS. A lead's
              reminder goes to whichever name is picked on the lead; unmatched
              names fall back to WHATSAPP_TO.
            </p>
            <div className="mt-3 rounded-lg border border-border bg-card">
              {(recipients.data?.recipients ?? []).length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  None configured.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {recipients.data?.recipients.map((r) => (
                    <li
                      key={r.name}
                      className="flex items-center justify-between px-4 py-2.5 text-sm"
                    >
                      <span className="font-medium">{r.name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {r.phone}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold">Archived settings</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Invoicing, currencies, the audit log and the CRM-core config were
              not ported: the usage audit found every one of their tables empty
              in both production and the backup. The code and the tables still
              exist — nothing was deleted — and they remain reachable on the
              legacy app if they are ever needed.
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3.5 text-emerald-500" />
              Lead statuses and sources are managed from the Leads filters,
              which is the only place they are used.
            </p>
          </section>
        </div>
      </div>
    </Layout>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/administration")({
  component: RouteComponent,
});
