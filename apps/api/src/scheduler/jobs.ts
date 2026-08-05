/**
 * The scheduled-job registry: one list, two runners.
 *
 * The VPS runs these in-process with croner (see ./index.ts). Dan's instance is
 * a Vercel Function, where nothing outlives a request, so there they are driven
 * by Vercel Cron hitting /api/cron/scheduled/:name.
 *
 * Both read this file. That is the point — the cadences used to live only in
 * the croner call, so a serverless deployment would have had to restate all
 * eight of them in vercel.json, and the two copies would drift the first time
 * anyone retuned an interval. Here the cron expression travels with the job.
 */
import { checkDueDateReminders } from "./due-date-reminders";
import { checkProjectWebhookReminders } from "./project-webhook-reminders";
import { closeStaleWorkClocks } from "./stale-work-clocks";
import { processMarketingFollowups } from "./marketing-followups";
import { pushWorkClockPrompts } from "./work-clock-prompts";
import { processLeadEnrichment } from "./lead-enrichment";
import { checkLeadFlow } from "./lead-flow-watchdog";
import { closeOvernightClocks } from "./close-overnight-clocks";

export type ScheduledJob = {
  /** URL-safe id. Also the :name segment of /api/cron/scheduled/:name. */
  name: string;
  /** Standard 5-field cron expression. */
  schedule: string;
  run: () => Promise<void>;
};

export const SCHEDULED_JOBS: ScheduledJob[] = [
  {
    name: "due-date-reminders",
    schedule: "*/5 * * * *",
    run: checkDueDateReminders,
  },
  // Closes work clocks nobody answered for. Without this the 30-minute prompt
  // is decorative — declining stops the timer, but walking away never did.
  {
    name: "stale-work-clocks",
    schedule: "*/5 * * * *",
    run: closeStaleWorkClocks,
  },
  // Drains mkt_sequence_items. The composer queues follow-up steps; without
  // this they sit "scheduled" forever — which they did, on both stacks, for
  // 23–45 days before anyone noticed the dashboard number never moved.
  {
    name: "marketing-followups",
    schedule: "*/5 * * * *",
    run: processMarketingFollowups,
  },
  // The in-app 30-minute prompt only fires while a tab is open; this reaches
  // the ones that are closed. Targeted per user, never broadcast.
  {
    name: "work-clock-prompts",
    schedule: "*/5 * * * *",
    run: pushWorkClockPrompts,
  },
  {
    name: "project-webhook-reminders",
    schedule: "*/5 * * * *",
    run: checkProjectWebhookReminders,
  },
  // Drains PENDING crm_Lead_Enrichment rows. Replaces the Inngest worker — and
  // with it the last reason the legacy Next app had to exist.
  {
    name: "lead-enrichment",
    schedule: "*/2 * * * *",
    run: processLeadEnrichment,
  },
  // No entry may span local midnight. The resume fix stopped the specific
  // mechanism that turned a night's sleep into 12 on-the-clock hours; this
  // makes the SHAPE impossible rather than merely unlikely.
  {
    name: "close-overnight-clocks",
    schedule: "*/10 * * * *",
    run: closeOvernightClocks,
  },
  // Lead ingestion stopped on 2026-07-29 and nothing said a word — the owner
  // found out by noticing timestamps had stopped moving. Every signal needed to
  // catch it was already on the System Health tab, which is exactly the
  // problem: a dashboard you must remember to open is not monitoring.
  //
  // This one ALERTS rather than reconciles, so it must not be run more often
  // than its own cadence or the alert becomes the noise it was built to escape.
  {
    name: "lead-flow-watchdog",
    schedule: "*/15 * * * *",
    run: checkLeadFlow,
  },
];

export function findScheduledJob(name: string): ScheduledJob | undefined {
  return SCHEDULED_JOBS.find((job) => job.name === name);
}
