-- The work-clock penalty needs EVIDENCE the prompt was displayed.
--
-- People were docked 15 minutes for ignoring a prompt that never appeared: it
-- only renders while the CRM tab is open, and the server could not tell the
-- difference between "ignored it" and "never saw it". Punishing someone for our
-- delivery failure is worse than not enforcing at all.
ALTER TABLE "time_entry_work"
  ADD COLUMN IF NOT EXISTS "prompt_shown_at" timestamp;
