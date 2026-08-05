/**
 * Account detail — the last cockpit surface, and the one that makes the
 * pipeline actionable lead by lead.
 *
 * Three things live here, in the order the work happens:
 *
 *   1. WHY this account is a lead. The ICP factor scores and the evidence rows
 *      (an NCES enrolment record joined to a named USAspending grant award).
 *      Without the evidence the score is a number nobody trusts.
 *   2. WHO to write to. Contacts ranked by role — Athletic Director and
 *      prevention-coordinator titles first, which is what `role_rank` encodes.
 *   3. THE EMAIL. Pick one of the ten messaging angles, have the model draft
 *      it, read it, then approve.
 *
 * Approving does NOT send. That split is deliberate in the cockpit and is kept:
 * approved sequences sit in a queue that is fired as one explicit action from
 * Outreach, so a mis-click drafts a bad email rather than delivering one.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import Layout from "@/components/common/layout";
import { IcpRadar } from "@/components/leadgen/icp-radar";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { leadgen } from "@/fetchers/leadgen/client";
import { leadgenEmailExtras } from "@/fetchers/leadgen/emails";
import { EmailPreview } from "@/components/leadgen/email-preview";

type Evidence = {
  id: number;
  label?: string;
  source?: string;
  url?: string;
  snippet?: string;
};

type AccountDetail = {
  id: number;
  company: string;
  website?: string;
  industry?: string;
  location?: string;
  headcount?: string | number;
  icp_score?: number;
  icp_enhanced_score?: number;
  spark_brief?: string;
  signal_category?: string;
  signal_evidence?: string;
  phone?: string;
  email?: string;
  linkedin_url?: string;
  data_batch?: string;
  /** 0–10 per factor: industry_fit, signal_strength, role_relevance, company_fit. */
  swot?: Record<string, number>;
  evidence?: Evidence[];
};

type Contact = {
  id: number;
  person_name?: string;
  job_title?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
  source_kind?: string;
  confidence?: number;
  role_rank?: number;
};

type Step = { step_index?: number; subject?: string; body?: string };

type EmailPayload = {
  sequence?: {
    id?: number;
    person_name?: string;
    to_email?: string;
    from_email?: string;
    status?: string;
  } | null;
  steps?: Step[] | null;
  suggested_email?: string;
  suggested_angle?: string;
  suggested_inbox_id?: number;
  angles?: { key: string; name: string }[];
  inboxes?: {
    id: number;
    email: string;
    daily_cap?: number | null;
    enabled?: number | null;
  }[];
};

const FACTOR_LABEL: Record<string, string> = {
  industry_fit: "Industry fit",
  signal_strength: "Signal strength",
  role_relevance: "Role relevance",
  company_fit: "Company fit",
};

function RouteComponent() {
  const { accountId } = useParams({ strict: false }) as { accountId: string };
  const qc = useQueryClient();
  const [angle, setAngle] = useState<string>("");
  /** Raw copy vs the rendered email. Reading the copy is editing; reading the
   *  render is checking what the school actually receives. */
  const [showRendered, setShowRendered] = useState(true);
  /** Which mailbox sends, and to whom. Empty means "whatever the cockpit
   *  already decided" — auto-rotation at send time, and the contact it picked. */
  const [inboxId, setInboxId] = useState<number | "">("");
  const [toEmail, setToEmail] = useState("");

  const account = useQuery({
    queryKey: ["leadgen", "account", accountId],
    queryFn: () => leadgen.get<AccountDetail>(`/api/accounts/${accountId}`),
  });

  const contacts = useQuery({
    queryKey: ["leadgen", "account-contacts", accountId],
    queryFn: () =>
      leadgen.get<{ items: Contact[] }>(`/api/accounts/${accountId}/contacts`),
  });

  const email = useQuery({
    queryKey: ["leadgen", "lead-email", accountId],
    queryFn: () => leadgen.get<EmailPayload>(`/api/leads/${accountId}/email`),
  });

  // Seed the angle picker from the cockpit's own suggestion. pick_angle() is
  // deterministic per account, so the suggestion is stable and A/B results stay
  // attributable — overriding it should be a choice, not an accident.
  useEffect(() => {
    if (!angle && email.data?.suggested_angle)
      setAngle(email.data.suggested_angle);
  }, [angle, email.data?.suggested_angle]);

  // Same idea for the mailbox and the recipient: seeded once from the cockpit's
  // own choice, then left alone so a refetch cannot overwrite an edit in flight.
  useEffect(() => {
    const d = email.data;
    if (!d) return;
    setInboxId((i) => (i === "" ? (d.suggested_inbox_id ?? "") : i));
    setToEmail((t) => t || d.sequence?.to_email || d.suggested_email || "");
  }, [email.data]);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["leadgen", "lead-email", accountId] });

  const draft = useMutation({
    mutationFn: () =>
      leadgen.post(`/api/leads/${accountId}/email/draft`, angle ? { angle } : {}),
    onSuccess: invalidate,
  });
  const approve = useMutation({
    mutationFn: () =>
      leadgen.post(`/api/leads/${accountId}/email/approve`, {
        ...(toEmail ? { to_email: toEmail } : {}),
        ...(typeof inboxId === "number" ? { inbox_id: inboxId } : {}),
      }),
    onSuccess: invalidate,
  });
  // Pull an approved sequence back to draft before the queue fires it.
  const unapprove = useMutation({
    mutationFn: (id: number) => leadgenEmailExtras.unapprove(id),
    onSuccess: invalidate,
  });

  const activity = useQuery({
    queryKey: ["leadgen", "lead-activity", accountId],
    queryFn: () =>
      leadgen.get<{ items: Record<string, unknown>[]; status?: string }>(
        `/api/leads/${accountId}/activity`,
      ),
  });

  const a = account.data;
  const steps = email.data?.steps ?? [];
  const seq = email.data?.sequence;
  const approved = seq?.status === "approved";
  // Once it is out the door the recipient and mailbox are history, not settings.
  const sent = seq?.status === "sent" || seq?.status === "sending";

  return (
    <Layout>
      <PageTitle title={a?.company ?? "Lead"} />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <a
          href="/pipeline"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Leads
        </a>
        <h1 className="truncate text-lg font-semibold">
          {account.isLoading ? "…" : (a?.company ?? "Lead")}
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-4xl space-y-5">
          {account.isLoading ? (
            <Skeleton className="h-32" />
          ) : account.error ? (
            <p className="text-sm text-red-500">
              {String(account.error as Error)}
            </p>
          ) : a ? (
            <>
              {/* Why it is a lead. */}
              <section className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-500 tabular-nums">
                    ICP {(a.icp_enhanced_score ?? a.icp_score)?.toFixed(1)}
                  </span>
                  {a.industry ? <span>{a.industry}</span> : null}
                  {a.location ? (
                    <span className="text-muted-foreground">{a.location}</span>
                  ) : null}
                  {a.headcount ? (
                    <span className="text-muted-foreground">
                      {a.headcount} students
                    </span>
                  ) : null}
                  {a.website ? (
                    <a
                      href={
                        a.website.startsWith("http")
                          ? a.website
                          : `https://${a.website}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ms-auto flex items-center gap-1 text-xs underline underline-offset-2"
                    >
                      website <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </div>

                {a.spark_brief ? (
                  <p className="mt-3 text-sm">{a.spark_brief}</p>
                ) : null}

                {/*
                  The radar is the cockpit's own view of these four numbers, and
                  it reads differently from bars: the SHAPE is the signal. Funding
                  at 10 with role at 5 is "the money is there, we have the wrong
                  person" — a different next action from a small even shape. Bars
                  make you compute that; the outline shows it.

                  The numbers stay beside it, because a radar alone cannot be read
                  precisely and these get quoted in calls.
                */}
                {a.swot ? (
                  <div className="mt-4 flex flex-wrap items-center gap-6">
                    <IcpRadar swot={a.swot} />
                    <div className="grid min-w-48 flex-1 gap-2">
                      {Object.entries(a.swot).map(([k, v]) => (
                        <div key={k} className="flex items-center gap-2">
                          <span className="w-32 shrink-0 text-xs text-muted-foreground">
                            {FACTOR_LABEL[k] ?? k}
                          </span>
                          <div className="h-1.5 flex-1 rounded-full bg-muted">
                            <div
                              className="h-1.5 rounded-full bg-primary"
                              style={{
                                width: `${Math.max(0, Math.min(10, v)) * 10}%`,
                              }}
                            />
                          </div>
                          <span className="w-6 text-end text-xs tabular-nums">
                            {v}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {a.evidence?.length ? (
                  <div className="mt-4 space-y-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Evidence
                    </div>
                    {a.evidence.map((e) => (
                      <div
                        key={e.id}
                        className="rounded border border-border p-2 text-xs"
                      >
                        <div className="flex flex-wrap gap-2 text-muted-foreground">
                          {e.label ? (
                            <span className="rounded bg-muted px-1.5">
                              {e.label}
                            </span>
                          ) : null}
                          {e.source ? <span>{e.source}</span> : null}
                          {e.url ? (
                            <a
                              href={e.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline underline-offset-2"
                            >
                              source
                            </a>
                          ) : null}
                        </div>
                        {e.snippet ? <p className="mt-1">{e.snippet}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>

              {/* Who to write to. */}
              <section className="rounded-lg border border-border bg-card p-4">
                <div className="text-sm font-semibold">Contacts</div>
                {contacts.isLoading ? (
                  <Skeleton className="mt-3 h-16" />
                ) : !contacts.data?.items?.length ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No contacts found yet. Run “Find contacts” on Live Finder —
                    an account with no address cannot be emailed.
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-border">
                    {contacts.data.items.map((c) => (
                      <li key={c.id} className="flex flex-wrap gap-3 py-2 text-sm">
                        <span className="font-medium">
                          {c.person_name || "—"}
                        </span>
                        <span className="text-muted-foreground">
                          {c.job_title || "—"}
                        </span>
                        {c.email ? (
                          <a
                            href={`mailto:${c.email}`}
                            className="underline underline-offset-2"
                          >
                            {c.email}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">
                            no address
                          </span>
                        )}
                        {c.phone ? (
                          <a href={`tel:${c.phone}`} className="text-muted-foreground">
                            {c.phone}
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* The email. */}
              <section className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-sm font-semibold">Outreach</div>
                  {seq?.status ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {seq.status}
                    </span>
                  ) : null}
                  <div className="ms-auto flex flex-wrap items-center gap-2">
                    <select
                      value={angle}
                      onChange={(e) => setAngle(e.target.value)}
                      className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                    >
                      {(email.data?.angles ?? []).map((opt) => (
                        <option key={opt.key} value={opt.key}>
                          {opt.name}
                          {opt.key === email.data?.suggested_angle
                            ? " (suggested)"
                            : ""}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      onClick={() => draft.mutate()}
                      disabled={draft.isPending}
                    >
                      {draft.isPending ? "Drafting…" : "Draft with AI"}
                    </Button>
                    {approved && seq?.id ? (
                      <Button
                        variant="outline"
                        onClick={() => unapprove.mutate(seq.id as number)}
                        disabled={unapprove.isPending}
                      >
                        {unapprove.isPending ? "Reverting…" : "Unapprove"}
                      </Button>
                    ) : (
                      <Button
                        onClick={() => approve.mutate()}
                        disabled={approve.isPending || !steps.length}
                      >
                        {approve.isPending ? "Approving…" : "Approve"}
                      </Button>
                    )}
                  </div>
                </div>

                {/*
                  Recipient and mailbox, editable rather than reported.
                  A school with three contacts and a mailbox at its daily cap
                  are both normal, and neither was changeable from here — the
                  line just stated whatever the cockpit had already decided.
                */}
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <label className="min-w-56 flex-1">
                    <span className="text-xs text-muted-foreground">To</span>
                    <input
                      value={toEmail}
                      onChange={(e) => setToEmail(e.target.value)}
                      disabled={sent}
                      placeholder={email.data?.suggested_email || "nobody@example.org"}
                      className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                    />
                  </label>
                  <label className="min-w-56 flex-1">
                    <span className="text-xs text-muted-foreground">
                      Send from
                    </span>
                    <select
                      value={inboxId}
                      onChange={(e) =>
                        setInboxId(e.target.value ? Number(e.target.value) : "")
                      }
                      disabled={sent}
                      className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                    >
                      <option value="">Auto-rotate at send time</option>
                      {(email.data?.inboxes ?? []).map((i) => (
                        <option key={i.id} value={i.id} disabled={i.enabled === 0}>
                          {i.email}
                          {i.enabled === 0 ? " — disabled" : ""}
                          {i.daily_cap ? ` · cap ${i.daily_cap}/day` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <p className="mt-2 text-xs text-muted-foreground">
                  Approving queues it. Sending happens from Outreach, as one
                  deliberate batch.
                  {seq?.from_email ? ` Already assigned to ${seq.from_email}.` : ""}
                </p>

                {(draft.error || approve.error) && (
                  <p className="mt-2 text-xs text-red-500">
                    {String((draft.error || approve.error) as Error)}
                  </p>
                )}

                {steps.length ? (
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setShowRendered(true)}
                      className={showRendered ? "font-medium" : "text-muted-foreground"}
                    >
                      Preview
                    </button>
                    <span className="text-muted-foreground">/</span>
                    <button
                      type="button"
                      onClick={() => setShowRendered(false)}
                      className={!showRendered ? "font-medium" : "text-muted-foreground"}
                    >
                      Copy
                    </button>
                    <span className="text-muted-foreground">
                      — preview renders through the production template, so it
                      includes the signature and the per-angle creative.
                    </span>
                  </div>
                ) : null}

                {email.isLoading ? (
                  <Skeleton className="mt-3 h-32" />
                ) : steps.length ? (
                  <div className="mt-3 space-y-3">
                    {steps.map((st, i) => (
                      <div
                        key={st.step_index ?? i}
                        className="rounded border border-border p-3"
                      >
                        <div className="text-xs text-muted-foreground">
                          {i === 0 ? "Opener" : `Follow-up ${i}`}
                        </div>
                        <div className="mt-1 text-sm font-medium">
                          {st.subject || "(no subject)"}
                        </div>
                        {showRendered ? (
                          <div className="mt-2">
                            <EmailPreview
                              body={st.body ?? ""}
                              fromEmail={seq?.from_email ?? undefined}
                              angle={angle}
                              stepIndex={st.step_index ?? i}
                              className="h-[26rem] w-full rounded-md border border-border bg-white"
                            />
                          </div>
                        ) : (
                          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                            {st.body || ""}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No sequence drafted yet. Pick an angle and press “Draft with
                    AI”.
                  </p>
                )}
              </section>

              {/* What has already happened to this lead. */}
              <section className="rounded-lg border border-border bg-card p-4">
                <div className="text-sm font-semibold">Activity</div>
                {activity.isLoading ? (
                  <Skeleton className="mt-3 h-16" />
                ) : !activity.data?.items?.length ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Nothing sent to this lead yet.
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-border text-sm">
                    {activity.data.items.map((ev, i) => (
                      <li
                        key={`${String(ev.ts ?? i)}-${i}`}
                        className="flex flex-wrap gap-3 py-2"
                      >
                        <span className="font-medium">
                          {String(ev.kind ?? ev.status ?? "event")}
                        </span>
                        {ev.subject ? (
                          <span className="text-muted-foreground">
                            {String(ev.subject)}
                          </span>
                        ) : null}
                        {ev.ts ? (
                          <span className="ms-auto text-xs text-muted-foreground">
                            {new Date(Number(ev.ts) * 1000).toLocaleString()}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : null}
        </div>
      </div>
    </Layout>
  );
}

export const Route = createFileRoute(
  "/_layout/_authenticated/pipeline_/$accountId",
)({ component: RouteComponent });
