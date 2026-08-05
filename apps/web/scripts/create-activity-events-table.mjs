/**
 * Idempotent creator for the crm_Activity_Events table (Daily Activity dashboard).
 *
 * Uses the Neon driver directly with CREATE TABLE/INDEX IF NOT EXISTS + guarded
 * FKs, so it only ADDS this one table and never diffs/alters the rest of the
 * schema (unlike `drizzle-kit push`). Safe to re-run. Matches the Drizzle
 * definition in drizzle/schema.ts (export `crmActivityEvents`).
 *
 *   node scripts/create-activity-events-table.mjs        # run from apps/web
 */
import { readFileSync } from "node:fs";
import { Pool } from "pg";

// Minimal .env loader (DDL prefers the unpooled/direct connection).
const fileEnv = {};
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) fileEnv[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
const url =
  process.env.DATABASE_URL_UNPOOLED || fileEnv.DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL || fileEnv.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_URL / DATABASE_URL_UNPOOLED found in env or .env");
  process.exit(1);
}

const TABLE = `
CREATE TABLE IF NOT EXISTS "crm_Activity_Events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "type" text NOT NULL,
  "lead_id" uuid,
  "created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS "crm_Activity_Events_user_id_created_at_idx"
  ON "crm_Activity_Events" USING btree ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "crm_Activity_Events_type_created_at_idx"
  ON "crm_Activity_Events" USING btree ("type", "created_at" DESC);
`;

const FKS = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_Activity_Events_user_id_fkey') THEN
    ALTER TABLE "crm_Activity_Events" ADD CONSTRAINT "crm_Activity_Events_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "Users"("id") ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_Activity_Events_lead_id_fkey') THEN
    ALTER TABLE "crm_Activity_Events" ADD CONSTRAINT "crm_Activity_Events_lead_id_fkey"
      FOREIGN KEY ("lead_id") REFERENCES "crm_Leads"("id") ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;
`;

const pool = new Pool({ connectionString: url });
try {
  await pool.query(TABLE);
  await pool.query(FKS);
  const r = await pool.query(`SELECT to_regclass('"crm_Activity_Events"') AS t`);
  console.log(r.rows[0].t ? `✓ crm_Activity_Events ready (${r.rows[0].t})` : "✗ table missing after run");
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
