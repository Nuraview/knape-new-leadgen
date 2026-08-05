-- A/B email-provider attribution for marketing emails.
-- Marketing tables are managed outside drizzle-kit (see marketing_tables.sql),
-- so apply this by hand:  psql "$DATABASE_URL_UNPOOLED" -f drizzle/marketing_provider_ab.sql
-- Additive + idempotent — safe to re-run.

ALTER TABLE "mkt_emails" ADD COLUMN IF NOT EXISTS "provider" varchar(20);
ALTER TABLE "mkt_emails" ADD COLUMN IF NOT EXISTS "provider_message_id" varchar(255);
CREATE INDEX IF NOT EXISTS "mkt_provider_idx" ON "mkt_emails" ("provider");

-- Backfill: existing rows that were sent carried a Resend id.
UPDATE "mkt_emails" SET "provider" = 'resend'
  WHERE "provider" IS NULL AND "resend_id" IS NOT NULL;
