import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import pg from "pg";

if (existsSync(".env")) loadEnv({ path: ".env" });
if (existsSync(".env.local")) loadEnv({ path: ".env.local", override: true });

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_URL(_UNPOOLED) in env");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

async function rows(sql, params) {
  const r = await client.query(sql, params);
  return r.rows;
}

const out = {};

out.whatsapp_session_columns = await rows(
  `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
    WHERE table_name = 'whatsapp_session' ORDER BY ordinal_position`,
);

out.whatsapp_session_constraints = await rows(
  `SELECT conname, contype
     FROM pg_constraint
    WHERE conrelid = 'whatsapp_session'::regclass ORDER BY conname`,
);

out.whatsapp_session_rows = await rows(
  `SELECT * FROM whatsapp_session`,
);

out.outbox_has_account = await rows(
  `SELECT column_name FROM information_schema.columns
    WHERE table_name='whatsapp_outbox' AND column_name='account'`,
);

out.leads_has_reminder_account = await rows(
  `SELECT column_name FROM information_schema.columns
    WHERE table_name='crm_Leads' AND column_name='reminder_account'`,
);

// The 3 indexes push proposed to DROP+recreate — check they still exist.
out.indexes = await rows(
  `SELECT indexname FROM pg_indexes
    WHERE indexname IN (
      'crm_Activity_Events_type_created_at_idx',
      'crm_Activity_Events_user_id_created_at_idx',
      'crm_Lead_Views_user_id_viewed_at_idx',
      'whatsapp_outbox_account_pending_idx',
      'whatsapp_outbox_pending_idx'
    ) ORDER BY indexname`,
);

// Is the drizzle migrate journal table present, and what's recorded?
out.drizzle_migrations = await rows(
  `SELECT EXISTS (
     SELECT 1 FROM information_schema.tables
      WHERE table_schema='drizzle' AND table_name='__drizzle_migrations'
   ) AS has_table`,
);

console.log(JSON.stringify(out, null, 2));
await client.end();
