// enrichLead — Inngest function for the lead enrichment waterfall.
// Mirrors inngest/functions/enrich-contact.ts but uses Drizzle (matches
// the leads side of the codebase) and runs the cheap waterfall instead
// of the agent strategy.
//
// Triggered by event "enrich/lead.run" with data:
//   { leadId, enrichmentId, mode: "auto"|"manual"|"deep", triggeredBy? }
//
// The audit row is created BEFORE the event is sent (by the API route),
// so the function only flips its status. This matches the contact pattern
// and gives the API a synchronous handle for the UI to poll.

import { and, desc, eq, gte, sql } from "drizzle-orm";

import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";
import {
  crmLeadEnrichment,
  crmLeads,
} from "@/drizzle/schema";
import {
  LeadWaterfallStrategy,
  type LeadWaterfallMode,
} from "@/lib/enrichment/strategies/lead-waterfall-strategy";
import { sanitizeName } from "@/lib/sanitize-name";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Default daily budget cap. Override via env. The check is a SUM over the
// last rolling 24h of crm_Lead_Enrichment.cost_usd — when over, new runs
// SKIP with reason "BUDGET". `manual` and `deep` modes bypass the auto
// budget (the user explicitly clicked, so they own the spend).
const DEFAULT_DAILY_BUDGET_USD = 20;

function getDailyBudget(): number {
  const env = process.env.ENRICHMENT_DAILY_BUDGET_USD;
  if (!env) return DEFAULT_DAILY_BUDGET_USD;
  const n = Number(env);
  return isFinite(n) && n > 0 ? n : DEFAULT_DAILY_BUDGET_USD;
}

export function shouldSkipRecent(lastCompletedAt: Date | null): boolean {
  if (!lastCompletedAt) return false;
  return Date.now() - lastCompletedAt.getTime() < SEVEN_DAYS_MS;
}

interface EventData {
  leadId: string;
  enrichmentId: string;
  mode: LeadWaterfallMode;
  triggeredBy?: string | null;
}

export const enrichLead = inngest.createFunction(
  {
    id: "enrich-lead",
    name: "Enrich Lead",
    triggers: [{ event: "enrich/lead.run" }],
    retries: 2,
  },
  async ({ event }) => {
    const { leadId, enrichmentId, mode } = event.data as EventData;

    // ----------------------------------------------------------------
    // Mark the audit row RUNNING (idempotent: only flips PENDING rows).
    // ----------------------------------------------------------------
    await db
      .update(crmLeadEnrichment)
      .set({
        status: "RUNNING",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(crmLeadEnrichment.id, enrichmentId));

    // ----------------------------------------------------------------
    // Fetch lead + the source-payload-derived country for serper geo bias.
    // ----------------------------------------------------------------
    const clientLocationSql = sql<string | null>`
      COALESCE(
        NULLIF(NULLIF(NULLIF(NULLIF(NULLIF(${crmLeads.sourcePayload}->>'client_location', ''), 'Not Found'), 'Not specified'), 'Not available in RSS'), 'Unknown'),
        NULLIF(NULLIF(NULLIF(NULLIF(NULLIF(${crmLeads.sourcePayload}->>'location', ''), 'Not Found'), 'Not specified'), 'Not available in RSS'), 'Unknown')
      )
    `;
    const [lead] = await db
      .select({
        id: crmLeads.id,
        firstName: crmLeads.firstName,
        lastName: crmLeads.lastName,
        company: crmLeads.company,
        jobTitle: crmLeads.jobTitle,
        email: crmLeads.email,
        phone: crmLeads.phone,
        linkedinUrl: crmLeads.linkedinUrl,
        clientLocation: clientLocationSql,
      })
      .from(crmLeads)
      .where(eq(crmLeads.id, leadId))
      .limit(1);

    if (!lead) {
      await markFailed(enrichmentId, "Lead not found", 0);
      return { skipped: "lead-not-found" };
    }
    if (!lead.company || lead.company.trim() === "") {
      await markSkipped(
        enrichmentId,
        "No company on lead — nothing to enrich",
        0,
      );
      return { skipped: "no-company" };
    }

    // ----------------------------------------------------------------
    // Recent-success dedup. Skip when the same lead was successfully
    // enriched in the last 7 days. Manual + deep bypass — the user is
    // explicitly retrying and presumably wants fresh results.
    // ----------------------------------------------------------------
    if (mode === "auto") {
      const [recent] = await db
        .select({ createdAt: crmLeadEnrichment.createdAt })
        .from(crmLeadEnrichment)
        .where(
          and(
            eq(crmLeadEnrichment.leadId, leadId),
            eq(crmLeadEnrichment.status, "COMPLETED"),
            gte(
              crmLeadEnrichment.createdAt,
              new Date(Date.now() - SEVEN_DAYS_MS).toISOString(),
            ),
          ),
        )
        .orderBy(desc(crmLeadEnrichment.createdAt))
        .limit(1);
      if (
        recent &&
        shouldSkipRecent(new Date(recent.createdAt as unknown as string))
      ) {
        await markSkipped(
          enrichmentId,
          "Enriched within last 7 days",
          0,
        );
        return { skipped: "recently-enriched" };
      }
    }

    // ----------------------------------------------------------------
    // Daily budget guard. Auto only — manual/deep are user-initiated.
    // ----------------------------------------------------------------
    if (mode === "auto") {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [{ totalUsd } = { totalUsd: "0" }] = (await db
        .select({
          totalUsd: sql<string>`COALESCE(SUM(${crmLeadEnrichment.costUsd}), 0)::text`,
        })
        .from(crmLeadEnrichment)
        .where(gte(crmLeadEnrichment.createdAt, since))) as {
        totalUsd: string;
      }[];
      const spent = Number(totalUsd ?? "0");
      const cap = getDailyBudget();
      if (spent >= cap) {
        await markSkipped(
          enrichmentId,
          `Daily budget exhausted ($${spent.toFixed(2)} >= $${cap.toFixed(2)})`,
          0,
        );
        return { skipped: "budget-exhausted", spent, cap };
      }
    }

    // ----------------------------------------------------------------
    // Run the waterfall.
    // ----------------------------------------------------------------
    const strategy = new LeadWaterfallStrategy();
    const wfResult = await strategy.run(
      {
        company: lead.company!,
        jobTitle: lead.jobTitle,
        firstName: lead.firstName,
        lastName: lead.lastName,
        country: lead.clientLocation,
        existing: {
          email: lead.email,
          phone: lead.phone,
          linkedinUrl: lead.linkedinUrl,
        },
      },
      mode,
    );

    // ----------------------------------------------------------------
    // Apply ONLY to empty fields on the lead. We never overwrite a
    // reviewer-entered value — same rule as enrich-contact.ts.
    // ----------------------------------------------------------------
    const updates: Record<string, string> = {};
    if (!lead.linkedinUrl && wfResult.found.linkedinUrl) {
      updates.linkedinUrl = wfResult.found.linkedinUrl;
    }
    // Defense in depth — even if a future extractor slips "Person" /
    // "Unknown" through, sanitizeName drops it before it pollutes the DB.
    const wfFirst = sanitizeName(wfResult.found.firstName);
    const wfLast = sanitizeName(wfResult.found.lastName);
    if (!lead.firstName && wfFirst) {
      updates.firstName = wfFirst;
    }
    if (
      (!lead.lastName || lead.lastName === "") &&
      wfLast
    ) {
      updates.lastName = wfLast;
    }
    // Email goes into the primary slot ONLY when verified deliverable —
    // an "ok" / "good" result. Risky/catch-all stays in the audit trace.
    if (
      !lead.email &&
      wfResult.found.email &&
      wfResult.found.emailVerified
    ) {
      updates.email = wfResult.found.email;
    }
    if (mode === "deep" && !lead.phone && wfResult.found.phone) {
      updates.phone = wfResult.found.phone;
    }

    const nowIso = new Date().toISOString();
    if (Object.keys(updates).length > 0) {
      await db
        .update(crmLeads)
        .set({
          ...updates,
          updatedAt: nowIso,
          enrichmentStatus: "COMPLETED",
          enrichedAt: nowIso,
        })
        .where(eq(crmLeads.id, leadId));
    } else {
      // Even when no fields changed, mark the lead as "we tried" so the
      // auto-trigger gate doesn't re-fire on the same row.
      await db
        .update(crmLeads)
        .set({
          updatedAt: nowIso,
          enrichmentStatus: "COMPLETED",
          enrichedAt: nowIso,
        })
        .where(eq(crmLeads.id, leadId));
    }

    await db
      .update(crmLeadEnrichment)
      .set({
        status: "COMPLETED",
        result: {
          mode,
          found: wfResult.found,
          trace: wfResult.trace,
          appliedFields: Object.keys(updates),
          errors: wfResult.errors,
        } as object,
        costUsd: wfResult.costUsd.toFixed(4),
        updatedAt: nowIso,
        // `error` accumulates non-fatal warnings (e.g. "verify rejected
        // foo@bar.com: invalid"). They don't change the row's COMPLETED
        // status — the enrichment itself ran end-to-end — but they let
        // reviewers see why a slot stayed blank.
        error:
          wfResult.errors.length > 0
            ? wfResult.errors.join("; ")
            : null,
      })
      .where(eq(crmLeadEnrichment.id, enrichmentId));

    return {
      enriched: true,
      fieldsApplied: Object.keys(updates),
      costUsd: wfResult.costUsd,
    };
  },
);

async function markFailed(
  enrichmentId: string,
  error: string,
  costUsd: number,
): Promise<void> {
  await db
    .update(crmLeadEnrichment)
    .set({
      status: "FAILED",
      error,
      costUsd: costUsd.toFixed(4),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(crmLeadEnrichment.id, enrichmentId));
}

async function markSkipped(
  enrichmentId: string,
  error: string,
  costUsd: number,
): Promise<void> {
  await db
    .update(crmLeadEnrichment)
    .set({
      status: "SKIPPED",
      error,
      costUsd: costUsd.toFixed(4),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(crmLeadEnrichment.id, enrichmentId));
}
