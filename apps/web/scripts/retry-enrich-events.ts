// Follow-up to cleanup-placeholder-names.ts when the initial Inngest send
// fails (e.g. INNGEST_EVENT_KEY missing from local env on first run).
//
// Finds every PENDING crm_Lead_Enrichment row created in the last hour and
// re-fires the enrich/lead.run event for it. Idempotent — re-running after
// success is a no-op (the events were already delivered; Inngest dedups by
// id on the function side, but we also re-send to PENDING rows only).
//
// Usage (must have INNGEST_EVENT_KEY + INNGEST_BASE_URL in env):
//   pnpm tsx scripts/retry-enrich-events.ts

import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { crmLeadEnrichment } from "@/drizzle/schema";
import { inngest } from "@/inngest/client";

async function main() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const pending = await db
    .select({ id: crmLeadEnrichment.id, leadId: crmLeadEnrichment.leadId })
    .from(crmLeadEnrichment)
    .where(
      and(
        eq(crmLeadEnrichment.status, "PENDING"),
        gte(crmLeadEnrichment.createdAt, oneHourAgo),
      ),
    );
  console.log(`[retry] found ${pending.length} PENDING rows in last hour`);
  if (pending.length === 0) {
    process.exit(0);
  }

  const CHUNK = 100;
  let sent = 0;
  for (let i = 0; i < pending.length; i += CHUNK) {
    const slice = pending.slice(i, i + CHUNK);
    await inngest.send(
      slice.map((r) => ({
        name: "enrich/lead.run",
        data: { leadId: r.leadId, enrichmentId: r.id, mode: "auto" as const },
      })),
    );
    sent += slice.length;
    console.log(`[retry] sent ${sent}/${pending.length}`);
  }
  console.log("[retry] done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[retry] FAILED:", err);
  process.exit(1);
});
