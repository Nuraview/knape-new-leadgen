// One-shot cleanup for leads/targets whose firstName or lastName landed
// in the DB as garbage placeholders ("Person", "Unknown", "Client", etc.)
// — almost always Gemini hallucinations from earlier scraper runs.
//
// What this does:
//   1. Selects crm_Leads + crm_Targets rows where firstName or lastName
//      matches the placeholder reject list.
//   2. Nulls those columns (or "" for NOT NULL columns) so the enrichment
//      pipeline treats them as empty next pass.
//   3. For each cleaned crm_Leads row, queues an Inngest enrichLead event
//      (with a fresh crm_Lead_Enrichment audit row) so the waterfall gets
//      another shot at the real value.
//
// Usage:
//   pnpm tsx scripts/cleanup-placeholder-names.ts          # dry-run
//   pnpm tsx scripts/cleanup-placeholder-names.ts --apply  # actually write
//
// Idempotent: re-running after --apply is a no-op (placeholders are gone).
//
// IMPORTANT — env: this script needs DATABASE_URL + Inngest config. Source
// from apps/web/.env (or the running prod env). The script never sends
// events if --apply is NOT passed.

import { or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import {
  crmLeads,
  crmTargets,
  crmLeadEnrichment,
} from "@/drizzle/schema";
import { inngest } from "@/inngest/client";
import { placeholderTokens } from "@/lib/sanitize-name";

const APPLY = process.argv.includes("--apply");

// Build a lowercase array for SQL — case-insensitive match.
// Inline as a SQL ARRAY[...] literal (avoids parameter-array casting
// quirks with neon-serverless's prepared-statement encoder).
const TOKENS_LOWER = placeholderTokens().map((t) => t.toLowerCase());
const TOKENS_SQL = sql.raw(
  `ARRAY[${TOKENS_LOWER.map((t) => `'${t.replace(/'/g, "''")}'`).join(",")}]::text[]`,
);

type BadLead = { id: string; firstName: string | null; lastName: string };
type BadTarget = { id: string; firstName: string | null; lastName: string };

async function main() {
  console.log(
    `[cleanup] mode = ${APPLY ? "APPLY (writes will happen)" : "dry-run"}`,
  );
  console.log(`[cleanup] ${TOKENS_LOWER.length} placeholder tokens active`);

  // --- crm_Leads ---
  // Match on lower(trim(value)) so "Person", " person ", "PERSON" all hit.
  const badLeads = (await db
    .select({
      id: crmLeads.id,
      firstName: crmLeads.firstName,
      lastName: crmLeads.lastName,
    })
    .from(crmLeads)
    .where(
      or(
        sql`lower(trim(${crmLeads.firstName})) = ANY(${TOKENS_SQL})`,
        sql`lower(trim(${crmLeads.lastName})) = ANY(${TOKENS_SQL})`,
      ),
    )) as BadLead[];

  console.log(`[cleanup] crm_Leads with bad name(s): ${badLeads.length}`);
  if (badLeads.length > 0) {
    const sample = badLeads.slice(0, 5);
    for (const l of sample) {
      console.log(
        `  - ${l.id}: firstName=${JSON.stringify(l.firstName)}, lastName=${JSON.stringify(l.lastName)}`,
      );
    }
    if (badLeads.length > 5)
      console.log(`  ... +${badLeads.length - 5} more`);
  }

  // --- crm_Targets ---
  const badTargets = (await db
    .select({
      id: crmTargets.id,
      firstName: crmTargets.firstName,
      lastName: crmTargets.lastName,
    })
    .from(crmTargets)
    .where(
      or(
        sql`lower(trim(${crmTargets.firstName})) = ANY(${TOKENS_SQL})`,
        sql`lower(trim(${crmTargets.lastName})) = ANY(${TOKENS_SQL})`,
      ),
    )) as BadTarget[];

  console.log(`[cleanup] crm_Targets with bad name(s): ${badTargets.length}`);
  if (badTargets.length > 0) {
    const sample = badTargets.slice(0, 5);
    for (const t of sample) {
      console.log(
        `  - ${t.id}: firstName=${JSON.stringify(t.firstName)}, lastName=${JSON.stringify(t.lastName)}`,
      );
    }
    if (badTargets.length > 5)
      console.log(`  ... +${badTargets.length - 5} more`);
  }

  if (!APPLY) {
    console.log("\n[cleanup] dry-run complete. Re-run with --apply to write.");
    process.exit(0);
  }

  // --- write phase ---

  // crm_Leads.firstName is nullable; lastName is NOT NULL → use "".
  if (badLeads.length > 0) {
    await db.execute(sql`
      UPDATE "crm_Leads"
      SET
        "firstName" = CASE
          WHEN lower(trim("firstName")) = ANY(${TOKENS_SQL}) THEN NULL
          ELSE "firstName"
        END,
        "lastName" = CASE
          WHEN lower(trim("lastName")) = ANY(${TOKENS_SQL}) THEN ''
          ELSE "lastName"
        END,
        "updatedAt" = NOW()
      WHERE
        lower(trim("firstName")) = ANY(${TOKENS_SQL})
        OR lower(trim("lastName")) = ANY(${TOKENS_SQL})
    `);
    console.log(`[cleanup] crm_Leads update issued (${badLeads.length} rows)`);

    // Queue re-enrichment for each cleaned lead. Mirror the pattern from
    // app/api/ingest/upwork/route.ts: insert audit rows first, then send
    // events keyed to those audit ids.
    const nowIso = new Date().toISOString();
    const auditRows = badLeads.map((l) => ({
      id: randomUUID(),
      leadId: l.id,
      status: "PENDING" as const,
      mode: "auto",
      fields: ["firstName", "lastName"],
      updatedAt: nowIso,
    }));

    // Insert in chunks to keep the row count per statement reasonable.
    const CHUNK = 200;
    for (let i = 0; i < auditRows.length; i += CHUNK) {
      const slice = auditRows.slice(i, i + CHUNK);
      await db.insert(crmLeadEnrichment).values(slice);
    }
    console.log(
      `[cleanup] inserted ${auditRows.length} crm_Lead_Enrichment audit rows`,
    );

    // Send events in chunks of 100 (Inngest batch limit is generous; this
    // is conservative to avoid huge HTTP payloads).
    const EVT_CHUNK = 100;
    for (let i = 0; i < auditRows.length; i += EVT_CHUNK) {
      const slice = auditRows.slice(i, i + EVT_CHUNK);
      await inngest.send(
        slice.map((r) => ({
          name: "enrich/lead.run",
          data: { leadId: r.leadId, enrichmentId: r.id, mode: "auto" as const },
        })),
      );
    }
    console.log(
      `[cleanup] queued ${auditRows.length} enrich/lead.run events`,
    );
  }

  // crm_Targets.first_name is nullable; last_name is NOT NULL → use "".
  if (badTargets.length > 0) {
    await db.execute(sql`
      UPDATE "crm_Targets"
      SET
        "first_name" = CASE
          WHEN lower(trim("first_name")) = ANY(${TOKENS_SQL}) THEN NULL
          ELSE "first_name"
        END,
        "last_name" = CASE
          WHEN lower(trim("last_name")) = ANY(${TOKENS_SQL}) THEN ''
          ELSE "last_name"
        END,
        "updatedAt" = NOW()
      WHERE
        lower(trim("first_name")) = ANY(${TOKENS_SQL})
        OR lower(trim("last_name")) = ANY(${TOKENS_SQL})
    `);
    console.log(
      `[cleanup] crm_Targets update issued (${badTargets.length} rows)`,
    );
    // No automatic re-enrich for targets — the target enrichment flow is
    // driven by user action ("Enrich" button) and consumes more credits.
    // Reviewers can re-run it manually for now.
  }

  console.log("\n[cleanup] done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[cleanup] FAILED:", err);
  process.exit(1);
});
