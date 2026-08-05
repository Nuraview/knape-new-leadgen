import { sql } from "drizzle-orm";
import crmDb, { isCrmConfigured } from "../database/crm";

/**
 * Columns on crm_Proposals that this codebase declares but an older CRM dump
 * may not have.
 *
 * The CRM database is a SECOND connection and is deliberately outside
 * drizzle-kit's schema path (drizzle.config.ts points at src/database/schema.ts
 * only), so nothing in ./drizzle ever touches these tables. Additive DDL at
 * boot is how the other CRM columns got here — see migrateCrmLeadEmailColumns.
 *
 * source_lead_id records which lead a proposal was drafted from. GET
 * /proposal/:id does `SELECT *`, so a database missing the column would 500 the
 * whole proposal detail rather than merely omit a field.
 */
export async function migrateCrmProposalColumns() {
  if (!isCrmConfigured()) return;

  try {
    await crmDb.execute(sql`
      ALTER TABLE "crm_Proposals"
        ADD COLUMN IF NOT EXISTS "source_lead_id" uuid
    `);

    // Queue for "Draft with AI". See crmProposalAiJobs in crm-schema.ts.
    await crmDb.execute(sql`
      CREATE TABLE IF NOT EXISTS "crm_Proposal_AI_Jobs" (
        "id"          uuid PRIMARY KEY,
        "lead_id"     uuid,
        "proposal_id" uuid,
        "kind"        text NOT NULL,
        "status"      text NOT NULL,
        "error"       text,
        "warnings"    jsonb,
        "meta"        jsonb,
        "created_by"  uuid,
        "created_at"  timestamp NOT NULL DEFAULT now(),
        "updated_at"  timestamp NOT NULL DEFAULT now()
      )
    `);
    await crmDb.execute(sql`
      CREATE INDEX IF NOT EXISTS "crm_proposal_ai_jobs_created_at_idx"
        ON "crm_Proposal_AI_Jobs" ("created_at" DESC)
    `);

    /*
     * Fail anything left mid-flight by a restart.
     *
     * The work runs in this process, so a deploy or a crash abandons it. The
     * row would otherwise stay RUNNING for ever and the browser would poll a
     * job that nobody is working on. Marking it here means the next poll gets
     * a real answer instead of a spinner that never resolves.
     */
    await crmDb.execute(sql`
      UPDATE "crm_Proposal_AI_Jobs"
         SET "status" = 'FAILED',
             "error" = 'The server restarted while this draft was being written. Try again.',
             "updated_at" = now()
       WHERE "status" IN ('PENDING', 'RUNNING')
    `);
  } catch (error) {
    // Never take the API down over this: the CRM database may be a read-only
    // replica or briefly unreachable, and every other domain still works.
    console.warn(
      "[crm] could not ensure proposal columns:",
      (error as Error).message,
    );
  }
}
