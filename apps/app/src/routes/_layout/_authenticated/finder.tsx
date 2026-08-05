/**
 * Live Lead Finder — the operational half of the pipeline.
 *
 * Ported from the cockpit's Live tab: trigger a scrape, trigger contact
 * enrichment, and watch the event feed while they run. The sourcing itself
 * (NCES school universe joined against USAspending grant data, Apify, Serper,
 * Hunter) stays in Python — this is the control surface, not a reimplementation.
 *
 * The contact-enrichment button matters more than it looks. Most accounts in
 * this pipeline have no email address, and enrichment is what converts them
 * into something sendable — so when the outreach pool runs dry, this is the
 * page that refills it.
 *
 * Vendor credit alerts are surfaced prominently because a silently exhausted
 * Serper or Apify key looks exactly like "the scraper found nothing".
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { leadgen } from "@/fetchers/leadgen/client";
import { humaniseEvent } from "@/lib/leadgen/stage-labels";

type PipelineEvent = {
  ts?: number;
  level?: "info" | "success" | "warn" | "error" | "credit" | string;
  message?: string;
  stage?: string;
};

type PipelineStatus = {
  running?: boolean;
  cmd?: string | null;
  started_at?: number | null;
  stage?: string | null;
  credit_alerts?: string[];
  events?: PipelineEvent[];
  /** All of this was already served and none of it was rendered. */
  schedule?: {
    enabled?: boolean;
    times?: string | string[];
    next_run_at?: number | null;
    last_run_at?: number | null;
    auto_enrich?: boolean;
    enrich_quota_left?: number | null;
    enrich_running?: boolean;
  } | null;
  yield?: {
    today?: number;
    total?: number;
    contacts?: number;
    recent_batches?: { batch: string; count: number }[];
  } | null;
  last_run_at?: number | null;
};

function ago(ts?: number | null): string {
  if (!ts) return "never";
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function until(ts?: number | null): string {
  if (!ts) return "not scheduled";
  const secs = Math.floor(ts - Date.now() / 1000);
  if (secs <= 0) return "due now";
  if (secs < 3600) return `in ${Math.floor(secs / 60)}m`;
  return `in ${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

const LEVEL_CLASS: Record<string, string> = {
  success: "text-emerald-500",
  warn: "text-amber-500",
  error: "text-red-500",
  credit: "text-amber-500",
  info: "text-muted-foreground",
};

/** Small metric tile. Same shape as the one on Outreach. */
function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "bad"
      ? "text-red-500"
      : tone === "warn"
        ? "text-amber-500"
        : tone === "good"
          ? "text-emerald-500"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

function RouteComponent() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<PipelineStatus>({
    queryKey: ["leadgen", "pipeline-status"],
    queryFn: () => leadgen.get<PipelineStatus>("/api/pipeline/status"),
    // Fast while a run is in flight — this is the page people stare at.
    refetchInterval: 10_000,
    staleTime: 8_000,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["leadgen", "pipeline-status"] });

  const scrape = useMutation({
    mutationFn: () => leadgen.post("/api/pipeline/scrape"),
    onSuccess: invalidate,
  });
  const enrichContacts = useMutation({
    mutationFn: () => leadgen.post("/api/pipeline/enrich-contacts"),
    onSuccess: invalidate,
  });
  const enrich = useMutation({
    mutationFn: () => leadgen.post("/api/pipeline/enrich"),
    onSuccess: invalidate,
  });

  const running = data?.running === true;
  const events = data?.events ?? [];
  const sched = data?.schedule ?? null;
  const y = data?.yield ?? null;
  const alerts = data?.credit_alerts ?? [];
  const busy =
    scrape.isPending || enrichContacts.isPending || enrich.isPending || running;

  return (
    <Layout>
      <PageTitle title="Live Lead Finder" />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="text-xl font-semibold">Live Lead Finder</h1>
        {running ? (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-500">
            running
          </span>
        ) : null}
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-4xl space-y-5">
          {alerts.length ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-500">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <strong>Vendor credits need attention.</strong>
                <ul className="mt-1 list-inside list-disc">
                  {alerts.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
                <p className="mt-1 text-xs opacity-80">
                  An exhausted key looks identical to “no results found”, which
                  is why this is a banner and not a log line.
                </p>
              </div>
            </div>
          ) : null}

          {/*
            Is the scraper on, when did it last run, when does it run next, and
            what has it actually produced.

            All of this except the yield was already in /api/pipeline/status and
            none of it was on screen, so "is scraping active?" could not be
            answered from the dashboard at all — which is exactly how a scraper
            that had never once run went unnoticed for weeks.
          */}
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold">Scraper</div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  running
                    ? "bg-emerald-500/15 text-emerald-500"
                    : sched?.enabled
                      ? "bg-sky-500/15 text-sky-500"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {running ? "running now" : sched?.enabled ? "scheduled" : "off"}
              </span>
              {running && data?.stage ? (
                <span className="text-xs text-muted-foreground">
                  {data.stage}
                  {data.started_at ? ` · started ${ago(data.started_at)}` : ""}
                </span>
              ) : null}
              {!sched?.enabled ? (
                <span className="text-xs text-amber-500">
                  Switch it on in Pipeline settings — nothing runs until you do.
                </span>
              ) : null}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <Stat
                label="Found today"
                value={y?.today ?? 0}
                tone={(y?.today ?? 0) > 0 ? "good" : "warn"}
              />
              <Stat label="Accounts total" value={y?.total ?? "—"} />
              <Stat label="Contact emails" value={y?.contacts ?? "—"} />
              <Stat
                label="Next run"
                value={sched?.enabled ? until(sched?.next_run_at) : "—"}
                hint={
                  sched?.last_run_at ? `last ${ago(sched.last_run_at)}` : "never run"
                }
              />
            </div>

            {sched?.times ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Runs at {String(sched.times)} server time
                {sched.auto_enrich
                  ? ` · contact-finding follows each run${
                      sched.enrich_quota_left != null
                        ? ` (${sched.enrich_quota_left} left today)`
                        : ""
                    }`
                  : " · contact-finding is OFF, so new accounts arrive without addresses"}
              </p>
            ) : null}

            {y?.recent_batches?.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {y.recent_batches.map((b) => (
                  <span
                    key={b.batch}
                    className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                  >
                    {b.batch}
                    <strong className="ms-1 text-foreground tabular-nums">
                      {b.count}
                    </strong>
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <div className="text-sm font-semibold">Run the pipeline</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Scraping finds new accounts. Contact enrichment finds addresses
              for accounts that have none — that is what refills the outreach
              pool.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => scrape.mutate()} disabled={busy}>
                {scrape.isPending ? "Starting…" : "Find new leads"}
              </Button>
              <Button
                variant="outline"
                onClick={() => enrichContacts.mutate()}
                disabled={busy}
              >
                {enrichContacts.isPending
                  ? "Starting…"
                  : "Find contacts (refill pool)"}
              </Button>
              <Button
                variant="outline"
                onClick={() => enrich.mutate()}
                disabled={busy}
              >
                {enrich.isPending ? "Starting…" : "Deep enrich"}
              </Button>
            </div>
            {(scrape.error || enrichContacts.error || enrich.error) && (
              <p className="mt-3 text-xs text-red-500">
                {String(
                  (scrape.error ||
                    enrichContacts.error ||
                    enrich.error) as Error,
                )}
              </p>
            )}
            {running ? (
              <p className="mt-3 text-xs text-muted-foreground">
                A run is already in flight — the pipeline takes one job at a
                time, so the buttons stay disabled until it finishes.
              </p>
            ) : null}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Activity
            </h2>
            {isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-6" />
                ))}
              </div>
            ) : error ? (
              <p className="text-sm text-red-500">{String(error as Error)}</p>
            ) : !events.length ? (
              <p className="text-sm text-muted-foreground">
                No pipeline activity recorded yet.
              </p>
            ) : (
              <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-border bg-card">
                <ul className="divide-y divide-border font-mono text-xs">
                  {events.map((e, i) => (
                    <li
                      key={`${e.ts ?? i}-${i}`}
                      className="flex gap-3 px-3 py-1.5"
                    >
                      <span className="shrink-0 text-muted-foreground">
                        {e.ts
                          ? new Date(e.ts * 1000).toLocaleTimeString()
                          : "—"}
                      </span>
                      <span
                        className={
                          LEVEL_CLASS[e.level ?? "info"] ?? "text-foreground"
                        }
                      >
                        {(() => {
                          const h = humaniseEvent(e);
                          return `${h.label ? `${h.label} — ` : ""}${h.text}`;
                        })()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>
    </Layout>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/finder")({
  component: RouteComponent,
});
