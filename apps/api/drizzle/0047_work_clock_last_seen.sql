-- Server-observed presence for the work clock.
--
-- The penalty depended on the client POSTing /prompt-shown, which anyone could
-- block to become permanently immune. The clock polls GET /work-time/me every
-- 60 seconds, so recording that gives the same evidence without trusting the
-- client: you cannot suppress it without also stopping the polling that makes
-- you look present.
ALTER TABLE "time_entry_work"
  ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp;
