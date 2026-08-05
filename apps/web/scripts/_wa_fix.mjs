import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import pg from "pg";

if (existsSync(".env")) loadEnv({ path: ".env", quiet: true });
if (existsSync(".env.local")) loadEnv({ path: ".env.local", override: true, quiet: true });

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_URL(_UNPOOLED) in env");
  process.exit(1);
}

// Idempotent recovery from the partially-applied `db:push`. Brings the DB to
// match schema.ts: finishes the whatsapp_session id->account PK swap, ensures
// the new account columns/index exist, and RESTORES the three indexes that
// push dropped but never recreated.
const SQL = `
-- whatsapp_session: id (singleton) -> account-keyed
ALTER TABLE "whatsapp_session" DROP CONSTRAINT IF EXISTS "whatsapp_session_id_check";
ALTER TABLE "whatsapp_session" ADD COLUMN IF NOT EXISTS "account" text NOT NULL DEFAULT 'primary';
ALTER TABLE "whatsapp_session" ADD COLUMN IF NOT EXISTS "label" text;
ALTER TABLE "whatsapp_session" DROP CONSTRAINT IF EXISTS "whatsapp_session_pkey";
ALTER TABLE "whatsapp_session" ADD CONSTRAINT "whatsapp_session_pkey" PRIMARY KEY ("account");
ALTER TABLE "whatsapp_session" DROP COLUMN IF EXISTS "id";

-- whatsapp_outbox: account column (already added by push) + per-account claim index
ALTER TABLE "whatsapp_outbox" ADD COLUMN IF NOT EXISTS "account" text NOT NULL DEFAULT 'primary';
CREATE INDEX IF NOT EXISTS "whatsapp_outbox_account_pending_idx"
  ON "whatsapp_outbox" USING btree ("account","created_at") WHERE status = 'pending';

-- crm_Leads: reminder_account (already added by push)
ALTER TABLE "crm_Leads" ADD COLUMN IF NOT EXISTS "reminder_account" text;

-- Users: whatsapp number column (recipient routing for reminders)
ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "whatsapp" text;

-- Restore indexes push DROPPED but failed to recreate (perf regression fix)
CREATE INDEX IF NOT EXISTS "crm_Activity_Events_type_created_at_idx"
  ON "crm_Activity_Events" USING btree ("type" text_ops,"created_at" timestamp_ops);
CREATE INDEX IF NOT EXISTS "crm_Activity_Events_user_id_created_at_idx"
  ON "crm_Activity_Events" USING btree ("user_id" uuid_ops,"created_at" timestamp_ops);
CREATE INDEX IF NOT EXISTS "crm_Lead_Views_user_id_viewed_at_idx"
  ON "crm_Lead_Views" USING btree ("user_id" uuid_ops,"viewed_at" timestamp_ops);
`;

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(SQL);
  await client.query("COMMIT");
  console.log("✓ corrective migration committed");
} catch (e) {
  await client.query("ROLLBACK");
  console.error("✗ rolled back:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
