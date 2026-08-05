import { sql } from "drizzle-orm";
import crmDb, { isCrmConfigured } from "../database/crm";

/**
 * The outreach-email columns on crm_Leads.
 *
 * crmx1 created these (generated_email_* when the Email Generator saved a
 * draft, sent_email_* when a lead email went out) and the port declares them in
 * crm-schema.ts. GET /lead/:id does `select()` — the whole row — so a database
 * that predates them 500s the entire lead drawer rather than merely missing a
 * field.
 *
 * ADD COLUMN IF NOT EXISTS on a database that already has them is a no-op, so
 * this is safe to run on every boot and removes the "did the CRM dump include
 * this column?" question entirely.
 */
export async function migrateCrmLeadEmailColumns() {
  if (!isCrmConfigured()) return;

  try {
    await crmDb.execute(sql`
      ALTER TABLE "crm_Leads"
        ADD COLUMN IF NOT EXISTS "generated_email_subject" text,
        ADD COLUMN IF NOT EXISTS "generated_email_body" text,
        ADD COLUMN IF NOT EXISTS "sent_email_subject" text,
        ADD COLUMN IF NOT EXISTS "sent_email_body" text,
        ADD COLUMN IF NOT EXISTS "sent_email_to" text,
        ADD COLUMN IF NOT EXISTS "sent_email_cc" text
    `);
  } catch (error) {
    // Never take the API down over this: the CRM database may be a read-only
    // replica or briefly unreachable, and every other domain still works.
    console.warn(
      "[crm] could not ensure lead email columns:",
      (error as Error).message,
    );
  }
}
