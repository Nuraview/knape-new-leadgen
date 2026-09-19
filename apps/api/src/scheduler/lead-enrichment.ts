/**
 * Lead enrichment worker — the last thing that needed Inngest, and therefore
 * the last thing that needed the legacy Next app.
 *
 * Logic ported from apps/web/inngest/functions/enrich-lead.ts. The only real
 * change is the trigger: instead of an Inngest event, this DRAINS THE QUEUE —
 * it picks up PENDING rows in crm_Lead_Enrichment on a timer.
 *
 * That change is worth having on its own merits. The event-driven version lost
 * work silently: events were dropped when INNGEST_* was unset and 220 rows sat
 * PENDING for two days with nothing to retry them, because the only record that
 * work was owed lived in a queue we could not see. A PENDING row IS the work
 * order, so anything not yet done is picked up on the next tick — including
 * whatever was interrupted by a deploy.
 *
 * Rules kept verbatim from the original, because each exists for a reason:
 *   - no company on the lead   -> SKIPPED, not FAILED (nothing to search on)
 *   - auto, enriched < 7 days  -> SKIPPED (manual and deep bypass; the user
 *                                 explicitly clicked and wants fresh results)
 *   - auto, daily budget spent -> SKIPPED (manual and deep bypass; the user
 *                                 owns that spend)
 *   - only EMPTY fields are filled — a reviewer's typed value is never
 *     overwritten by a scraper's guess
 *   - an email lands in the primary slot only when VERIFIED deliverable;
 *     risky and catch-all stay in the audit trace
 *   - the whole run (found values, provider trace, applied fields, warnings) is
 *     written to crm_Lead_Enrichment.result, and the warnings go to `.error` too,
 *     so an empty email column always has a stated reason
 *   - a run that could not start (INSUFFICIENT_INPUT) closes as SKIPPED, not
 *     COMPLETED, so it neither claims work nor blocks the next retry
 */
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import crmDb from "../database/crm";
import { crmLeadEnrichment, crmLeads } from "../database/crm-schema";
import {
  LeadWaterfallStrategy,
  type LeadWaterfallResult,
} from "../enrichment/strategies/lead-waterfall-strategy";
import { sanitizeName } from "../utils/sanitize-name";

const NOT_A_LOCATION = new Set([
  "",
  "Not Found",
  "Not specified",
  "Not available in RSS",
  "Unknown",
]);

function pickLocation(payload: unknown): string | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  for (const key of ["client_location", "location"]) {
    const v = p[key];
    if (typeof v === "string" && !NOT_A_LOCATION.has(v.trim())) return v.trim();
  }
  return null;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_DAILY_BUDGET_USD = 20;

/** Per tick. Small enough that a backlog cannot become a provider bill spike. */
const BATCH = 5;

function dailyBudget(): number {
  const raw = process.env.ENRICHMENT_DAILY_BUDGET_USD;
  const n = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_BUDGET_USD;
}

/**
 * Close an audit row.
 *
 * `result` is the jsonb column the LEGACY Inngest worker filled with the whole
 * trace — found values, every provider response, which fields were applied and
 * the non-fatal errors. The ported worker dropped it, and with it the only
 * place a reviewer could have read WHY a lead came back with no email: the
 * drawer's message box renders `error`, and nothing else was recorded. Restored
 * here, including the legacy habit of parking warnings in `error` — they don't
 * change the status, but they are the explanation.
 */
async function finish(
  id: string,
  status: "COMPLETED" | "SKIPPED" | "FAILED",
  error: string | null,
  costUsd: number,
  result?: object,
) {
  await crmDb
    .update(crmLeadEnrichment)
    .set({
      status,
      error,
      costUsd: String(costUsd),
      updatedAt: new Date(),
      ...(result ? { result } : {}),
    })
    .where(eq(crmLeadEnrichment.id, id));
}

/** Non-fatal warnings for the audit row — null when there are none. */
function warningsOf(result: LeadWaterfallResult): string | null {
  return result.errors.length > 0 ? result.errors.join("; ") : null;
}

/** The jsonb payload the legacy worker wrote, kept in the same shape. */
function traceOf(
  mode: string,
  result: LeadWaterfallResult,
  appliedFields: string[],
) {
  return {
    mode,
    found: result.found,
    trace: result.trace,
    appliedFields,
    errors: result.errors,
  } as unknown as object;
}

export async function processLeadEnrichment() {
  const due = await crmDb
    .select({
      id: crmLeadEnrichment.id,
      leadId: crmLeadEnrichment.leadId,
      mode: crmLeadEnrichment.mode,
    })
    .from(crmLeadEnrichment)
    .where(eq(crmLeadEnrichment.status, "PENDING"))
    .orderBy(crmLeadEnrichment.createdAt)
    .limit(BATCH);

  if (due.length === 0) return;

  for (const run of due) {
    const mode = run.mode ?? "manual";

    // Claim it before doing any work, so two ticks cannot both run the same
    // row if a previous pass is still finishing.
    await crmDb
      .update(crmLeadEnrichment)
      .set({ status: "RUNNING", updatedAt: new Date() })
      .where(
        and(
          eq(crmLeadEnrichment.id, run.id),
          eq(crmLeadEnrichment.status, "PENDING"),
        ),
      );

    try {
      const [lead] = await crmDb
        .select()
        .from(crmLeads)
        .where(and(eq(crmLeads.id, run.leadId), isNull(crmLeads.deletedAt)))
        .limit(1);

      if (!lead) {
        await finish(run.id, "FAILED", "Lead not found", 0);
        continue;
      }
      if (!lead.company?.trim()) {
        await finish(run.id, "SKIPPED", "No company on lead — nothing to enrich", 0);
        continue;
      }

      if (mode === "auto") {
        const [recent] = await crmDb
          .select({ createdAt: crmLeadEnrichment.createdAt })
          .from(crmLeadEnrichment)
          .where(
            and(
              eq(crmLeadEnrichment.leadId, run.leadId),
              eq(crmLeadEnrichment.status, "COMPLETED"),
              gte(crmLeadEnrichment.createdAt, new Date(Date.now() - SEVEN_DAYS_MS)),
            ),
          )
          .orderBy(desc(crmLeadEnrichment.createdAt))
          .limit(1);

        if (recent) {
          await finish(run.id, "SKIPPED", "Enriched within last 7 days", 0);
          continue;
        }

        /*
         * Interpolate the COLUMN, never its name. This was hand-written SQL
         * saying "costUsd", and the physical column is cost_usd — so the budget
         * check threw on every auto run and took the whole enrichment with it.
         * crm-schema.ts already holds the mapping; referencing the column object
         * makes it impossible for the two to disagree again.
         */
        const [spentRow] = await crmDb
          .select({
            total: sql<string>`COALESCE(SUM(${crmLeadEnrichment.costUsd}), 0)::text`,
          })
          .from(crmLeadEnrichment)
          .where(
            gte(
              crmLeadEnrichment.createdAt,
              new Date(Date.now() - 24 * 60 * 60 * 1000),
            ),
          );
        const spent = Number(spentRow?.total ?? 0);
        const cap = dailyBudget();
        if (spent >= cap) {
          await finish(
            run.id,
            "SKIPPED",
            `Daily budget exhausted ($${spent.toFixed(2)} >= $${cap.toFixed(2)})`,
            0,
          );
          continue;
        }
      }

      const result = await new LeadWaterfallStrategy().run(
        {
          company: lead.company,
          jobTitle: lead.jobTitle,
          firstName: lead.firstName,
          lastName: lead.lastName,
          // Not a column — the scraper puts it in source_payload, and the
          // leads view derives it the same way (lead/index.ts:194). The
          // sentinel strings are the scraper's "I could not tell", and passing
          // "Unknown" to a search provider as a country is worse than passing
          // nothing.
          country: pickLocation(lead.sourcePayload),
          existing: {
            email: lead.email,
            phone: lead.phone,
            linkedinUrl: lead.linkedinUrl,
          },
        },
        mode as "auto" | "manual" | "deep",
      );

      /*
       * A run that could never start is NOT a finished enrichment.
       *
       * The strategy returns early with INSUFFICIENT_INPUT when the lead has no
       * usable first+last name (and no email/LinkedIn to work from) — the normal
       * case for our data, because the scraper's Gemini extraction returns
       * "Not Found" whenever the posting does not name the buyer. Recording that
       * as COMPLETED did two harmful things: it claimed work that never happened,
       * and it armed the "enriched within last 7 days" guard above, so the lead
       * was locked out of an automatic retry for a week even after a later
       * re-scrape delivered a name. SKIPPED tells the truth and stays retryable.
       */
      if (result.errors.includes("INSUFFICIENT_INPUT")) {
        await finish(
          run.id,
          "SKIPPED",
          "No usable first/last name to search on — will retry once the scraper delivers one",
          result.costUsd ?? 0,
          traceOf(mode, result, []),
        );
        await crmDb
          .update(crmLeads)
          // enrichedAt is deliberately untouched: we did not enrich anything,
          // and the drawer's "when was this last looked at" must not lie.
          .set({ enrichmentStatus: "SKIPPED", updatedAt: new Date() })
          .where(eq(crmLeads.id, run.leadId));
        console.log(`[enrichment] ${lead.company}: skipped — insufficient input`);
        continue;
      }

      // ONLY empty fields. A reviewer's typed value outranks a scraper's guess.
      const updates: Record<string, string> = {};
      if (!lead.linkedinUrl && result.found.linkedinUrl) {
        updates.linkedinUrl = result.found.linkedinUrl;
      }
      const first = sanitizeName(result.found.firstName);
      const last = sanitizeName(result.found.lastName);
      if (!lead.firstName && first) updates.firstName = first;
      if (!lead.lastName && last) updates.lastName = last;
      if (!lead.email && result.found.email && result.found.emailVerified) {
        updates.email = result.found.email;
      }
      if (mode === "deep" && !lead.phone && result.found.phone) {
        updates.phone = result.found.phone;
      }

      const now = new Date();
      await crmDb
        .update(crmLeads)
        .set({
          ...updates,
          enrichmentStatus: "COMPLETED",
          enrichedAt: now,
          updatedAt: now,
        })
        .where(eq(crmLeads.id, run.leadId));

      // Warnings (unconfigured providers, a found-but-undeliverable address)
      // belong on the audit row — that is where the drawer reads them from.
      await finish(
        run.id,
        "COMPLETED",
        warningsOf(result),
        result.costUsd ?? 0,
        traceOf(mode, result, Object.keys(updates)),
      );
      console.log(
        `[enrichment] ${lead.company}: ${Object.keys(updates).join(", ") || "nothing new"}`,
      );
    } catch (error) {
      // One bad lead must not stop the batch.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[enrichment] ${run.id} failed:`, message);
      await finish(run.id, "FAILED", message.slice(0, 500), 0);
    }
  }
}

export default processLeadEnrichment;
