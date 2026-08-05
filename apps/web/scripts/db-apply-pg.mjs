// Apply a SQL file to the NV CRM database using the `pg` driver — no Docker.
//   bun run db:apply:pg drizzle/proposals_v2.sql
//
// Reads DATABASE_URL_UNPOOLED (fallback DATABASE_URL) from .env / .env.local
// without sourcing (the Neon URL contains '&'). Runs the whole file in one
// transaction; rolls back on any error.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const root = path.resolve(import.meta.dirname, "..");

function readEnv(name) {
  for (const f of [".env", ".env.local"]) {
    const p = path.join(root, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(new RegExp(`^${name}=(.*)$`));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return "";
}

const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error("usage: bun run db:apply:pg <path-to-sql-file>");
  process.exit(1);
}
const absSql = path.isAbsolute(sqlPath) ? sqlPath : path.join(root, sqlPath);
if (!existsSync(absSql)) {
  console.error(`SQL file not found: ${absSql}`);
  process.exit(1);
}

const url = readEnv("DATABASE_URL_UNPOOLED") || readEnv("DATABASE_URL");
if (!url) {
  console.error("No DATABASE_URL_UNPOOLED / DATABASE_URL in .env or .env.local");
  process.exit(1);
}

const sql = readFileSync(absSql, "utf8");
const client = new pg.Client({
  connectionString: url,
  ssl: /sslmode=require|neon\.tech/.test(url) ? { rejectUnauthorized: false } : undefined,
});

console.log(`Applying ${sqlPath} via pg (single transaction)…`);
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log(`Done: ${sqlPath}`);
} catch (e) {
  try {
    await client.query("ROLLBACK");
  } catch {}
  console.error("FAILED — rolled back:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
