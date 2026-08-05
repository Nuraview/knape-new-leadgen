-- 2026-07-30 (second refund) — reverse penalties for prompts that never rendered.
--
-- CRITERION: prompt_shown_at IS NULL on the penalised row. That is the server's
-- own record that the client never reported drawing a prompt, so the person was
-- charged for ignoring something that was never put in front of them.
--
-- Deliberately NOT a blanket refund. 10 of 61 rows do carry a prompt_shown_at, so
-- the prompt does fire sometimes; a penalty on one of those rows may be entirely
-- fair and is left alone.
--
-- ROOT CAUSE, for whoever reads this later: the client scheduled the prompt with
-- setInterval(25 min) anchored to component mount and never consulted the server's
-- lastPromptAt. Deploy-triggered auto-reload restarted that countdown on every
-- deploy (ten on this day), so it rarely survived to fire — while the server's
-- 30-minute deadline kept running. The penalty was then gated on lastSeenAt, which
-- proves only that the tab was open, not that anything was displayed. Both are
-- fixed in cb6f70ed; this repairs the money.

\echo '=== BEFORE ==='
SELECT u.email, w.id, w.started_at, w.prompt_shown_at,
       w.penalty_seconds AS pen, w.prompt_misses AS misses
  FROM time_entry_work w JOIN "user" u ON u.id = w.user_id
 WHERE w.penalty_seconds > 0 OR w.prompt_misses > 0
 ORDER BY w.started_at;

BEGIN;

CREATE TABLE IF NOT EXISTS time_entry_work_audit_20260730b AS
  SELECT *, now() AS captured_at
    FROM time_entry_work
   WHERE penalty_seconds > 0 OR prompt_misses > 0;

UPDATE time_entry_work
   SET penalty_seconds = 0, prompt_misses = 0
 WHERE prompt_shown_at IS NULL
   AND (penalty_seconds > 0 OR prompt_misses > 0);

COMMIT;

\echo '=== AFTER (any row still holding a penalty had a REAL displayed prompt) ==='
SELECT u.email, w.id, w.started_at, w.prompt_shown_at,
       w.penalty_seconds AS pen, w.prompt_misses AS misses
  FROM time_entry_work w JOIN "user" u ON u.id = w.user_id
 WHERE w.penalty_seconds > 0 OR w.prompt_misses > 0
 ORDER BY w.started_at;

\echo '=== per-person totals now ==='
SELECT u.email, sum(w.penalty_seconds)/60 AS minutes_still_docked
  FROM time_entry_work w JOIN "user" u ON u.id = w.user_id
 GROUP BY 1 HAVING sum(w.penalty_seconds) > 0 ORDER BY 2 DESC;
