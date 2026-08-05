/**
 * Outreach — the one place outreach happens.
 *
 * This page used to be a stack: a stats block, a campaign card with three
 * numbers and a Start button, an approved queue, and a deliverability table,
 * all on one scroll. Running a campaign meant knowing which parts to use and
 * in what order, and the order was not written down anywhere. Worse, that
 * Start button drafted AND sent in one motion, so there was never a moment
 * when the emails existed to be checked.
 *
 * It is four stages now, in the order they are actually used:
 *
 *   Campaign   the wizard — audience, message, pacing, generate, review
 *   Queue      drafted and waiting, reviewable, fires as one batch
 *   Scheduled  the follow-ups already queued behind what has sent
 *   Sent       deliverability and engagement, all history
 *
 * The stage counts are the answer to "did that work" — Queue 200 after
 * generating, Scheduled 600 after sending 200 four-step sequences — so the
 * numbers that matter are on screen without opening anything.
 *
 * Finishing the wizard moves to Queue and sending moves to Scheduled: the flow
 * carries you forward rather than leaving you to find the next screen. Running
 * a campaign end to end no longer touches the sidebar once.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import Layout from "@/components/common/layout";
import { CampaignWizard } from "@/components/leadgen/campaign/wizard";
import { StepReview } from "@/components/leadgen/campaign/step-review";
import { ScheduledPane } from "@/components/leadgen/scheduled-pane";
import { StatsPane } from "@/components/leadgen/stats-pane";
import PageTitle from "@/components/page-title";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { leadgenEmails } from "@/fetchers/leadgen/emails";

/**
 * `meaning` is not decoration. Three of these four badges carry a count, and
 * only one of them counts emails that have actually gone out — a Queue of 23
 * and a Sent of 552 sit side by side and read as the same kind of number. The
 * legend under the nav says which is which in words, permanently, because the
 * one time it was left implicit a queue depth got reported to the client as
 * the day's send volume.
 */
const STAGES = [
  { key: "campaign", label: "Campaign", meaning: "" },
  { key: "queue", label: "Queue", meaning: "written, not sent yet" },
  { key: "scheduled", label: "Scheduled", meaning: "follow-ups queued for later" },
  { key: "sent", label: "Sent", meaning: "actually went out" },
] as const;

type Stage = (typeof STAGES)[number]["key"];
type Search = { stage?: Stage };

function RouteComponent() {
  const navigate = useNavigate();
  const { stage = "campaign" } = useSearch({ strict: false }) as Search;

  const go = (next: Stage) =>
    navigate({ to: "/emails", search: { stage: next }, replace: true });

  // Counts for the stage badges. Cheap, cached, and they double as the
  // verification that a run did what it said it did.
  const queue = useQuery({
    queryKey: ["leadgen", "approved"],
    queryFn: leadgenEmails.approved,
    staleTime: 30_000,
  });
  const scheduled = useQuery({
    queryKey: ["leadgen", "scheduled"],
    queryFn: () => leadgenEmails.scheduled(30),
    staleTime: 60_000,
  });
  const stats = useQuery({
    queryKey: ["leadgen", "email-stats"],
    queryFn: () => leadgenEmails.stats(7),
    staleTime: 60_000,
  });

  const counts: Record<Stage, number | null> = {
    campaign: null,
    queue: queue.data?.items?.length ?? null,
    scheduled: scheduled.data?.summary?.steps ?? null,
    sent: stats.data?.window?.sent ?? null,
  };

  return (
    <Layout>
      <PageTitle title="Outreach" />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="text-xl font-semibold">Outreach</h1>
        <nav className="ms-4 flex flex-wrap items-center gap-1">
          {STAGES.map((s) => {
            const active = s.key === stage;
            const n = counts[s.key];
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => go(s.key)}
                title={s.meaning ? `${s.label} — ${s.meaning}` : s.label}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm ${
                  active
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {s.label}
                {n !== null && n > 0 ? (
                  <span className="rounded bg-muted px-1.5 text-xs tabular-nums">
                    {n}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </header>

      <p className="shrink-0 border-b border-border px-5 py-1.5 text-xs text-muted-foreground">
        {STAGES.filter((s) => s.meaning)
          .map((s) => `${s.label} = ${s.meaning}`)
          .join(" · ")}
      </p>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-6xl">
          {stage === "campaign" ? (
            <CampaignWizard onSent={() => go("scheduled")} />
          ) : stage === "queue" ? (
            <StepReview onSent={() => go("scheduled")} />
          ) : stage === "scheduled" ? (
            <ScheduledPane />
          ) : (
            <StatsPane />
          )}
        </div>
      </div>
    </Layout>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/emails")({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): Search => {
    const s = search.stage;
    return {
      stage: STAGES.some((x) => x.key === s) ? (s as Stage) : undefined,
    };
  },
});
