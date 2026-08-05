-- 2026-07-30 — refund unreachable-prompt penalties, and split VK's overnight zombie.
--
-- WHY THE REFUND. Web push was undeliverable to everyone until 2026-07-29 16:34
-- UTC: the subscribe hook was mounted on a single page (the dialer), and all ten
-- existing subscriptions were bound to a dead VAPID key, so every send returned
-- 403. Mateen, Muadh and Javed still have no subscription at all. The prompt only
-- renders in an open foreground tab, so for anyone who stepped away there was no
-- channel at all — the penalty was a charge for our defect.
--
-- WHY THE SPLIT, and the evidence for the boundaries. From the timestamped pause
-- alerts in whatsapp_outbox for entry bopncz7kg9v3l9wr4jd5gcb8:
--     18:08:32  started (23:38 IST)
--     18:40:00  watchdog paused it   <- last evidence he was at the machine
--     (11h35m with NO pause events: the row sat paused all night)
--     06:15:00  paused again -> under the 25+5 rule the resume was ~05:45
--     06:55:00  paused again
-- Penalties 15 + 25 + 40 = 80 min, matching penalty_seconds = 4800 exactly.
--
-- A Resume click cleared paused_at in place (pre-c4722ad0 behaviour), which
-- retroactively turned the whole night into worked time. Closing at the recorded
-- pause and reopening at the derived resume credits the two segments that really
-- happened and discards the ~11.5 hours he was asleep.

\echo '=== BEFORE ==='
SELECT u.email, w.id, w.started_at, w.ended_at,
       w.prompt_misses AS misses, w.penalty_seconds AS pen, w.ended_reason
  FROM time_entry_work w JOIN "user" u ON u.id = w.user_id
 WHERE w.ended_at IS NULL OR w.started_at > now() - interval '30 hours'
 ORDER BY w.started_at;

BEGIN;

-- Recorded hours are pay data. Never edit them without a copy of the prior state.
CREATE TABLE IF NOT EXISTS time_entry_work_audit_20260730 AS
  SELECT *, now() AS captured_at
    FROM time_entry_work
   WHERE ended_at IS NULL OR started_at > now() - interval '30 hours';

UPDATE time_entry_work
   SET penalty_seconds = 0, prompt_misses = 0
 WHERE (ended_at IS NULL OR started_at > now() - interval '30 hours')
   AND (penalty_seconds > 0 OR prompt_misses > 0);

UPDATE time_entry_work
   SET ended_at = '2026-07-29 18:40:00+00',
       paused_at = NULL,
       ended_reason = 'admin_corrected_overnight_zombie'
 WHERE id = 'bopncz7kg9v3l9wr4jd5gcb8';

INSERT INTO time_entry_work
  (id, user_id, started_at, last_prompt_at, prompt_misses, penalty_seconds)
SELECT 'vkresume20260730a0001', user_id, '2026-07-30 05:45:00+00', now(), 0, 0
  FROM time_entry_work WHERE id = 'bopncz7kg9v3l9wr4jd5gcb8';

COMMIT;

\echo '=== AFTER ==='
SELECT u.email, w.id, w.started_at, w.ended_at,
       w.prompt_misses AS misses, w.penalty_seconds AS pen, w.ended_reason
  FROM time_entry_work w JOIN "user" u ON u.id = w.user_id
 WHERE w.ended_at IS NULL OR w.started_at > now() - interval '30 hours'
 ORDER BY w.started_at;
