// Corrective action after cleanup-placeholder-names.ts inserted 49
// PENDING audit rows that would have re-fired the enrichment waterfall —
// which is exactly the path that produced the bad data in the first place
// (Gemini-hallucinated firstName + LinkedIn URL of an unrelated person +
// $0.156 wasted on verifying email1@example.com).
//
// What this does:
//   1. Marks recently-inserted PENDING crm_Lead_Enrichment rows as SKIPPED
//      with a reason field so we never auto-fire them.
//   2. Also nulls the chained-bad fields on the corresponding leads:
//      linkedinUrl, email, phone — all of these were inferred from the
//      bad firstName/lastName so they are equally suspect.
//
// Usage:
//   pnpm tsx scripts/cancel-pending-enrich.ts          # dry-run
//   pnpm tsx scripts/cancel-pending-enrich.ts --apply  # write
//
// Only touches rows created in the last 2 hours (the cleanup script ran
// in that window). Safe to re-run.

import { and, eq, gte, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { crmLeadEnrichment, crmLeads } from "@/drizzle/schema";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`[cancel] mode = ${APPLY ? "APPLY" : "dry-run"}`);

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const pending = await db
    .select({ id: crmLeadEnrichment.id, leadId: crmLeadEnrichment.leadId })
    .from(crmLeadEnrichment)
    .where(
      and(
        eq(crmLeadEnrichment.status, "PENDING"),
        gte(crmLeadEnrichment.createdAt, twoHoursAgo),
      ),
    );
  console.log(`[cancel] PENDING audit rows in last 2h: ${pending.length}`);

  if (pending.length === 0) {
    console.log("[cancel] nothing to do.");
    process.exit(0);
  }

  const leadIds = Array.from(new Set(pending.map((p) => p.leadId)));
  const auditIds = pending.map((p) => p.id);

  if (!APPLY) {
    console.log(
      `[cancel] would SKIP ${auditIds.length} audit rows + null chain-bad fields on ${leadIds.length} leads`,
    );
    console.log("[cancel] dry-run complete. Re-run with --apply to write.");
    process.exit(0);
  }

  // Mark audit rows as SKIPPED. enrichmentStatus is an enum — values are
  // PENDING / RUNNING / COMPLETED / FAILED / SKIPPED in the schema.
  await db
    .update(crmLeadEnrichment)
    .set({
      status: "SKIPPED" as const,
      error: "Cancelled after placeholder-name cleanup — re-enrichment paused pending input-gating fix",
      updatedAt: new Date().toISOString(),
    })
    .where(inArray(crmLeadEnrichment.id, auditIds));
  console.log(`[cancel] marked ${auditIds.length} audit rows SKIPPED`);

  // Null the chained-bad fields on the leads. linkedinUrl + email +
  // phone were all derived from the bad firstName/lastName inputs, so
  // they're equally unreliable. enrichmentStatus stays as it was — UI
  // shows the lead can be manually re-enriched if someone wants to.
  await db
    .update(crmLeads)
    .set({
      linkedinUrl: null,
      email: null,
      phone: null,
      updatedAt: new Date().toISOString(),
    })
    .where(inArray(crmLeads.id, leadIds));
  console.log(
    `[cancel] nulled linkedinUrl/email/phone on ${leadIds.length} leads`,
  );
  // Suppress unused-import for sql now that we no longer raw-query.
  void sql;

  console.log("\n[cancel] done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[cancel] FAILED:", err);
  process.exit(1);
});
