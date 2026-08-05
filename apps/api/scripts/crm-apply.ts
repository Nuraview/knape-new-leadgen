/**
 * Applies plain SQL files to the CRM database.
 *
 * The CRM schema is introspected from a live database rather than owned by
 * Drizzle migrations (see src/database/crm-schema.ts), so new CRM tables cannot
 * ride the apps/api migration journal — running `db:deploy` against this
 * database would try to create the app schema in it.
 *
 * Every file here is written IF NOT EXISTS, so re-running is a no-op.
 *
 *   bun run --filter @nuraview/api db:crm-apply
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv-mono";
import pg from "pg";

// Same loader drizzle.config.ts uses. Without it this script only ever saw
// CRM_DATABASE_URL when it happened to be exported into the shell, and failed
// with "not set" when run the way its own docstring says to run it.
config();

const FILES = ["nv_orders.sql", "nv_linkedin.sql"];

async function main() {
  const url = process.env.CRM_DATABASE_URL?.trim();
  if (!url) throw new Error("CRM_DATABASE_URL is not set");

  const here = dirname(fileURLToPath(import.meta.url));
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  console.log(`🗄️  CRM database ${new URL(url).host}`);

  for (const file of FILES) {
    const sql = readFileSync(join(here, "..", "drizzle", file), "utf8");
    await client.query(sql);
    console.log(`  applied ${file}`);
  }

  await client.end();
  console.log("✅ CRM SQL applied");
}

main().catch((error) => {
  console.error("❌", error);
  process.exit(1);
});
