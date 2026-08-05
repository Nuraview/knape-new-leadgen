/**
 * Marketing — the cold-email mailbox.
 *
 * Reading is here: deliverability counters, per-sender breakdown, threads,
 * contacts and sequences.
 *
 * Composing and sending are NOT, and the page says so rather than hiding it.
 * They stay on the legacy app until Inngest and the IMAP sidecar land, because
 * a half-migrated sender is the failure that emails real prospects from the
 * wrong identity or silently drops a follow-up mid-sequence.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Pencil,
  Eye,
  FileText,
  Mail,
  MousePointerClick,
  Search,
  Send,
  Timer,
  Trash2,
  UserMinus,
  Users,
} from "lucide-react";
import { useState } from "react";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiUrl } from "@/fetchers/get-api-url";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

/** Same shape the composer uses — throw the server's message, not "failed". */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(getApiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error((data as { message?: string }).message || `Failed (${r.status})`);
  }
  return data as T;
}

type Totals = {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
};

type Thread = {
  id: number;
  subject: string | null;
  last_activity_date: string | null;
  message_count: number;
  participant: string | null;
};

type Message = {
  id: number;
  subject: string | null;
  body: string | null;
  sent_date: string | null;
  status: string | null;
  provider: string | null;
  sender_email: string | null;
  recipient_email: string | null;
  opened_count: number | null;
  clicked_count: number | null;
};

type Contact = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string;
  company: string | null;
  last_engagement: string | null;
};

type Sequence = {
  id: number;
  campaign: string | null;
  status: string | null;
  total_items: number;
  sent_items: number;
  pending_items: number;
};

function when(iso: string | null) {
  return iso
    ? new Date(iso).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "2-digit",
      })
    : "—";
}

function pct(n: number, of: number) {
  return of > 0 ? `${Math.round((n / of) * 100)}%` : "—";
}

/**
 * Headline card. Icon + identity colour per metric, matching the legacy
 * dashboard — the team reads these at a glance and the colours are how they
 * tell "opened" from "bounced" without reading the label.
 */
function Stat({
  label,
  value,
  sub,
  Icon,
  hex,
}: {
  label: string;
  value: number | string;
  sub?: string;
  Icon: typeof Mail;
  hex: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className="size-4 shrink-0" style={{ color: hex }} />
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      {sub ? (
        <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
      ) : null}
    </div>
  );
}

/** Big percentage with a progress bar — the Open/Click rate cards. */
function RateCard({
  label,
  rate,
  hex,
  hint,
}: {
  label: string;
  rate: number | null;
  hex: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1.5 flex items-end gap-3">
        <span
          className="text-3xl font-bold tabular-nums"
          style={{ color: hex }}
        >
          {rate === null ? "—" : `${rate.toFixed(1)}%`}
        </span>
        <div className="mb-2 h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${Math.min(100, rate ?? 0)}%`, background: hex }}
          />
        </div>
      </div>
      {hint ? (
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

/** Sent/total steps as filled dots, exactly as the legacy follow-up table. */
function ProgressDots({ sent, total }: { sent: number; total: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      {Array.from({ length: Math.min(total, 6) }).map((_, i) => (
        <span
          key={`dot-${total}-${i}`}
          className={cn(
            "size-2 rounded-full",
            i < sent ? "bg-emerald-500" : "bg-amber-400",
          )}
        />
      ))}
      <span className="ms-1.5 text-xs text-muted-foreground">
        {sent}/{total} sent
      </span>
    </span>
  );
}

type View =
  | "dashboard"
  | "inbox"
  | "sent"
  | "sequences"
  | "contacts"
  | "templates"
  | "stoplist";

function RouteComponent() {
  // Driven by ?view= so the sidebar sub-menu links land on the right panel and
  // the browser back button works between them.
  const search = useSearch({ from: "/_layout/_authenticated/marketing" });
  const navigate = useNavigate();
  const tab: View = (search.view as View) ?? "dashboard";
  const setTab = (v: View) =>
    navigate({ to: "/marketing", search: { view: v } });
  const [openThread, setOpenThread] = useState<number | null>(null);
  const [stopEmail, setStopEmail] = useState("");
  const [stopReason, setStopReason] = useState("");
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q);

  const stats = useQuery({
    queryKey: ["marketing", "stats"],
    queryFn: async (): Promise<{
      totals: Totals;
      bySender: {
        sender: string;
        sent: number;
        bounced: number;
        opened: number;
        clicked: number;
      }[];
      counts: { contacts: number; templates: number; unsubscribed: number };
    }> => {
      const r = await fetch(`${getApiUrl("marketing/stats")}?days=30`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load stats");
      return r.json();
    },
  });

  const threads = useQuery({
    queryKey: ["marketing", "threads", debouncedQ],
    queryFn: async (): Promise<{ items: Thread[] }> => {
      const r = await fetch(
        `${getApiUrl("marketing/threads")}?q=${encodeURIComponent(q)}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Failed to load threads");
      return r.json();
    },
    enabled: tab === "inbox" || tab === "sent",
  });

  const thread = useQuery({
    queryKey: ["marketing", "thread", openThread],
    queryFn: async (): Promise<{ items: Message[] }> => {
      const r = await fetch(getApiUrl(`marketing/threads/${openThread}`), {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load thread");
      return r.json();
    },
    enabled: openThread !== null,
  });

  const contacts = useQuery({
    queryKey: ["marketing", "contacts", debouncedQ],
    queryFn: async (): Promise<{ items: Contact[] }> => {
      const r = await fetch(
        `${getApiUrl("marketing/contacts")}?q=${encodeURIComponent(q)}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Failed to load contacts");
      return r.json();
    },
    enabled: tab === "contacts",
  });

  const sequences = useQuery({
    queryKey: ["marketing", "sequences"],
    queryFn: async (): Promise<{ items: Sequence[] }> => {
      const r = await fetch(getApiUrl("marketing/sequences"), {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load sequences");
      return r.json();
    },
    enabled: tab === "sequences",
  });

  const templates = useQuery({
    queryKey: ["marketing", "templates"],
    queryFn: async (): Promise<{
      items: { id: number; name: string | null; subject: string | null; body: string | null }[];
    }> => {
      const r = await fetch(getApiUrl("marketing/templates"), {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load templates");
      return r.json();
    },
    enabled: tab === "templates",
  });

  const followups = useQuery({
    queryKey: ["marketing", "followups"],
    queryFn: async (): Promise<{
      items: {
        id: number;
        campaign: string | null;
        contact_email: string;
        subject: string | null;
        total_steps: number;
        sent_steps: number;
        next_send: string | null;
      }[];
    }> => {
      const r = await fetch(getApiUrl("marketing/followups"), {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load follow-ups");
      return r.json();
    },
  });

  /*
   * The Stop List. The follow-up dispatcher has always honoured this table,
   * but nothing on this stack could add to it — so when a client replied
   * "stop emailing me", there was no button to press.
   */
  const exclusions = useQuery({
    queryKey: ["marketing", "exclusions"],
    queryFn: async (): Promise<{
      items: {
        id: number;
        email: string;
        reason: string | null;
        created_at: string | null;
        createdAt?: string | null;
      }[];
    }> => {
      const r = await fetch(getApiUrl("marketing/exclusions"), {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load the stop list");
      return r.json();
    },
    enabled: tab === "stoplist",
  });

  const addExclusion = useMutation({
    mutationFn: (input: { email: string; reason: string }) =>
      postJson("marketing/exclusions", input),
    onSuccess: () => {
      toast.success("Added to the stop list — no further emails will go out");
      setStopEmail("");
      setStopReason("");
      queryClient.invalidateQueries({ queryKey: ["marketing", "exclusions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeExclusion = useMutation({
    mutationFn: async (email: string) => {
      const r = await fetch(
        `${getApiUrl("marketing/exclusions")}?email=${encodeURIComponent(email)}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!r.ok) throw new Error("Failed to remove");
      return r.json();
    },
    onSuccess: () => {
      toast.success("Removed from the stop list");
      queryClient.invalidateQueries({ queryKey: ["marketing", "exclusions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stopSequence = useMutation({
    mutationFn: (id: number) =>
      postJson<{ cancelledSteps: number }>(`marketing/sequences/${id}/stop`, {}),
    onSuccess: (res) => {
      toast.success(
        `Sequence stopped — ${res.cancelledSteps} unsent follow-up(s) cancelled`,
      );
      queryClient.invalidateQueries({ queryKey: ["marketing", "sequences"] });
      queryClient.invalidateQueries({ queryKey: ["marketing", "followups"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const t = stats.data?.totals;
  const counts = stats.data?.counts;
  const rate = (n: number, of: number) => (of > 0 ? (n / of) * 100 : null);

  return (
    <Layout>
      <PageTitle title="Marketing" />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="text-xl font-semibold">Marketing</h1>
        <Button
          size="sm"
          variant="outline"
          className="ms-auto h-8 gap-1.5"
          // Compose lives here now. This used to open the legacy app in a new
          // tab, which is the last thing on this screen that still did.
          onClick={() => navigate({ to: "/marketing/compose" })}
        >
          <Pencil className="size-3.5" />
          Compose
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        <p className="mb-4 rounded border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Reading is here. Composing, follow-up scheduling and bounce polling
          still run on the legacy app — they move once Inngest and the IMAP
          sidecar are in place, so a sequence can't be half-migrated mid-flight.
        </p>

        {tab === "dashboard" ? (
        stats.isLoading || !t ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            {t.bounced > 0 ? (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />
                <span>
                  <strong>Attention:</strong> {t.bounced} emails have bounced.
                  Review your contact list to protect sender reputation.
                </span>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Stat label="Emails Sent" value={t.sent} Icon={Send} hex="#4f46e5" />
              <Stat
                label="Delivered"
                value={t.delivered}
                sub={pct(t.delivered, t.sent)}
                Icon={CheckCircle2}
                hex="#059669"
              />
              <Stat
                label="Opened"
                value={t.opened}
                sub={pct(t.opened, t.delivered)}
                Icon={Eye}
                hex="#7c3aed"
              />
              <Stat
                label="Clicked"
                value={t.clicked}
                sub={pct(t.clicked, t.delivered)}
                Icon={MousePointerClick}
                hex="#ea580c"
              />
              <Stat
                label="Unsubscribed"
                value={counts?.unsubscribed ?? 0}
                Icon={UserMinus}
                hex="#dc2626"
              />
            </div>

            {(stats.data?.bySender ?? []).length > 0 ? (
              <div className="mt-4 rounded-xl border border-border bg-card p-4">
                <div className="text-sm font-medium">Deliverability by sender</div>
                <p className="text-xs text-muted-foreground">
                  Open / click / bounce broken out per sending domain
                </p>
                <div className="mt-3 space-y-2">
                  {stats.data?.bySender.map((s2) => {
                    const open = rate(s2.opened, s2.sent);
                    const click = rate(s2.clicked, s2.sent);
                    const bounce = rate(s2.bounced, s2.sent);
                    return (
                      <div
                        key={s2.sender}
                        className="rounded-lg border border-border p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{s2.sender}</span>
                          <span className="text-xs text-muted-foreground">
                            {s2.sent} sent
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-8">
                          <div>
                            <div
                              className="text-lg font-bold tabular-nums"
                              style={{ color: "#7c3aed" }}
                            >
                              {open === null ? "—" : `${open.toFixed(1)}%`}
                            </div>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              Open
                            </div>
                          </div>
                          <div>
                            <div
                              className="text-lg font-bold tabular-nums"
                              style={{ color: "#ea580c" }}
                            >
                              {click === null ? "—" : `${click.toFixed(1)}%`}
                            </div>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              Click
                            </div>
                          </div>
                          <div>
                            <div
                              className="text-lg font-bold tabular-nums"
                              style={{
                                color: (bounce ?? 0) > 0 ? "#dc2626" : "#059669",
                              }}
                            >
                              {bounce === null ? "—" : `${bounce.toFixed(1)}%`}
                            </div>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              Bounce
                            </div>
                          </div>
                        </div>
                        <div className="mt-1.5 text-xs text-muted-foreground">
                          {s2.opened} opened · {s2.clicked} clicked ·{" "}
                          {s2.bounced} bounced
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <RateCard
                label="Open Rate"
                rate={rate(t.opened, t.delivered)}
                hex="#7c3aed"
              />
              <RateCard
                label="Click Rate"
                rate={rate(t.clicked, t.delivered)}
                hex="#ea580c"
              />
              <Stat
                label="Total Contacts"
                value={counts?.contacts ?? 0}
                Icon={Users}
                hex="#0ea5e9"
              />
              <Stat
                label="Templates"
                value={counts?.templates ?? 0}
                Icon={FileText}
                hex="#64748b"
              />
            </div>

            {(followups.data?.items ?? []).length > 0 ? (
              <div className="mt-4 overflow-hidden rounded-xl border border-amber-500/30 bg-card">
                <div className="flex items-center gap-2 border-b border-border bg-amber-500/5 px-4 py-2.5">
                  <Timer className="size-4 text-amber-500" />
                  <span className="text-sm font-medium">Active follow-ups</span>
                  <span className="rounded-full bg-amber-500/15 px-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                    {followups.data?.items.length}
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th className="px-4 py-2 text-left font-medium">Recipient</th>
                      <th className="px-4 py-2 text-left font-medium">Progress</th>
                      <th className="px-4 py-2 text-left font-medium">Next send</th>
                    </tr>
                  </thead>
                  <tbody>
                    {followups.data?.items.map((f) => {
                      const overdue =
                        f.next_send && new Date(f.next_send).getTime() < Date.now();
                      return (
                        <tr key={f.id} className="border-t border-border">
                          <td className="px-4 py-2.5">
                            <div className="font-medium">{f.contact_email}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {f.subject ?? f.campaign ?? ""}
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <ProgressDots sent={f.sent_steps} total={f.total_steps} />
                          </td>
                          <td
                            className={cn(
                              "px-4 py-2.5 text-xs",
                              overdue
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground",
                            )}
                          >
                            {overdue ? "Next overdue" : when(f.next_send)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {(
            [
              "dashboard",
              "inbox",
              "sent",
              "sequences",
              "stoplist",
              "contacts",
              "templates",
            ] as const
          ).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={tab === k ? "default" : "ghost"}
              className="h-8 capitalize"
              onClick={() => {
                setTab(k);
                setOpenThread(null);
              }}
            >
              {k === "inbox" ? <Mail className="me-1.5 size-3.5" /> : null}
              {k === "contacts" ? <Users className="me-1.5 size-3.5" /> : null}
              {k}
            </Button>
          ))}
          {tab !== "sequences" ? (
            <div className="relative ms-auto">
              <Search className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search"
                className="h-8 w-56 ps-8"
              />
            </div>
          ) : null}
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
          {tab === "inbox" ? (
            openThread === null ? (
              <table className="w-full text-sm">
                <tbody>
                  {(threads.data?.items ?? []).map((th) => (
                    <tr
                      key={th.id}
                      onClick={() => setOpenThread(th.id)}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/40"
                    >
                      <td className="px-4 py-2.5">
                        <div className="font-medium">
                          {th.subject || "(no subject)"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {th.participant ?? "—"}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                        {th.message_count} msg · {when(th.last_activity_date)}
                      </td>
                    </tr>
                  ))}
                  {(threads.data?.items ?? []).length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-muted-foreground">
                        No threads.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            ) : (
              <div className="p-4">
                <Button
                  size="sm"
                  variant="ghost"
                  className="mb-3 h-7"
                  onClick={() => setOpenThread(null)}
                >
                  ← Back
                </Button>
                <ul className="space-y-3">
                  {(thread.data?.items ?? []).map((m) => (
                    <li
                      key={m.id}
                      className="rounded border border-border p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>
                          {m.sender_email} → {m.recipient_email}
                        </span>
                        <span>
                          {m.status} · {m.provider ?? "—"} · {when(m.sent_date)}
                          {m.opened_count ? ` · ${m.opened_count} opens` : ""}
                        </span>
                      </div>
                      <div className="mt-1 font-medium">{m.subject}</div>
                      <p className="mt-1.5 whitespace-pre-wrap text-muted-foreground">
                        {m.body?.slice(0, 1200)}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : tab === "sent" ? (
            <table className="w-full text-sm">
              <tbody>
                {(threads.data?.items ?? []).map((th) => (
                  <tr
                    key={th.id}
                    onClick={() => {
                      setOpenThread(th.id);
                      setTab("inbox");
                    }}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/40"
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium">
                        {th.subject || "(no subject)"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {th.participant ?? "—"}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                      {th.message_count} msg · {when(th.last_activity_date)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : tab === "templates" ? (
            <ul className="divide-y divide-border">
              {(templates.data?.items ?? []).map((tpl) => (
                <li key={tpl.id} className="p-4">
                  <div className="font-medium">{tpl.name ?? "(untitled)"}</div>
                  <div className="text-xs text-muted-foreground">
                    {tpl.subject ?? "—"}
                  </div>
                  <p className="mt-1.5 line-clamp-3 text-sm text-muted-foreground">
                    {(tpl.body ?? "").replace(/<[^>]+>/g, " ").slice(0, 300)}
                  </p>
                </li>
              ))}
              {(templates.data?.items ?? []).length === 0 ? (
                <li className="p-8 text-center text-sm text-muted-foreground">
                  No templates.
                </li>
              ) : null}
            </ul>
          ) : tab === "contacts" ? (
            <table className="w-full text-sm">
              <tbody>
                {(contacts.data?.items ?? []).map((ct) => (
                  <tr key={ct.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">
                        {[ct.first_name, ct.last_name].filter(Boolean).join(" ") ||
                          ct.email}
                      </div>
                      <div className="text-xs text-muted-foreground">{ct.email}</div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {ct.company ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                      {when(ct.last_engagement)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : tab === "stoplist" ? (
            <div>
              {/* Add form first, not behind a button. Someone reaching this
                  screen is reacting to an angry reply and wants one field. */}
              <div className="flex flex-wrap items-end gap-2 border-b border-border p-4">
                <div className="grow">
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Email to stop
                  </label>
                  <Input
                    value={stopEmail}
                    onChange={(e) => setStopEmail(e.target.value)}
                    placeholder="them@example.com"
                    type="email"
                  />
                </div>
                <div className="grow">
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Reason (optional)
                  </label>
                  <Input
                    value={stopReason}
                    onChange={(e) => setStopReason(e.target.value)}
                    placeholder="Asked to stop / bounced / competitor"
                  />
                </div>
                <Button
                  onClick={() =>
                    addExclusion.mutate({
                      email: stopEmail.trim(),
                      reason: stopReason.trim(),
                    })
                  }
                  disabled={!stopEmail.trim() || addExclusion.isPending}
                >
                  <Ban className="size-3.5" />
                  Add to stop list
                </Button>
              </div>

              <p className="px-4 pt-3 text-xs text-muted-foreground">
                Nobody on this list receives another marketing email or
                follow-up. The dispatcher checks it before every send.
              </p>

              <table className="mt-2 w-full text-sm">
                <tbody>
                  {(exclusions.data?.items ?? []).map((ex) => (
                    <tr
                      key={ex.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-2.5 font-medium">{ex.email}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {ex.reason || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                        {when(ex.created_at ?? ex.createdAt ?? null)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          title="Remove — they will start receiving email again"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Remove ${ex.email}? They will start receiving marketing email again.`,
                              )
                            )
                              removeExclusion.mutate(ex.email);
                          }}
                          disabled={removeExclusion.isPending}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!exclusions.isLoading &&
                  (exclusions.data?.items ?? []).length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-8 text-center text-muted-foreground"
                      >
                        Nobody is on the stop list.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {(sequences.data?.items ?? []).map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-medium">
                      {s.campaign || `Sequence #${s.id}`}
                    </td>
                    <td className="px-4 py-2.5">{s.status}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {s.sent_items}/{s.total_items} sent
                      {s.pending_items ? ` · ${s.pending_items} pending` : ""}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {s.status === "active" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (
                              window.confirm(
                                "Stop this sequence? Its unsent follow-ups will be cancelled.",
                              )
                            )
                              stopSequence.mutate(s.id);
                          }}
                          disabled={stopSequence.isPending}
                        >
                          <Ban className="size-3.5" />
                          Stop
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/marketing")({
  validateSearch: (raw: Record<string, unknown>) => ({
    view: typeof raw.view === "string" ? raw.view : undefined,
  }),
  component: RouteComponent,
});
