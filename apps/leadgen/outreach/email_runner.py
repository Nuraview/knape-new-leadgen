"""Sending engine: send due steps now + a background scheduler for follow-ups."""

from __future__ import annotations

import threading
import time
from typing import Any

from config import OUTREACH_DAILY_SEND_CAP, OUTREACH_SEND_MIN_GAP_SEC
from outreach import email_store
from outreach.email_sender import EmailSendError, send_email

_SCHEDULER_STARTED = False
_LOCK = threading.Lock()
# Serialize all sends across the scheduler thread + request handlers so the
# gap/cap guards are honoured even under concurrent clicks.
_SEND_LOCK = threading.Lock()


class DailyCapReached(RuntimeError):
    pass


def _global_daily_cap() -> int:
    """Global rolling-24h send cap — dashboard setting wins over env/config."""
    try:
        from outreach.app_settings import get_setting

        return int(get_setting("OUTREACH_DAILY_SEND_CAP") or OUTREACH_DAILY_SEND_CAP)
    except Exception:  # noqa: BLE001
        return OUTREACH_DAILY_SEND_CAP


def cap_remaining() -> int:
    """Sends still allowed in the rolling 24h window (large number if disabled)."""
    cap = _global_daily_cap()
    if cap <= 0:
        return 1_000_000
    return max(0, cap - email_store.sends_in_last(86400.0))


def _resolve_inbox(inbox_id: int | None) -> dict | None:
    """Load a specific inbox, or None to use the global-config fallback."""
    if not inbox_id:
        return None
    try:
        from outreach import outreach_store

        return outreach_store.get_inbox(int(inbox_id), include_secrets=True)
    except Exception:  # noqa: BLE001
        return None


def _inbox_cap_reached(inbox: dict | None) -> bool:
    if inbox is None:
        return cap_remaining() <= 0
    used = email_store.sends_in_last_for_inbox(inbox["email"])
    return used >= int(inbox.get("daily_cap") or OUTREACH_DAILY_SEND_CAP or 25)


def send_throttled(*, to_email: str, subject: str, body: str, kind: str, enforce_gap: bool, inbox_id: int | None = None, track_token: str = "", angle: str = "", step_index: int = -1) -> str:
    """Cap- and gap-guarded SMTP send from a specific inbox (or global config).

    Per-inbox daily cap when an inbox is given; otherwise the global rolling cap.
    Raises DailyCapReached / EmailSendError.
    """
    with _SEND_LOCK:
        inbox = _resolve_inbox(inbox_id)
        if _inbox_cap_reached(inbox):
            who = inbox["email"] if inbox else "global"
            raise DailyCapReached(f"Daily send cap reached for {who}. Try again later.")
        if enforce_gap and OUTREACH_SEND_MIN_GAP_SEC > 0:
            last = email_store.last_send_ts()
            if last is not None:
                wait = OUTREACH_SEND_MIN_GAP_SEC - (time.time() - last)
                if wait > 0:
                    time.sleep(min(wait, OUTREACH_SEND_MIN_GAP_SEC))
        mid = send_email(to_email=to_email, subject=subject, body=body, inbox=inbox, track_token=track_token, angle=angle, step_index=step_index)
        email_store.record_send(to_email, kind, inbox_email=inbox["email"] if inbox else None)
        return mid


#: Business hours in US Eastern, inclusive of start, exclusive of end.
#:
#: Sends were going out at 01:00-03:00 Eastern — 144 of them in one week —
#: because the scheduler fires whenever the queue is due and the people running
#: it are nine and a half hours ahead. A cold email from a stranger arriving in
#: a school inbox at 3am is read as spam by the recipient and looks like a bot
#: to their gateway, which is a deliverability problem on top of a wasted send.
#:
#: The window costs nothing in volume: twelve hours at one send per 45s is far
#: more capacity than the daily cap allows.
SEND_WINDOW_START_HOUR = 8
SEND_WINDOW_END_HOUR = 18
SEND_TZ = "America/New_York"


def _setting_int(key: str, default: int) -> int:
    try:
        from outreach.app_settings import get_setting

        return int(get_setting(key) or default)
    except Exception:  # noqa: BLE001
        return default


def send_window() -> tuple[int, int, bool]:
    """(start hour, end hour, weekdays only) in US Eastern."""
    start = _setting_int("OUTREACH_SEND_WINDOW_START", SEND_WINDOW_START_HOUR)
    end = _setting_int("OUTREACH_SEND_WINDOW_END", SEND_WINDOW_END_HOUR)
    try:
        from outreach.app_settings import get_setting

        weekdays = bool(get_setting("OUTREACH_SEND_WEEKDAYS_ONLY"))
    except Exception:  # noqa: BLE001
        weekdays = True
    return start, end, weekdays


def within_send_window(now: float | None = None) -> tuple[bool, str]:
    """Whether cold outreach may go out right now, and why not if not.

    Deliberately does NOT gate the bounce and reply scanners: reading a mailbox
    at 3am bothers nobody. Only outbound is held.
    """
    from datetime import datetime
    from zoneinfo import ZoneInfo

    start, end, weekdays_only = send_window()
    try:
        local = datetime.fromtimestamp(now if now is not None else time.time(), ZoneInfo(SEND_TZ))
    except Exception:  # noqa: BLE001 — never let a tz lookup stop sending entirely
        return True, ""
    if weekdays_only and local.weekday() >= 5:
        return False, f"weekend in US Eastern ({local:%a %H:%M}) — schools are closed"
    if not (start <= local.hour < end):
        return False, (
            f"outside the send window: {local:%H:%M} US Eastern, "
            f"sending runs {start:02d}:00-{end:02d}:00"
        )
    return True, ""


def process_due(limit: int = 50, *, enforce_gap: bool = True) -> dict[str, int]:
    """Send every pending step whose scheduled time has passed, honouring the
    per-send gap and rolling daily cap. Steps left unsent (cap hit) stay pending
    and are retried on the next scheduler tick. Returns counts.

    ``limit`` bounds SENDS, not steps examined. That distinction is the whole
    reason this function stopped working:

    due_steps() is ordered by scheduled_at, and the oldest due steps all belong
    to the mailboxes that have been sending longest — which are therefore the
    first to hit their daily cap. Slicing the queue to `limit` BEFORE the
    exhausted-inbox check meant a tick spent its entire 50-step window skipping
    steps it already knew it could not send, and returned sent=0 while a mailbox
    with 164 of 200 daily sends spare sat untouched further down the list.

    Measured on 4 Aug: all 50 head-of-queue steps belonged to the two 25/day
    mailboxes, both full. 47 due steps for the 200/day mailbox were never
    reached. 86 emails went out where the caps allowed 250.
    """
    # Business hours only. Checked here rather than in the scheduler loop so
    # every path into a send is covered, including the send-approved batch.
    ok, why = within_send_window()
    if not ok:
        return {"sent": 0, "failed": 0, "capped": 0, "held": 1,
                "reason": why, "cap_remaining": cap_remaining()}

    sent = 0
    failed = 0
    capped = 0
    skipped_role = 0
    touched_sequences: set[int] = set()
    # Inboxes that reported their cap during THIS tick. A per-inbox cap is not a
    # reason to stop draining every other inbox, so we skip past their steps
    # instead of abandoning the pass — see the DailyCapReached handler below.
    exhausted: set[Any] = set()
    for step in email_store.due_steps():
        if sent >= limit:
            break
        if step.get("inbox_id") in exhausted:
            capped += 1
            continue

        # A shared mailbox is not a person, and a queued step is not a promise.
        #
        # The role filter rejects info@ and webmaster@ when a sequence is
        # CREATED, but 209 follow-ups were already queued from before it
        # existed and kept firing: webmaster@, enrollment-office@,
        # summerschool@. They bounce or are ignored, they spend the daily cap
        # that real prospects are queuing for, and every one of the fourteen
        # "replies" this system ever recorded came from one. Checked here as
        # well as at enrolment so no amount of old data can reintroduce it.
        try:
            from pipeline.email_validate import _is_role_local

            if _is_role_local((step.get("to_email") or "").split("@")[0].lower()):
                email_store.cancel_step(step["id"], "shared mailbox, not a person")
                skipped_role += 1
                continue
        except Exception:  # noqa: BLE001 — never let the guard stop the queue
            pass

        touched_sequences.add(step["sequence_id"])
        try:
            token = step.get("track_token") or email_store.new_token()
            if not step.get("track_token"):
                email_store.set_step_token(step["id"], token)
            mid = send_throttled(
                to_email=step["to_email"],
                subject=step.get("subject") or f"Following up — {step.get('company') or ''}".strip(),
                body=step.get("body") or "",
                kind="step",
                enforce_gap=enforce_gap,
                inbox_id=step.get("inbox_id"),
                track_token=token,
                angle=str(step.get("angle") or ""),
                step_index=int(step.get("step_index") or 0),
            )
            email_store.mark_step_sent(step["id"], mid)
            sent += 1
        except DailyCapReached:
            # One mailbox being full is not a global stop. This used to `break`,
            # which meant a single capped inbox at the head of the queue — the
            # oldest due step, since due_steps() sorts by scheduled_at — ended
            # the pass before anything else was tried. With three inboxes on
            # separate caps that stalls the whole queue for as long as the
            # capped one stays full: measured 403 steps due and zero sent per
            # tick for three days, because step 1001 sat on a 25/25 mailbox.
            #
            # The global cap still ends the pass, because nothing can send then.
            if step.get("inbox_id") is None or cap_remaining() <= 0:
                capped += 1
                break
            exhausted.add(step.get("inbox_id"))
            capped += 1
            continue  # this step stays pending; try the other inboxes
        except EmailSendError as e:
            email_store.mark_step_failed(step["id"], str(e))
            failed += 1
        except Exception as e:  # noqa: BLE001 - never let one bad step kill the loop
            email_store.mark_step_failed(step["id"], f"{type(e).__name__}: {e}")
            failed += 1
    for sid in touched_sequences:
        email_store.refresh_sequence_status(sid)
    return {"sent": sent, "failed": failed, "capped": capped,
            "skipped_role": skipped_role, "cap_remaining": cap_remaining()}


def start_sequence_send(sequence_id: int, inbox_id: int | None = None) -> dict[str, int]:
    """Mark a draft as sending (schedules all steps relative to now), then send
    the immediately-due first email. Picks a sending inbox (given or rotated) so
    the whole sequence — first email + auto follow-ups — sends from one real
    Mailu inbox. Daily cap still applies; if hit, steps stay pending for the scheduler."""
    try:
        from outreach import outreach_store

        chosen = outreach_store.get_inbox(inbox_id, include_secrets=True) if inbox_id else outreach_store.pick_send_inbox(require_warmed=False)
        if chosen:
            email_store.set_sequence_inbox(sequence_id, chosen["id"], chosen["email"])
    except Exception:  # noqa: BLE001 — fall back to global config inbox
        pass
    email_store.mark_sequence_started(sequence_id)
    return process_due(enforce_gap=False)


def start_approved_sends(sequence_ids: list[int] | None = None) -> dict[str, Any]:
    """Kick off every APPROVED sequence (or just the given ids) as one batch.

    Each sequence gets its sending inbox resolved (kept if already chosen at
    approval time, else rotated) and is marked started, which schedules all its
    steps. The actual SMTP sends then run on a background thread through
    ``process_due`` so the per-send gap + daily caps are honoured without
    blocking the API request; anything cap-deferred is retried by the regular
    scheduler tick."""
    from outreach import outreach_store

    approved = email_store.list_approved()
    if sequence_ids:
        wanted = {int(i) for i in sequence_ids}
        approved = [s for s in approved if int(s["id"]) in wanted]
    started: list[int] = []
    for seq in approved:
        try:
            if not seq.get("inbox_id"):
                chosen = outreach_store.pick_send_inbox(require_warmed=False)
                if chosen:
                    email_store.set_sequence_inbox(seq["id"], chosen["id"], chosen["email"])
        except Exception:  # noqa: BLE001 — fall back to global config inbox
            pass
        email_store.mark_sequence_started(seq["id"])
        started.append(int(seq["id"]))
    if started:
        threading.Thread(
            target=lambda: process_due(limit=500), daemon=True, name="send-approved-batch"
        ).start()
    return {"queued": len(started), "sequence_ids": started, "cap_remaining": cap_remaining()}


def _record_loop_error(key: str, exc: Exception) -> None:
    """Surface a swallowed scheduler-tick failure in the scan heartbeat keys —
    the loop must never die, but silent failure cost us bounce visibility once."""
    try:
        import json

        from outreach.app_settings import set_settings

        set_settings({key: json.dumps({"ts": time.time(), "error": f"{type(exc).__name__}: {exc}"[:300]})})
    except Exception:  # noqa: BLE001
        pass


def _loop(interval_sec: int) -> None:
    # Small initial delay so app startup isn't blocked by a mail round-trip.
    time.sleep(20)
    while True:
        try:
            process_due()
        except Exception:
            pass
        try:
            from outreach.bounce_scan import scan_bounces

            scan_bounces()
        except Exception as e:  # noqa: BLE001
            _record_loop_error("BOUNCE_SCAN_LAST", e)
        # Auto-stop sequences whose prospect replied (cancels pending follow-ups).
        try:
            from outreach.reply_scan import scan_replies

            scan_replies()
        except Exception as e:  # noqa: BLE001
            _record_loop_error("REPLY_SCAN_LAST", e)
        time.sleep(interval_sec)


def ensure_scheduler(interval_sec: int = 300) -> None:
    """Start the background follow-up scheduler once per process."""
    global _SCHEDULER_STARTED
    with _LOCK:
        if _SCHEDULER_STARTED:
            return
        email_store.init_db()
        t = threading.Thread(target=_loop, args=(interval_sec,), daemon=True, name="email-followups")
        t.start()
        _SCHEDULER_STARTED = True
