-- What the clock was running ON, not just that it was running.
--
-- The work clock answers "how long" but not "on what". VK: "what about
-- tracking the task and everything, this is just simple check in checkout."
--
-- Kaneo already ships a per-task `time_entry` table with a full CRUD API and
-- SPA fetchers/hooks — and not one component ever used it. Rather than build a
-- second, parallel timer, the work clock now drives it: picking a task on the
-- clock opens a time_entry, switching closes the old one and opens the next,
-- stopping the clock closes both.
--
-- `current_task_id` is the open task for a running work session. Nullable on
-- purpose: clocking in without naming a task stays valid. The point is to make
-- attribution possible, not mandatory — a timer you cannot start without
-- filling in a form is a timer people stop starting.
ALTER TABLE "time_entry_work"
  ADD COLUMN IF NOT EXISTS "current_task_id" text
  REFERENCES "task"("id") ON DELETE SET NULL;

-- Rollups are "this person, this day, grouped by task", so the useful index is
-- on the entry's owner and start.
CREATE INDEX IF NOT EXISTS "time_entry_user_start_idx"
  ON "time_entry" ("user_id", "start_time");
