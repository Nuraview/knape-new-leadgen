/**
 * Liveness assertions — is the machinery actually running?
 *
 * WHY THIS EXISTS, precisely: on 2026-07-28 lead enrichment stopped dead at
 * cutover because INNGEST_BASE_URL and INNGEST_EVENT_KEY were never copied into
 * the new API's env. `events/inngest-send.ts` returns early when they are unset
 * and logs a warning per drop. 220 rows piled up PENDING over two days, every
 * request answered 200, and nobody found out until a parity audit went looking.
 *
 * The lesson is not "add more logging" — the log line was already there, on
 * every single drop. A check whose only output is a log line is not a check.
 * These assertions are pulled by a cron that pushes a WhatsApp message on the
 * transition into failure, and rendered on /administration so the answer to
 * "is it working" is a page rather than a person.
 *
 * Assertions are about TERMINAL STATE, not throughput: rows must not sit in a
 * non-final status longer than they plausibly should. That catches "the worker
 * is gone" and "the queue is not draining" without needing to know what a
 * healthy volume looks like on any given day.
 */
import { sql } from "drizzle-orm";
import crmDb from "../database/crm";
import { isInngestConfigured } from "../events/inngest-send";
import { rowsOf } from "../database/rows";

/**
 * Every threshold in one place, each with the reason for its value. Loosening
 * one should mean editing a commented constant, not tweaking a number buried
 * in a query.
 */
const THRESHOLDS = {
  /** Enrichment is queued then worked within seconds; 30 min is a dead worker. */
  enrichmentStuckMinutes: 30,
  /** The dispatcher runs every 5 min. Two hours late means it is not running. */
  sequenceOverdueHours: 2,
  /** The bridge polls continuously; 15 min unsent means it is not draining. */
  whatsappOutboxMinutes: 15,
  /** The scraper heartbeats on each cycle. */
  scraperHeartbeatMinutes: 30,
} as const;

export type Check = {
  name: string;
  ok: boolean;
  actual: number | string | boolean;
  threshold: number | string | boolean;
  detail: string;
};

/** Single-value scalar query helper; returns 0 when the table is absent. */
async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const rows = rowsOf(await crmDb.execute(query));
  const first = rows?.[0];
  if (!first) return 0;
  const value = Object.values(first)[0];
  return Number(value ?? 0);
}

export async function runLivenessChecks(): Promise<{
  ok: boolean;
  checks: Check[];
}> {
  const checks: Check[] = [];

  /*
   * FIRST, and deliberately not SQL. This is the exact bug that went unnoticed
   * for two days. It costs nothing and needs no database.
   */
  const inngestOk = isInngestConfigured();
  checks.push({
    name: "inngest_configured",
    ok: inngestOk,
    actual: inngestOk,
    threshold: true,
    detail: inngestOk
      ? "INNGEST_BASE_URL and INNGEST_EVENT_KEY are set"
      : "INNGEST_* unset — every enrichment event is being DROPPED silently",
  });

  // Rows parked in a non-final status past the point a live worker would have
  // touched them.
  const stuckEnrichment = await scalar(sql`
    SELECT count(*) FROM "crm_Lead_Enrichment"
    WHERE status = 'PENDING'
      AND "createdAt" < now() - (${THRESHOLDS.enrichmentStuckMinutes} || ' minutes')::interval
  `);
  checks.push({
    name: "enrichment_not_stuck",
    ok: stuckEnrichment === 0,
    actual: stuckEnrichment,
    threshold: 0,
    detail: `${stuckEnrichment} enrichment run(s) PENDING for over ${THRESHOLDS.enrichmentStuckMinutes} min`,
  });

  /*
   * The shape the outage actually had: rows going IN, nothing coming OUT.
   * "Stuck" alone would not have fired on day one — the first rows were only
   * minutes old. This one would have.
   */
  const recent = await scalar(sql`
    SELECT count(*) FROM "crm_Lead_Enrichment"
    WHERE "createdAt" > now() - interval '24 hours'
  `);
  const recentDone = await scalar(sql`
    SELECT count(*) FROM "crm_Lead_Enrichment"
    WHERE "createdAt" > now() - interval '24 hours'
      AND status IN ('COMPLETED', 'SKIPPED', 'FAILED')
  `);
  checks.push({
    name: "enrichment_progressing",
    ok: recent === 0 || recentDone > 0,
    actual: `${recentDone}/${recent} reached a terminal status`,
    threshold: "> 0 when any were queued",
    detail:
      recent > 0 && recentDone === 0
        ? `${recent} queued in 24h and NONE finished — the worker is not running`
        : "enrichment is reaching terminal states",
  });

  // The follow-up dispatcher runs every 5 minutes in-process.
  const overdueSteps = await scalar(sql`
    SELECT count(*) FROM mkt_sequence_items
    WHERE status IN ('pending', 'scheduled')
      AND sent_at IS NULL
      AND scheduled_at < now() - (${THRESHOLDS.sequenceOverdueHours} || ' hours')::interval
  `);
  checks.push({
    name: "sequence_items_not_overdue",
    ok: overdueSteps === 0,
    actual: overdueSteps,
    threshold: 0,
    detail: `${overdueSteps} follow-up step(s) over ${THRESHOLDS.sequenceOverdueHours}h overdue`,
  });

  const staleOutbox = await scalar(sql`
    SELECT count(*) FROM whatsapp_outbox
    WHERE sent_at IS NULL
      AND created_at < now() - (${THRESHOLDS.whatsappOutboxMinutes} || ' minutes')::interval
  `);
  checks.push({
    name: "whatsapp_outbox_draining",
    ok: staleOutbox === 0,
    actual: staleOutbox,
    threshold: 0,
    detail: `${staleOutbox} WhatsApp message(s) unsent for over ${THRESHOLDS.whatsappOutboxMinutes} min`,
  });

  const heartbeatAge = await scalar(sql`
    SELECT COALESCE(
      EXTRACT(EPOCH FROM (now() - max(updated_at))) / 60,
      99999
    ) FROM scraper_heartbeat
  `);
  checks.push({
    name: "scraper_heartbeat_fresh",
    ok: heartbeatAge <= THRESHOLDS.scraperHeartbeatMinutes,
    actual: `${Math.round(heartbeatAge)} min ago`,
    threshold: `${THRESHOLDS.scraperHeartbeatMinutes} min`,
    detail:
      heartbeatAge > THRESHOLDS.scraperHeartbeatMinutes
        ? "the scraper has not checked in — lead ingest may be stopped"
        : "scraper is checking in",
  });

  return { ok: checks.every((check) => check.ok), checks };
}
