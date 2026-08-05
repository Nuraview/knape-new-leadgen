/**
 * Run every boot-time database migration once, then exit.
 *
 * The VPS deployment gets these for free: startServer() calls runStartupTasks()
 * on every container start. A Vercel Function has no equivalent hook — it is
 * constructed per request — so running migrations there would mean paying for
 * ten DDL round-trips on each cold start and, worse, letting two concurrent
 * cold starts issue the same ALTER at the same time.
 *
 * So the serverless deployment calls this from CI instead, once per release,
 * before the new function goes live:
 *
 *   bun run --filter @nuraview/api db:deploy
 *
 * Point DATABASE_URL at the UNPOOLED connection string when running it. Neon's
 * pooled endpoint runs through pgbouncer in transaction mode, which cannot
 * carry the session-level locks Drizzle's migrator takes.
 *
 * Idempotent by construction — every step underneath is either a Drizzle
 * migration guarded by the journal table or an `IF NOT EXISTS`-style ALTER.
 */
import { runDatabaseMigrations } from "../src/index";

async function main() {
  const target = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).host
    : "(unset — falling back to POSTGRES_* or localhost)";

  console.log(`🚚 Running database migrations against ${target}`);
  await runDatabaseMigrations();
  console.log("✅ Migrations complete");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  });
