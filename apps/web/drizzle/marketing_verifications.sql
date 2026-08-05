-- Reacher email-verification cache. Apply: bun run db:apply:pg drizzle/marketing_verifications.sql
CREATE TABLE IF NOT EXISTS "mkt_email_verifications" (
  "email" varchar(320) PRIMARY KEY,
  "reachable" varchar(10),
  "result" jsonb,
  "checked_at" timestamp DEFAULT now()
);
