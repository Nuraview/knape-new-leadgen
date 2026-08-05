import { sql } from "drizzle-orm";
import crmDb, { isCrmConfigured } from "../database/crm";

/**
 * The per-user "opened this lead" log behind the 👁 icon.
 *
 * crmx1 created crm_Lead_Views; the port reads and writes it. Created here if
 * absent for the same reason as the lead email columns: a CRM database without
 * the table would fail every lead list query, and IF NOT EXISTS is a no-op on
 * the database that already has it.
 */
export async function migrateCrmLeadViews() {
  if (!isCrmConfigured()) return;

  try {
    await crmDb.execute(sql`
      CREATE TABLE IF NOT EXISTS "crm_Lead_Views" (
        "lead_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "viewed_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
        CONSTRAINT "crm_Lead_Views_pkey" PRIMARY KEY ("lead_id", "user_id")
      )
    `);
    // Serves "what have I not seen yet" scans; the PK covers the per-lead
    // lookup the list join does.
    await crmDb.execute(sql`
      CREATE INDEX IF NOT EXISTS "crm_Lead_Views_user_id_viewed_at_idx"
        ON "crm_Lead_Views" USING btree ("user_id", "viewed_at" DESC)
    `);
  } catch (error) {
    console.warn(
      "[crm] could not ensure crm_Lead_Views:",
      (error as Error).message,
    );
  }
}
