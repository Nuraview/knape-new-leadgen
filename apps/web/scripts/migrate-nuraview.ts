// Idempotent migration for the NuraView lead pipeline.
// - Adds Upwork ingestion columns to crm_Leads.
// - Seeds the 5 Kanban statuses into crm_Lead_Statuses.
// - Ensures a single "Upwork" row in crm_Lead_Sources.
//
// Run once per environment:  pnpm exec tsx scripts/migrate-nuraview.ts

import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

import { db } from "../lib/db";

const ADD_COLUMNS_SQL = sql`
ALTER TABLE "crm_Leads"
  ADD COLUMN IF NOT EXISTS "upwork_job_url"    TEXT,
  ADD COLUMN IF NOT EXISTS "upwork_job_id"     TEXT,
  ADD COLUMN IF NOT EXISTS "extracted_at"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "source_payload"    JSONB,
  ADD COLUMN IF NOT EXISTS "highlighted_at"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "highlighted_by"    UUID,
  ADD COLUMN IF NOT EXISTS "last_contacted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_contacted_by" UUID,
  ADD COLUMN IF NOT EXISTS "reminder_at"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reminder_sent_at"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reminder_note"     TEXT;
`;

const ADD_INDEXES_SQL = sql`
CREATE UNIQUE INDEX IF NOT EXISTS "crm_Leads_upwork_job_url_key"
  ON "crm_Leads" ("upwork_job_url") WHERE "upwork_job_url" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "crm_Leads_extracted_at_idx"
  ON "crm_Leads" ("extracted_at" DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS "crm_Leads_highlighted_at_idx"
  ON "crm_Leads" ("highlighted_at");

CREATE INDEX IF NOT EXISTS "crm_Leads_reminder_due_idx"
  ON "crm_Leads" ("reminder_at") WHERE "reminder_at" IS NOT NULL AND "reminder_sent_at" IS NULL;

CREATE INDEX IF NOT EXISTS "crm_Leads_company_idx"
  ON "crm_Leads" ("company") WHERE "company" IS NOT NULL AND "company" <> '';
`;

const STATUSES = [
  { name: "New", order: 1 },
  { name: "Reviewed", order: 2 },
  { name: "Contacted", order: 3 },
  { name: "Follow-up", order: 4 },
  { name: "Closed", order: 5 },
];

async function seedStatuses() {
  // crm_Lead_Statuses has no "order" column — we encode order via the seed sequence.
  // Kanban columns render in the order they're returned from the DB (ORDER BY name
  // would break Kanban ordering, so the API layer sorts by this hardcoded array).
  for (const { name } of STATUSES) {
    await db.execute(sql`
      INSERT INTO "crm_Lead_Statuses" ("id", "__v", "name")
      VALUES (${randomUUID()}, 0, ${name})
      ON CONFLICT ("name") DO NOTHING
    `);
  }
}

async function seedUpworkSource() {
  const existing: any = await db.execute(
    sql`SELECT "id" FROM "crm_Lead_Sources" WHERE "name" = 'Upwork' LIMIT 1`,
  );
  const rows = Array.isArray(existing) ? existing : (existing?.rows ?? []);
  if (rows.length === 0) {
    await db.execute(sql`
      INSERT INTO "crm_Lead_Sources" ("id", "__v", "name")
      VALUES (${randomUUID()}, 0, 'Upwork')
    `);
  }
}

async function main() {
  console.log("[migrate] Adding Upwork columns to crm_Leads...");
  await db.execute(ADD_COLUMNS_SQL);
  console.log("[migrate] Adding indexes...");
  await db.execute(ADD_INDEXES_SQL);
  console.log("[migrate] Seeding Kanban statuses...");
  await seedStatuses();
  console.log("[migrate] Ensuring Upwork lead source...");
  await seedUpworkSource();
  console.log("[migrate] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[migrate] Failed:", err);
  process.exit(1);
});
