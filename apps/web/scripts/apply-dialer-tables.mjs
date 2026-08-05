/**
 * Applies drizzle/dialer_tables.sql to the Neon database (idempotent DDL,
 * out-of-band like marketing_tables.sql — never via drizzle-kit).
 *
 *   node scripts/apply-dialer-tables.mjs        # run from apps/web
 */
import { readFileSync } from "node:fs";
import { Pool } from "pg";

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

const sql = readFileSync(new URL("../drizzle/dialer_tables.sql", import.meta.url), "utf8");

const pool = new Pool({ connectionString: url });
try {
  await pool.query(sql);
  const r = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_name LIKE 'dialer_%' ORDER BY table_name
  `);
  console.log("✓ dialer tables:", r.rows.map((x) => x.table_name).join(", "));
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
