-- Work-clock accountability (client meeting 2026-07-29).
--
-- The 30-minute prompt existed but nothing acted on a missed one: prompt_misses
-- was written 0 and never incremented, and the stale job merely truncated the
-- entry at 65 minutes. VK wants a real consequence — confirm within 5 minutes
-- or lose 15 (a 5-minute grace plus a 10-minute penalty) and have the clock
-- PAUSE until you come back and restart it.
--
-- paused_at is nullable and distinct from ended_at on purpose: a paused entry
-- is still "today's work in progress", whereas an ended one is finished. Rolling
-- a pause into ended_at would make a penalised morning look like a short day.
ALTER TABLE "time_entry_work"
  ADD COLUMN IF NOT EXISTS "paused_at" timestamp,
  ADD COLUMN IF NOT EXISTS "penalty_seconds" integer DEFAULT 0 NOT NULL;

-- Finding the open-but-stale rows is the scheduler's hot path, every 5 minutes.
CREATE INDEX IF NOT EXISTS "time_entry_work_open_idx"
  ON "time_entry_work" ("ended_at", "last_prompt_at");
