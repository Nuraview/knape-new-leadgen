/**
 * Email history on Home — what has gone out, and what is queued to go.
 *
 * Home answered "how is outreach performing" (the four headline numbers) and
 * "what does the email look like", but not "what has actually been sent". That
 * gap is the reason to ask an operator, and it is the first question anyone
 * paying for outreach has. Both halves already existed in the cockpit and were
 * already proxied — nothing here is new capability, only a surface for it:
 *
 *   GET /api/emails/recent     the sent log, newest first, paginated
 *   GET /api/emails/scheduled  follow-ups not yet sent, soonest first
 *
 * Deliberately READ-ONLY and capped at ten rows each. The full lists, with the
 * controls that stop a sequence or pull one back to draft, live on Outreach.
 * This page is for the person who wants to know the machine is working, not for
 * the person operating it — putting a "cancel" button here would invite an
 * accidental click on someone else's campaign.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarClock, Send } from "lucide-react";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { SentEmailDialog } from "@/components/leadgen/sent-email-dialog";
import { leadgenEmails, leadgenEmailExtras } from "@/fetchers/leadgen/emails";

/** How many rows each pane shows before deferring to Outreach. */
const ROWS = 10;

function when(ts?: number | null): string {
  if (!ts) return "";
  const ms = ts * 1000;
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60_000);
  if (Math.abs(mins) < 60)
    return diff >= 0 ? `${Math.max(mins, 0)}m ago` : `in ${-mins}m`;
  const hours = Math.round(diff / 3_600_000);
  if (Math.abs(hours) < 24)
    return diff >= 0 ? `${hours}h ago` : `in ${-hours}h`;
  const days = Math.round(diff / 86_400_000);
  if (Math.abs(days) < 7) return diff >= 0 ? `${days}d ago` : `in ${days * -1}d`;
  return new Date(ms).toLocaleDateString();
}

/**
 * Engagement badge.
 *
 * Ordered worst-first: a bounce is the only one that needs acting on, so it
 * must not be hidden behind an "opened" badge on the same row.
 */
function Engagement({
  opens,
  clicks,
  bounced,
}: {
  opens?: number;
  clicks?: number;
  bounced?: number;
}) {
  if (bounced)
    return (
      <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] text-red-500">
        bounced
      </span>
    );
  if (clicks && clicks > 0)
    return (
      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-500">
        clicked
      </span>
    );
  if (opens && opens > 0)
    return (
      <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] text-sky-500">
        opened {opens > 1 ? `${opens}×` : ""}
      </span>
    );
  return <span className="text-[11px] text-muted-foreground">sent</span>;
}

function Rows({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-border/60">{children}</ul>;
}

function Loading() {
  return (
    <div className="space-y-2 p-4">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-9" />
      ))}
    </div>
  );
}

export function EmailHistory() {
  const [openStepId, setOpenStepId] = useState<number | null>(null);

  const sent = useQuery({
    queryKey: ["leadgen", "emails", "recent", ROWS],
    queryFn: () => leadgenEmailExtras.recent(0, ROWS),
    staleTime: 60_000,
  });

  const scheduled = useQuery({
    queryKey: ["leadgen", "emails", "scheduled", 30],
    queryFn: () => leadgenEmails.scheduled(30),
    staleTime: 60_000,
  });

  const sentRows = sent.data?.items ?? [];
  const sentTotal = sent.data?.total ?? sentRows.length;
  const queued = scheduled.data?.items ?? [];
  const summary = scheduled.data?.summary;

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* ------------------------------------------------ sent history -- */}
        <section className="rounded-xl border border-border bg-card">
          <header className="flex flex-wrap items-center gap-2 border-b border-border p-4">
            <Send className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Recently sent</h2>
            {sentTotal > 0 ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                {sentTotal.toLocaleString()} in total
              </span>
            ) : null}
            <Link
              to="/emails"
              className="ms-auto text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Open Outreach
            </Link>
          </header>

          {sent.isLoading ? (
            <Loading />
          ) : sent.error ? (
            <p className="p-4 text-sm text-red-500">
              Could not load the sent log.
            </p>
          ) : !sentRows.length ? (
            <p className="p-4 text-sm text-muted-foreground">
              Nothing has been sent yet. Emails appear here the moment the first
              campaign goes out.
            </p>
          ) : (
            <Rows>
              {sentRows.map((r) => (
                <li key={r.id}>
                  {/*
                    The row opens the email the recipient actually received —
                    the same reader Outreach uses, so there is one rendering of
                    a sent message rather than two that can disagree.
                  */}
                  <button
                    type="button"
                    onClick={() => setOpenStepId(r.id)}
                    className="flex w-full items-center gap-3 px-4 py-2 text-start hover:bg-muted/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {r.company || r.to_email || "—"}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.subject || "(no subject)"}
                      </span>
                    </span>
                    <Engagement
                      opens={r.open_count}
                      clicks={r.click_count}
                      bounced={r.bounced}
                    />
                    <span className="w-16 shrink-0 text-end text-[11px] text-muted-foreground tabular-nums">
                      {when(r.sent_at)}
                    </span>
                  </button>
                </li>
              ))}
            </Rows>
          )}
        </section>

        {/* -------------------------------------------- scheduled queue -- */}
        <section className="rounded-xl border border-border bg-card">
          <header className="flex flex-wrap items-center gap-2 border-b border-border p-4">
            <CalendarClock className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Scheduled to go out</h2>
            {summary && summary.steps > 0 ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                {summary.steps.toLocaleString()} follow-up
                {summary.steps === 1 ? "" : "s"} across{" "}
                {summary.sequences.toLocaleString()} lead
                {summary.sequences === 1 ? "" : "s"}
              </span>
            ) : null}
          </header>

          {scheduled.isLoading ? (
            <Loading />
          ) : scheduled.error ? (
            <p className="p-4 text-sm text-red-500">
              Could not load the schedule.
            </p>
          ) : !queued.length ? (
            /*
             * Says WHY it is empty. "No scheduled emails" beside a working
             * pipeline reads as a fault; the queue is genuinely empty until a
             * sequence is approved, and the reader cannot tell those apart.
             */
            <p className="p-4 text-sm text-muted-foreground">
              Nothing queued. Follow-ups appear here once a sequence is approved
              — each one cancels itself automatically if the company replies or
              the address bounces.
            </p>
          ) : (
            <Rows>
              {queued.slice(0, ROWS).map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 px-4 py-2 text-start"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {s.company || s.to_email}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {s.subject || `Follow-up ${(s.step_index ?? 0) + 1}`}
                    </span>
                  </span>
                  <span className="w-20 shrink-0 text-end text-[11px] text-muted-foreground tabular-nums">
                    {when(s.scheduled_at)}
                  </span>
                </li>
              ))}
            </Rows>
          )}
        </section>
      </div>

      {openStepId !== null ? (
        <SentEmailDialog
          stepId={openStepId}
          onClose={() => setOpenStepId(null)}
        />
      ) : null}
    </>
  );
}
