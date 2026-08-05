-- Voluntary employee time tracking (client meeting 2026-07-28).
--
-- One row per clock-in. `ended_at` NULL means the person is still on the clock.
-- Deliberately NOT a screenshot/idle monitor: VK explicitly said WebWork-style
-- surveillance is "maybe in the future", so this records only what somebody
-- chose to start and stop.
--
-- `last_prompt_at` / `prompt_misses` back the 30-minute "Are you working?"
-- check. Someone who stops answering has their entry auto-closed rather than
-- accruing hours overnight, which is the whole point of the prompt.
CREATE TABLE IF NOT EXISTS "time_entry_work" (
  "id"             text PRIMARY KEY NOT NULL,
  "user_id"        text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "started_at"     timestamp NOT NULL DEFAULT now(),
  "ended_at"       timestamp,
  -- How the entry finished: 'manual' (they clocked out), 'prompt_declined'
  -- (they answered No), 'prompt_timeout' (stopped answering), 'auto_midnight'.
  "ended_reason"   text,
  "last_prompt_at" timestamp,
  "prompt_misses"  integer NOT NULL DEFAULT 0,
  "note"           text
);

-- The hot query is "is this person currently clocked in", so index the open
-- rows specifically rather than the whole table.
CREATE INDEX IF NOT EXISTS "time_entry_work_open_idx"
  ON "time_entry_work" ("user_id") WHERE "ended_at" IS NULL;

CREATE INDEX IF NOT EXISTS "time_entry_work_started_idx"
  ON "time_entry_work" ("started_at");
