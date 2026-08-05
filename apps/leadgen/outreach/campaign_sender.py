"""Dashboard-driven email campaign runner.

The client sets three knobs in the Emails > Dashboard UI and presses Send:
  - total          : how many emails to send in this campaign
  - batch_size      : how many to send per interval ("N at a time")
  - interval_minutes: minutes to wait between batches

Each batch: pull never-emailed leads, VALIDATE their addresses (syntax + MX +
SMTP mailbox probe), drop the dead ones, send the good ones from the approved
angle templates (rotating the rigby inboxes), then wait the interval. Progress
is polled by the UI (a Refresh button) via ``campaign_status()`` — not a live
stream. Runs as one background thread inside the API process.
"""

from __future__ import annotations

import math
import os
import random
import threading
import time
from typing import Any

from outreach import db, email_store, email_runner, outreach_store
from outreach.email_drafting import followup_gap_days
from outreach import brand
from outreach.messaging_angles import get_angle, pick_angle, render_angle_steps
from pipeline.email_validate import validate_many

ROT = [2, 3, 4]                 # d.rigby@, drigby@, dan.rigby@
WITHIN_BATCH_GAP = 10           # seconds between sends inside one batch

# Generic front-office local-parts. These `info@district.org`-style addresses are
# what the org-contact scraper stores on accounts.email, and they are the ones that
# bounce ("550 Recipient address rejected"). We must PREFER a real per-person email
# from the contacts table over one of these whenever the person email exists.
_GENERIC_LOCALPARTS = (
    "info", "contact", "contactus", "office", "admin", "administration", "help",
    "main", "mail", "general", "reception", "webmaster", "hello", "support",
    "acshelp", "enroll", "enrollment", "registrar", "noreply", "no-reply",
    "frontoffice", "front.office", "district", "communications", "media",
)
_GEN_SQL = "(" + ",".join("'%s'" % g for g in _GENERIC_LOCALPARTS) + ")"

# The address the campaign will send to for account ``a``: a named person's
# email, or nothing.
#
# This used to fall back to the account's front-office address, and then to ANY
# contact address including generic ones. That fallback is what produced 1,069
# sends and zero human replies. Every one of the fourteen sequences the system
# marked "replied" was a role account — webmaster@gcpsk12.org,
# info@susd12.org, techhelp@westside66.net, attendanceoffice@berkeley.net —
# i.e. ticket systems and auto-responders answering, not people. Role accounts
# at school districts also bounce hard, which is most of the 6.8% lifetime rate.
#
# An account with no named human is not a lead yet. It stays out of the send
# queue and belongs to enrichment until a person is found for it. That trades
# volume for the only thing that can produce a reply, and volume is the cheaper
# of the two to rebuild — see sources/contact_crawl.py.
_TO_EMAIL_SQL = f"""(
    SELECT c1.email FROM contacts c1
      WHERE c1.account_id = a.id AND c1.email LIKE '%@%'
        AND split_part(lower(c1.email), '@', 1) NOT IN {_GEN_SQL}
      ORDER BY c1.role_rank DESC NULLS LAST, c1.confidence DESC NULLS LAST LIMIT 1
)"""

# How many people we are willing to approach at the same organisation.
#
# The campaign used to enrol ONE address per account and exclude that account
# for ever after — `NOT EXISTS (SELECT 1 FROM email_sequences WHERE
# account_id = a.id)`. With 1333 accounts that read as an exhausted pool of 76
# while 447 perfectly good contact addresses sat in the contacts table unused,
# simply because somebody at that school had already been written to once.
#
# A district is not one person. The athletic director, the principal and the
# counsellor are three different buying conversations, and reaching two of them
# is normal outbound rather than duplication. Two, not five: the same inbox
# writing to half a school's staff list is what gets a domain filtered.
MAX_PER_ACCOUNT = max(1, int(os.getenv("CAMPAIGN_MAX_PER_ACCOUNT", "2")))

# Addresses already used, in any form. Exclusion moved from the ACCOUNT to the
# ADDRESS when enrolment became per-person — keying on account_id would have
# gone on hiding every colleague of anyone already contacted.
_ADDRESS_USED_SQL = """
      lower({col}) IN (SELECT lower(to_email) FROM email_sequences WHERE to_email IS NOT NULL)
   OR lower({col}) IN (SELECT lower(to_email) FROM email_send_log WHERE to_email IS NOT NULL)
   OR lower({col}) IN (SELECT lower(email) FROM email_validation WHERE ok=0)
"""

# One row per PERSON, best contacts first, at most MAX_PER_ACCOUNT per account.
#
# The account's own front-office address (info@, office@ …) is included only as
# a last resort for accounts that have no person-level contact at all — those
# are the addresses that produce "550 Recipient address rejected".
_CONTACT_CANDIDATES_SQL = f"""
    WITH people AS (
        SELECT ct.account_id,
               ct.email        AS to_email,
               ct.person_name,
               ct.job_title,
               ROW_NUMBER() OVER (
                   PARTITION BY ct.account_id
                   ORDER BY ct.role_rank DESC NULLS LAST,
                            ct.confidence DESC NULLS LAST,
                            ct.id ASC
               ) AS rn
        FROM contacts ct
        WHERE ct.email LIKE '%@%'
          -- Generic local-parts are excluded, not just deprioritised. They were
          -- ordered last and still sent to whenever an account had nothing else.
          AND split_part(lower(ct.email), '@', 1) NOT IN {_GEN_SQL}
          AND NOT ({_ADDRESS_USED_SQL.format(col="ct.email")})
    ),
    pool AS (
        SELECT * FROM people WHERE rn <= {MAX_PER_ACCOUNT}
    )
    SELECT a.id, a.company, a.industry, a.location, a.website,
           p.to_email, p.person_name, p.job_title
    FROM pool p
    JOIN accounts a ON a.id = p.account_id
"""

_lock = threading.Lock()
_stop = threading.Event()
_thread: threading.Thread | None = None
_validating = threading.Event()
_STATE: dict[str, Any] = {
    "status": "idle",           # idle | running | stopping | done | stopped | error
    "config": None,             # {total, batch_size, interval_minutes}
    "sent": 0, "failed": 0, "bounced": 0,
    "valid": 0, "invalid": 0,   # cumulative validation tallies this run
    "invalid_reasons": {},      # {reason: count}
    "batch": 0, "batches_total": 0,
    "next_batch_at": None, "started_at": None, "last_send_at": None,
    "message": "",
    # Generation is a separate phase from sending and reports separately, so a
    # half-finished generate cannot be mistaken for a half-finished send.
    "phase": "idle",            # idle | generating | sending
    "generated": 0,             # sequences drafted this run
    "generate_total": 0,
}


def _init_validation_table() -> None:
    c = db.connect()
    try:
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS email_validation (
                email TEXT PRIMARY KEY,
                ok INTEGER NOT NULL,
                reason TEXT,
                is_role INTEGER DEFAULT 0,
                has_mx INTEGER DEFAULT 0,
                checked_at DOUBLE PRECISION NOT NULL
            )
            """
        )
        c.commit()
    finally:
        c.close()


def pool_remaining() -> int:
    """People we can still write to: never emailed, not known-invalid.

    Counted from the SAME query the sender pulls from, so the number on the
    dashboard and the number of addresses that actually exist cannot drift —
    they did before, and the dashboard was the more optimistic of the two.
    """
    c = db.connect()
    try:
        return int(c.execute(
            f"SELECT COUNT(*) AS n FROM ({_CONTACT_CANDIDATES_SQL}) q"
        ).fetchone()["n"] or 0)
    finally:
        c.close()


def validation_summary() -> dict[str, int]:
    c = db.connect()
    try:
        rows = c.execute("SELECT ok, COUNT(*) AS n FROM email_validation GROUP BY ok").fetchall()
        d = {int(r["ok"]): int(r["n"]) for r in rows}
        return {"valid": d.get(1, 0), "invalid": d.get(0, 0)}
    finally:
        c.close()


def _pull_candidates(n: int) -> list[dict[str, Any]]:
    """The next ``n`` people to write to, newest accounts first.

    Per-PERSON, capped at MAX_PER_ACCOUNT per organisation. The previous
    version returned one address per account and excluded the account
    permanently once anyone there had been contacted, which is what made a
    pool of hundreds report as dozens.
    """
    c = db.connect()
    try:
        rows = c.execute(
            f"""
            {_CONTACT_CANDIDATES_SQL}
            ORDER BY a.id DESC LIMIT {int(n)}
            """
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        c.close()


def _store_validation(results: dict[str, dict[str, Any]]) -> None:
    now = time.time()
    c = db.connect()
    try:
        for email, r in results.items():
            c.execute(
                """
                INSERT INTO email_validation (email, ok, reason, is_role, has_mx, checked_at)
                VALUES (?,?,?,?,?,?)
                ON CONFLICT (email) DO UPDATE SET ok=EXCLUDED.ok, reason=EXCLUDED.reason,
                    is_role=EXCLUDED.is_role, has_mx=EXCLUDED.has_mx, checked_at=EXCLUDED.checked_at
                """,
                (email, 1 if r["ok"] else 0, r.get("reason", ""), 1 if r.get("role") else 0,
                 1 if r.get("mx") else 0, now),
            )
        c.commit()
    finally:
        c.close()


def _cached_valid(email: str) -> bool | None:
    c = db.connect()
    try:
        r = c.execute("SELECT ok FROM email_validation WHERE email=?", ((email or "").lower(),)).fetchone()
        return None if r is None else bool(r["ok"])
    finally:
        c.close()


def validate_pool(limit: int = 600) -> dict[str, int]:
    """One-off: validate up to ``limit`` never-emailed addresses and cache results
    (used by the 'Validate pool' action so the dashboard shows valid/invalid)."""
    _init_validation_table()
    leads = _pull_candidates(limit)
    emails = [l["to_email"] for l in leads if not _cached_valid_known(l["to_email"])]
    if emails:
        _store_validation(validate_many(emails, smtp_probe=True))
    return validation_summary()


def _cached_valid_known(email: str) -> bool:
    return _cached_valid(email) is not None


def start_validation(limit: int = 600) -> dict[str, Any]:
    """Kick off pool validation in the background (non-blocking). The UI polls
    ``campaign_status()`` and watches the valid/invalid counts grow."""
    if _validating.is_set():
        return campaign_status()

    def _job() -> None:
        _validating.set()
        try:
            validate_pool(limit)
        finally:
            _validating.clear()

    threading.Thread(target=_job, daemon=True, name="pool-validate").start()
    return campaign_status()


def _angle_for(lead: dict[str, Any]) -> str:
    """Which angle this lead gets.

    Was a random pick from one of two hardcoded lists, split by whether the
    company name looked like a school. Two problems: the split encoded one
    client's market, and the lists named angle keys directly — so the moment the
    angle set changed, `get_angle` returned None and drafting died on an
    AttributeError with nothing pointing at why.

    `pick_angle` is the single source of truth for that mapping and is keyed off
    the account id, which also makes it stable: the same lead re-drafted gets
    the same angle instead of a new one every run.
    """
    return pick_angle(lead)


def _build_sequence(lead: dict[str, Any], angle_override: str | None = None) -> int:
    """Draft one lead's whole sequence — opener plus its follow-ups — and approve
    it. Sends NOTHING; returns the sequence id.

    Split out of _send_one so the campaign can generate a run for review before
    a single email leaves. Drafting and sending were one indivisible step, which
    is why there was never a moment when 200 drafts existed to be checked.
    """
    aid = int(lead["id"])
    angle = angle_override or _angle_for(lead)
    ctx = {"account_id": aid, "company": lead.get("company") or "", "person_name": lead.get("person_name") or "",
           "job_title": lead.get("job_title") or "", "website": lead.get("website") or "",
           "industry": lead.get("industry") or "", "location": lead.get("location") or "", "email": lead["to_email"]}
    gaps = followup_gap_days() or [3, 5, 7]
    raw = render_angle_steps(get_angle(angle), ctx, brand.sender_name())
    steps = [{"subject": s["subject"], "body": s["body"], "delay_after_prev_days": 0 if i == 0 else gaps[(i - 1) % len(gaps)]}
             for i, s in enumerate(raw)]
    # create_sequence, not upsert_draft.
    #
    # upsert_draft keys on account_id alone: it finds the account's newest
    # sequence and, if that one is already sending or sent, returns it UNCHANGED.
    # That was fine when enrolment was one address per account. It is wrong now
    # that two people at the same school can both be enrolled — the second
    # person silently got the first person's sequence back and no draft was
    # made. Measured: generating 5 produced 2 sequences and reported 5.
    #
    # _pull_candidates already excludes every address that appears in
    # email_sequences, email_send_log or the invalid list, so an address
    # reaching here has provably never been written to and a fresh insert cannot
    # duplicate anything. Prior sequences for the account stay as history, which
    # is what create_sequence is for.
    seq = email_store.create_sequence(account_id=aid, company=ctx["company"], person_name=ctx["person_name"],
                                      to_email=lead["to_email"], from_email="", provider="template",
                                      steps=steps, angle=angle)
    sid = int(seq["id"])
    email_store.approve_sequence(sid, to_email=lead["to_email"])
    return sid


def _send_one(lead: dict[str, Any], angle_override: str | None = None) -> bool:
    sid = _build_sequence(lead, angle_override)
    res = email_runner.start_sequence_send(sid, inbox_id=random.choice(ROT))
    # Cap-deferred still counts as enrolled: the step stays pending and the
    # scheduler drains it — real per-inbox caps are respected, not rewritten.
    return res.get("sent", 0) >= 1 or res.get("capped", 0) >= 1


def _interruptible_sleep(seconds: float) -> None:
    end = time.time() + seconds
    while time.time() < end and not _stop.is_set():
        time.sleep(min(5, end - time.time()))


def _run(total: int, batch_size: int, interval_minutes: int, angle: str | None = None) -> None:
    try:
        _STATE["batches_total"] = math.ceil(total / batch_size)
        while _STATE["sent"] < total and not _stop.is_set():
            need = min(batch_size, total - _STATE["sent"])
            # pull a buffer so invalids don't starve the batch
            leads = _pull_candidates(max(need * 4, need + 20))
            if not leads:
                _STATE["message"] = "Lead pool exhausted."
                break
            to_check = [l["to_email"] for l in leads if not _cached_valid_known(l["to_email"])]
            if to_check:
                _store_validation(validate_many(to_check, smtp_probe=True))
            valid_leads, invalid_here = [], 0
            for l in leads:
                if _cached_valid(l["to_email"]):
                    valid_leads.append(l)
                else:
                    invalid_here += 1
                if len(valid_leads) >= need:
                    break
            _STATE["invalid"] += invalid_here
            if not valid_leads:
                continue  # everything pulled was invalid; next pull skips them
            _STATE["batch"] += 1
            for l in valid_leads:
                if _stop.is_set():
                    break
                try:
                    if _send_one(l, angle):
                        _STATE["sent"] += 1
                        _STATE["valid"] += 1
                        _STATE["last_send_at"] = time.time()
                    else:
                        _STATE["failed"] += 1
                except Exception:  # noqa: BLE001
                    _STATE["failed"] += 1
                time.sleep(WITHIN_BATCH_GAP)
            try:
                from outreach.bounce_scan import scan_bounces
                b = scan_bounces(limit_per_inbox=150)
                _STATE["bounced"] = int(b.get("new", 0)) + _STATE["bounced"]
            except Exception:  # noqa: BLE001
                pass
            if _STATE["sent"] < total and not _stop.is_set():
                _STATE["next_batch_at"] = time.time() + interval_minutes * 60
                _STATE["message"] = f"Batch {_STATE['batch']} done — next in {interval_minutes} min."
                _interruptible_sleep(interval_minutes * 60)
        _STATE["next_batch_at"] = None
        _STATE["status"] = "stopped" if _stop.is_set() else "done"
        _STATE["message"] = ("Stopped by user." if _stop.is_set()
                             else f"Done — {_STATE['sent']} sent.")
    except Exception as e:  # noqa: BLE001
        _STATE["status"] = "error"
        _STATE["message"] = f"{type(e).__name__}: {e}"[:200]


def _generate(total: int, angle: str | None) -> None:
    """Draft ``total`` sequences and stop. Nothing is sent."""
    try:
        made = 0
        seen: set[int] = set()
        while made < total and not _stop.is_set():
            need = total - made
            # Pull a buffer: invalid addresses are dropped here rather than
            # after drafting, so the run reaches its number.
            leads = _pull_candidates(max(need * 3, need + 20))
            leads = [l for l in leads if int(l["id"]) not in seen]
            if not leads:
                _STATE["message"] = f"Lead pool exhausted at {made} of {total}."
                break

            to_check = [l["to_email"] for l in leads if not _cached_valid_known(l["to_email"])]
            if to_check:
                _store_validation(validate_many(to_check, smtp_probe=True))

            progressed = False
            for lead in leads:
                if made >= total or _stop.is_set():
                    break
                if not _cached_valid(lead["to_email"]):
                    _STATE["invalid"] += 1
                    seen.add(int(lead["id"]))
                    continue
                try:
                    _build_sequence(lead, angle)
                    made += 1
                    progressed = True
                    _STATE["generated"] = made
                    _STATE["valid"] += 1
                    _STATE["message"] = f"Drafted {made} of {total}…"
                except Exception:  # noqa: BLE001 — one bad lead must not end the run
                    _STATE["failed"] += 1
                finally:
                    # Marked either way: a lead that cannot be drafted would
                    # otherwise be re-pulled for ever and the loop would hang.
                    seen.add(int(lead["id"]))
            if not progressed:
                _STATE["message"] = f"No draftable leads left at {made} of {total}."
                break

        _STATE["status"] = "stopped" if _stop.is_set() else "done"
        _STATE["phase"] = "idle"
        if not _STATE["message"].startswith(("Lead pool", "No draftable")):
            _STATE["message"] = (
                f"Stopped at {made} drafts." if _stop.is_set()
                else f"{made} drafts ready to review. Nothing has been sent."
            )
    except Exception as e:  # noqa: BLE001
        _STATE["status"] = "error"
        _STATE["phase"] = "idle"
        _STATE["message"] = f"{type(e).__name__}: {e}"[:200]


def generate_drafts(total: int, angle: str | None = None) -> dict[str, Any]:
    """Draft a whole campaign for review, WITHOUT sending any of it.

    Each lead gets a full sequence — opener plus follow-ups at the configured
    gaps — approved and waiting in the queue. The queue is then reviewable and
    fires as one deliberate action, which is the same approve-then-send split
    the per-lead composer has always used. The batched sender skipped it.
    """
    global _thread
    _init_validation_table()
    with _lock:
        if _STATE["status"] == "running":
            raise RuntimeError("A campaign is already running.")
        total = max(1, min(int(total), 2000))
        if angle and not get_angle(angle):
            raise ValueError(f"Unknown messaging angle: {angle}")
        _stop.clear()
        _STATE.update({
            "status": "running", "phase": "generating",
            "config": {"total": total, "angle": angle},
            "sent": 0, "failed": 0, "bounced": 0, "valid": 0, "invalid": 0, "invalid_reasons": {},
            "batch": 0, "batches_total": 0, "generated": 0, "generate_total": total,
            "next_batch_at": None, "started_at": time.time(), "last_send_at": None,
            "message": "Drafting…",
        })
        _thread = threading.Thread(target=_generate, args=(total, angle),
                                   daemon=True, name="campaign-generate")
        _thread.start()
    return campaign_status()


def start_campaign(total: int, batch_size: int, interval_minutes: int, angle: str | None = None) -> dict[str, Any]:
    global _thread
    _init_validation_table()
    with _lock:
        if _STATE["status"] == "running":
            raise RuntimeError("A campaign is already running.")
        total = max(1, min(int(total), 2000))
        batch_size = max(1, min(int(batch_size), total))
        interval_minutes = max(0, min(int(interval_minutes), 1440))
        if angle and not get_angle(angle):
            raise ValueError(f"Unknown messaging angle: {angle}")
        _stop.clear()
        _STATE.update({
            "status": "running", "phase": "sending",
            "config": {"total": total, "batch_size": batch_size,
                       "interval_minutes": interval_minutes, "angle": angle},
            "sent": 0, "failed": 0, "bounced": 0, "valid": 0, "invalid": 0, "invalid_reasons": {},
            "batch": 0, "batches_total": math.ceil(total / batch_size),
            "next_batch_at": None, "started_at": time.time(), "last_send_at": None,
            "message": "Starting…",
        })
        _thread = threading.Thread(target=_run, args=(total, batch_size, interval_minutes, angle),
                                   daemon=True, name="campaign-sender")
        _thread.start()
    return campaign_status()


def stop_campaign() -> dict[str, Any]:
    _stop.set()
    if _STATE["status"] == "running":
        _STATE["status"] = "stopping"
        _STATE["message"] = "Stopping after the current send…"
    return campaign_status()


def lead_funnel() -> dict[str, int]:
    """The full picture behind "leads remaining", so the dashboard can explain
    itself: total leads -> have a contact email -> already emailed -> fresh."""
    c = db.connect()
    try:
        email_expr = _TO_EMAIL_SQL
        total = int(c.execute("SELECT COUNT(*) n FROM accounts").fetchone()["n"] or 0)
        with_email = int(c.execute(
            f"SELECT COUNT(*) n FROM accounts a WHERE {email_expr} LIKE '%@%'"  # noqa: S608
        ).fetchone()["n"] or 0)
        emailed = int(c.execute(
            "SELECT COUNT(DISTINCT account_id) n FROM email_sequences WHERE account_id IS NOT NULL"
        ).fetchone()["n"] or 0)
        return {
            "total": total,
            "with_email": with_email,
            "emailed": emailed,
            "no_email": max(0, total - with_email),
        }
    finally:
        c.close()


def campaign_status() -> dict[str, Any]:
    s = dict(_STATE)
    s["validating"] = _validating.is_set()
    try:
        s["pool_remaining"] = pool_remaining()
        s["validation"] = validation_summary()
        s["funnel"] = lead_funnel()
        # The other half of "can we send 200 today". Drafting is not capped;
        # only sending is, and the wizard has to say which of the two is the
        # binding limit rather than showing one number and hoping.
        s["cap_remaining"] = email_runner.cap_remaining()
    except Exception:  # noqa: BLE001
        s["pool_remaining"] = None
    return s
