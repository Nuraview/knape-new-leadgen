-- Client meeting 2026-07-29 (second call).
--
-- 1. A per-user pinned task. VK, about Mateen: "I just want to put one task,
--    one task alone, which needs to be pre-selected — lead generation."
--    user_access is already the 1:1 per-user config table (userId is its PK),
--    so this belongs there rather than in a new table.
ALTER TABLE "user_access"
  ADD COLUMN IF NOT EXISTS "pinned_task_id" text;

-- 2. Admin-entered time. "If somebody credible says I've worked, I forgot to
--    add it, I should be able to add manually."
--    Recording WHO entered a slot matters more here than anywhere else in the
--    schema: these rows are payroll evidence that somebody typed by hand, and
--    an unattributed manual entry is indistinguishable from a tracked one.
ALTER TABLE "time_entry_work"
  ADD COLUMN IF NOT EXISTS "created_by" text,
  ADD COLUMN IF NOT EXISTS "is_manual" boolean DEFAULT false NOT NULL;
