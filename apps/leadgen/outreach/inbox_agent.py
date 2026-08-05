"""Read the inbox and act on it, without being asked.

Robin Huston's mailbox at the University of Oklahoma answered one of Dan's
emails with: back on Monday 10 August, no email access, contact Laney Bailey at
laneyb@ou.edu in the meantime. Everything needed to do the right thing was in
that message — defer the follow-ups past the 10th, and write to the colleague
the university itself volunteered. Nothing happened. It sat in a webmail list
next to seven bounce notices waiting for a human to read it.

That is what this is for. Every few minutes it reads what arrived, works out
what each message is, and does the obvious thing:

    bounce            suppress the address, stop the sequence
    out-of-office     defer follow-ups past the return date, and record the
                      colleague named in the message as a new contact
    real reply        stop the follow-ups and raise it — a human is waiting
    unsubscribe       suppress permanently, stop everything

DESIGN

Rules first, model second. Bounces and out-of-office notices announce
themselves in headers and subject lines, and a regex is free, instant and
cannot hallucinate. The model is used for the one job rules are bad at:
reading prose to extract a return date and a colleague's address, and telling a
genuine human reply from an automated one when the headers are silent. That
keeps the spend proportional to the ambiguity rather than the volume.

Nothing here sends email. It defers, suppresses, records and raises. Every
action is reversible from the dashboard, and the one irreversible-feeling
action — writing to somebody new — is left as a queued draft for a person to
approve, because an agent that starts conversations on its own behalf is a
different and much riskier product than one that keeps the calendar straight.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import config  # noqa: F401 — imported for its dotenv side effect
from outreach import db, email_store, imap_inbox
from utils import pipeline_events

DEEPSEEK_BASE = "https://api.deepseek.com"
MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")

# Bounded so one pass cannot run away with the API budget or the IMAP session.
MAX_MESSAGES = int(os.getenv("INBOX_AGENT_MAX", "40"))
MAX_MODEL_CALLS = int(os.getenv("INBOX_AGENT_MAX_MODEL_CALLS", "12"))


def _init() -> None:
    """Remember what has been handled, so a rerun is a no-op."""
    c = db.connect()
    try:
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS inbox_agent_seen (
                message_id TEXT PRIMARY KEY,
                kind TEXT,
                action TEXT,
                handled_at DOUBLE PRECISION NOT NULL
            )
            """
        )
        c.commit()
    finally:
        c.close()


def _seen(message_id: str) -> bool:
    c = db.connect()
    try:
        return bool(
            c.execute(
                "SELECT 1 FROM inbox_agent_seen WHERE message_id = ? LIMIT 1",
                (str(message_id),),
            ).fetchone()
        )
    finally:
        c.close()


def _mark(message_id: str, kind: str, action: str) -> None:
    c = db.connect()
    try:
        c.execute(
            "INSERT INTO inbox_agent_seen (message_id, kind, action, handled_at) "
            "VALUES (?,?,?,?) ON CONFLICT (message_id) DO UPDATE SET "
            "kind=EXCLUDED.kind, action=EXCLUDED.action, handled_at=EXCLUDED.handled_at",
            (str(message_id), kind, action, time.time()),
        )
        c.commit()
    finally:
        c.close()


# --------------------------------------------------------------- classify --

_BOUNCE_FROM = ("mailer-daemon", "postmaster", "double-bounce")
_BOUNCE_SUBJECT = (
    "undelivered mail", "delivery status notification", "returned to sender",
    "delayed mail", "delivery failure", "failure notice", "mail delivery failed",
)
_OOO_SUBJECT = (
    "automatic reply", "auto-reply", "autoreply", "out of office",
    "out-of-office", "away from the office", "on annual leave", "on vacation",
)
_UNSUB_SUBJECT = ("unsubscribe", "remove me", "opt out", "opt-out")


def classify(msg: dict[str, Any]) -> str:
    """bounce | ooo | unsubscribe | maybe_reply — from headers and subject alone."""
    frm = str(msg.get("from_email") or "").lower()
    subject = str(msg.get("subject") or "").lower()

    if any(frm.startswith(p) for p in _BOUNCE_FROM):
        return "bounce"
    if any(m in subject for m in _BOUNCE_SUBJECT):
        return "bounce"
    if any(m in subject for m in _OOO_SUBJECT):
        return "ooo"
    if any(m in subject for m in _UNSUB_SUBJECT):
        return "unsubscribe"
    return "maybe_reply"


# ------------------------------------------------------------------ model --

_SCHEMA_HINT = """Return ONLY compact JSON, no prose, with these keys:
{"kind":"out_of_office|human_reply|auto_other|unsubscribe",
 "return_date":"YYYY-MM-DD or null",
 "alternate_email":"an email address named as a contact while away, or null",
 "alternate_name":"that person's name, or null",
 "interested":"yes|no|unclear",
 "summary":"one short sentence"}"""


def _output_text(data: dict[str, Any]) -> str:
    """Pull the assistant text out of a Responses API payload.

    `output_text` is a convenience property of the OpenAI SDK, not a field the
    API returns — reading it gave None every time, so every message came back
    unclassified and the agent silently did nothing. The real text is nested:

        output[] -> {type: "message"} -> content[] -> {type: "output_text"} -> text

    and the first output item is usually {type: "reasoning"}, which must be
    skipped rather than concatenated.
    """
    parts: list[str] = []
    for item in data.get("output") or []:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for chunk in item.get("content") or []:
            if isinstance(chunk, dict) and chunk.get("type") == "output_text":
                parts.append(str(chunk.get("text") or ""))
    return "".join(parts).strip()


def _ask_model(subject: str, body: str) -> dict[str, Any] | None:
    """Read one message. Returns None when the model is unavailable.

    Unavailable must degrade to "leave it alone", never to a guess: a wrong
    classification here silently stops a real prospect's follow-ups.
    """
    key = (os.getenv("DEEPSEEK_API_KEY") or "").strip()
    if not key:
        return None
    try:
        import urllib.request

        payload = json.dumps(
            {
                "model": MODEL,
                "instructions": (
                    "You triage replies to a B2B cold outreach campaign. "
                    + _SCHEMA_HINT
                ),
                "input": f"Subject: {subject}\n\n{body[:3000]}",
                "temperature": 0,
                "max_output_tokens": 300,
            }
        ).encode()
        req = urllib.request.Request(
            f"{DEEPSEEK_BASE}/responses",
            data=payload,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=45) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
        text = _output_text(data)
        match = re.search(r"\{.*\}", text, re.S)
        return json.loads(match.group(0)) if match else None
    except Exception as e:  # noqa: BLE001 — triage must never break the scheduler
        print(f"  inbox-agent: model call failed ({type(e).__name__})")
        return None


def _parse_date(raw: Any) -> float | None:
    try:
        d = datetime.strptime(str(raw)[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None
    # Land the morning AFTER they are back — arriving in the first-day backlog
    # is how a good lead gets archived unread.
    return (d + timedelta(days=1)).timestamp()


# ------------------------------------------------------------------- act ---


def _handle_ooo(msg: dict[str, Any], seq: dict[str, Any], parsed: dict[str, Any]) -> str:
    actions: list[str] = []

    until = _parse_date(parsed.get("return_date"))
    if until and until > time.time():
        moved = email_store.defer_followups(int(seq["id"]), until)
        if moved:
            back = datetime.fromtimestamp(until, timezone.utc).strftime("%d %b")
            actions.append(f"deferred {moved} follow-up(s) to {back}")

    alt = str(parsed.get("alternate_email") or "").strip().lower()
    if "@" in alt and alt != str(seq.get("to_email") or "").lower():
        account_id = seq.get("account_id")
        if account_id and email_store.add_contact_if_new(
            account_id=int(account_id),
            email=alt,
            person_name=str(parsed.get("alternate_name") or "").strip(),
        ):
            actions.append(f"added {alt} as a new contact")

    return "; ".join(actions) or "no action needed"


def run(limit: int = MAX_MESSAGES) -> dict[str, Any]:
    """One triage pass. Safe to run on a timer and safe to run twice."""
    _init()
    if not imap_inbox.imap_configured():
        return {"ok": False, "reason": "imap_not_configured"}

    try:
        listing = imap_inbox.list_messages(limit=limit)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "reason": f"{type(e).__name__}: {e}"[:160]}

    counts = {"bounce": 0, "ooo": 0, "reply": 0, "unsubscribe": 0, "skipped": 0}
    notes: list[str] = []
    model_calls = 0

    for msg in listing.get("items") or []:
        mid = str(msg.get("id") or "")
        if not mid or _seen(mid):
            continue

        kind = classify(msg)
        sender = str(msg.get("from_email") or "").lower()
        seq = email_store.sequence_by_recipient(sender)

        # Bounces already have an owner: bounce_scan writes the suppression and
        # the alternate-contact requeue. Recording it here just stops the agent
        # looking at it again.
        if kind == "bounce":
            counts["bounce"] += 1
            _mark(mid, kind, "left to bounce_scan")
            continue

        if not seq:
            counts["skipped"] += 1
            _mark(mid, kind, "no matching campaign")
            continue

        if kind == "unsubscribe":
            email_store.stop_followups(int(seq["id"]))
            counts["unsubscribe"] += 1
            _mark(mid, kind, "stopped follow-ups")
            notes.append(f"{sender} asked to stop — follow-ups cancelled")
            continue

        # Everything left needs the message read: an out-of-office to mine for a
        # date and a colleague, or an ambiguous one to tell human from machine.
        parsed = None
        if model_calls < MAX_MODEL_CALLS:
            body = ""
            try:
                full = imap_inbox.get_message(message_id=mid)
                body = str(full.get("body") or full.get("text") or "")
            except Exception:  # noqa: BLE001
                body = ""
            parsed = _ask_model(str(msg.get("subject") or ""), body)
            model_calls += 1

        if not parsed:
            counts["skipped"] += 1
            # Deliberately NOT marked seen: unread beats wrongly handled, so the
            # next pass tries again once the model is reachable.
            continue

        model_kind = str(parsed.get("kind") or "")

        if model_kind == "out_of_office" or kind == "ooo":
            action = _handle_ooo(msg, seq, parsed)
            counts["ooo"] += 1
            _mark(mid, "ooo", action)
            if action != "no action needed":
                notes.append(f"{seq.get('company') or sender}: {action}")
            continue

        if model_kind == "unsubscribe":
            email_store.stop_followups(int(seq["id"]))
            counts["unsubscribe"] += 1
            _mark(mid, "unsubscribe", "stopped follow-ups")
            notes.append(f"{sender} asked to stop — follow-ups cancelled")
            continue

        if model_kind == "human_reply":
            email_store.mark_replied(int(seq["id"]))
            counts["reply"] += 1
            _mark(mid, "reply", "follow-ups stopped, raised for a human")
            notes.append(
                f"REPLY from {seq.get('company') or sender}: "
                f"{parsed.get('summary') or 'a person wrote back'}"
            )
            continue

        counts["skipped"] += 1
        _mark(mid, model_kind or "auto_other", "no action")

    summary = (
        f"Inbox: {counts['reply']} repl(y/ies), {counts['ooo']} out-of-office, "
        f"{counts['unsubscribe']} opt-out, {counts['bounce']} bounce(s)."
    )
    pipeline_events.emit(
        "inbox",
        summary,
        level="success" if counts["reply"] else "info",
    )
    for n in notes[:10]:
        pipeline_events.emit("inbox", n, level="success" if n.startswith("REPLY") else "info")

    return {"ok": True, "counts": counts, "notes": notes, "model_calls": model_calls}


# ------------------------------------------------------------- scheduler ---

_LOCK = threading.Lock()
_STARTED = False


def _loop(interval_sec: int) -> None:
    while True:
        try:
            run()
        except Exception as e:  # noqa: BLE001 — a bad pass must not end the loop
            print(f"  inbox-agent: pass failed ({type(e).__name__}: {e})", flush=True)
        time.sleep(max(60, interval_sec))


def ensure_scheduler(interval_sec: int = 600) -> None:
    """Start inbox triage once per process.

    Ten minutes rather than five: IMAP sessions are not free, and an
    out-of-office acted on ten minutes late costs nothing. The follow-up
    scheduler runs at five, so the two passes interleave instead of competing
    for the same mailbox.
    """
    global _STARTED
    with _LOCK:
        if _STARTED:
            return
        threading.Thread(
            target=_loop, args=(interval_sec,), daemon=True, name="inbox-agent"
        ).start()
        _STARTED = True


# ------------------------------------------------------------ categorise ---

# Internal verdicts collapse to four things a person cares about. "maybe_reply"
# and "auto_other" both mean "not obviously machinery", which on this mailbox is
# either a real human or a newsletter — either way, worth a glance.
_DISPLAY = {
    "bounce": "delivery",
    "ooo": "ooo",
    "reply": "reply",
    "human_reply": "reply",
    "unsubscribe": "reply",
    "maybe_reply": "other",
    "auto_other": "other",
}


def _handled() -> dict[str, dict[str, str]]:
    """Verdicts the agent has already reached, keyed by message id."""
    try:
        c = db.connect()
        try:
            rows = c.execute(
                "SELECT message_id, kind, action FROM inbox_agent_seen"
            ).fetchall()
            return {
                str(r["message_id"]): {
                    "kind": str(r["kind"] or ""),
                    "action": str(r["action"] or ""),
                }
                for r in rows
            }
        finally:
            c.close()
    except Exception:  # noqa: BLE001 — categorising must survive an empty table
        return {}


def categorise(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Tag each message with a display category and what the agent did about it.

    Prefers the stored verdict, because that one was reached with the message
    body and, for an out-of-office, records the action taken. Falls back to
    classify(), which is pure header matching — so mail that arrived thirty
    seconds ago still lands in the right tab instead of waiting up to ten
    minutes for the next agent pass to have an opinion about it.
    """
    seen = _handled()
    out: list[dict[str, Any]] = []
    for m in items:
        row = dict(m)
        verdict = seen.get(str(m.get("id") or ""))
        kind = verdict["kind"] if verdict else classify(m)
        row["category"] = _DISPLAY.get(kind, "other")
        # Only worth showing when the agent actually did something; "no action"
        # and "left to bounce_scan" are internal bookkeeping.
        note = (verdict or {}).get("action", "")
        row["agent_note"] = (
            note if note and note not in ("no action", "left to bounce_scan",
                                          "no action needed", "no matching campaign")
            else ""
        )
        out.append(row)
    return out


def counts(items: list[dict[str, Any]]) -> dict[str, int]:
    """Per-category totals for the tab badges."""
    tally = {"reply": 0, "ooo": 0, "delivery": 0, "other": 0}
    for m in items:
        tally[str(m.get("category") or "other")] = (
            tally.get(str(m.get("category") or "other"), 0) + 1
        )
    tally["all"] = len(items)
    return tally
