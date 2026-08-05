-- Per-sequence sender identity for follow-ups (which email/provider to send as).
-- Apply:  bun run db:apply drizzle/marketing_sender_id.sql   (additive, idempotent)
ALTER TABLE "mkt_sequences" ADD COLUMN IF NOT EXISTS "sender_id" varchar(120);
