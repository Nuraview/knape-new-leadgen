"""Bounce recovery: re-enroll bounced leads using an ALTERNATE contact email.

A bounced address is dead — the recovery move is to find another human at the
same account (the contacts table, or a live Serper crawl for accounts with no
alternates), validate that address (syntax + MX + SMTP probe), draft a fresh
sequence for the new person, and enroll it. The original bounced sequence is
left untouched as history; every bounced address is poisoned in
``email_validation`` so no code path can ever email it again.

Runs as one background thread in the API process (same pattern as
``campaign_sender``); the UI polls ``list_bounced()`` for progress.
"""

from __future__ import annotations

import threading
import time
from typing import Any

from outreach import db, email_store, outreach_store
from outreach.campaign_sender import _init_validation_table, _store_validation
from outreach.email_drafting import draft_email_sequence, followup_gap_days
from outreach import brand
from outreach.messaging_angles import get_angle, pick_angle, render_angle_steps
from pipeline.email_validate import validate_email

_lock = threading.Lock()
_thread: threading.Thread | None = None
_STATE: dict[str, Any] = {
    "status": "idle",          # idle | running | done | error
    "phase": "",               # requeue | discovery
    "dry_run": False,
    "total": 0, "processed": 0,
    "requeued": 0, "no_alternate": 0, "invalid_alternate": 0,
    "discovered": 0, "no_contact_found": 0, "skipped": 0,
    "results": [],             # per-sequence outcome rows
    "started_at": None, "finished_at": None, "message": "",
}


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------
def _bounced_rows() -> list[dict[str, Any]]:
    """One row per bounced ACCOUNT, from two sources merged:

    1. Live bounce records — sequences with a bounced step (latest per account).
    2. Orphaned bounces — accounts whose bounced sequence was DELETED from the
       dashboard log but whose dead address was fenced in ``email_validation``
       (``ok=0, reason in ('bounced','hard bounce')``) and actually emailed
       (``email_send_log``). This is how the 7/23 batch looks after cleanup.

    ``requeued`` = the account has a sequence newer than the bounced one."""
    c = db.connect()
    try:
        live = c.execute(
            """
            SELECT DISTINCT ON (sq.account_id)
                   sq.id AS sequence_id, sq.account_id, sq.company, sq.person_name,
                   lower(sq.to_email) AS to_email, COALESCE(sq.angle,'') AS angle, sq.status,
                   st.bounce_at, st.bounce_info,
                   EXISTS (SELECT 1 FROM email_sequences s2
                           WHERE s2.account_id = sq.account_id AND s2.id > sq.id) AS requeued
            FROM email_sequences sq
            JOIN LATERAL (
                SELECT bounce_at, bounce_info FROM email_steps
                WHERE sequence_id = sq.id AND COALESCE(bounced,0) = 1
                ORDER BY bounce_at DESC NULLS LAST LIMIT 1
            ) st ON true
            WHERE sq.account_id IS NOT NULL
            ORDER BY sq.account_id, st.bounce_at DESC NULLS LAST
            """
        ).fetchall()
        seen = {int(r["account_id"]) for r in live}
        orphans = c.execute(
            """
            SELECT DISTINCT ON (ct.account_id)
                   NULL::bigint AS sequence_id, ct.account_id, a.company, ct.person_name,
                   lower(v.email) AS to_email, '' AS angle, 'deleted' AS status,
                   v.checked_at AS bounce_at, COALESCE(NULLIF(v.reason,''),'bounced') AS bounce_info,
                   false AS requeued
            FROM email_validation v
            JOIN contacts ct ON lower(ct.email) = lower(v.email)
            JOIN accounts a ON a.id = ct.account_id
            WHERE v.ok = 0 AND v.reason IN ('bounced', 'hard bounce')
              AND lower(v.email) IN (SELECT DISTINCT lower(to_email) FROM email_send_log
                                     WHERE to_email IS NOT NULL)
              AND NOT EXISTS (SELECT 1 FROM email_sequences s WHERE s.account_id = ct.account_id)
            ORDER BY ct.account_id, v.checked_at DESC
            """
        ).fetchall()
        rows = [dict(r) for r in live] + [dict(r) for r in orphans if int(r["account_id"]) not in seen]
        rows.sort(key=lambda r: r.get("bounce_at") or 0, reverse=True)
        return rows
    finally:
        c.close()


def _alternates(account_id: int) -> list[dict[str, Any]]:
    """Ranked alternate contacts for an account: never emailed anywhere, not
    known-invalid, not any address this account was already sequenced to."""
    c = db.connect()
    try:
        rows = c.execute(
            """
            SELECT id, person_name, job_title, email, role_rank, confidence
            FROM contacts
            WHERE account_id = ? AND POSITION('@' IN COALESCE(email,'')) > 0
              AND lower(email) NOT IN (SELECT lower(to_email) FROM email_sequences
                                       WHERE account_id = ? AND to_email IS NOT NULL)
              AND lower(email) NOT IN (SELECT DISTINCT lower(to_email) FROM email_send_log
                                       WHERE to_email IS NOT NULL)
              AND lower(email) NOT IN (SELECT lower(email) FROM email_validation WHERE ok = 0)
            ORDER BY role_rank DESC NULLS LAST, confidence DESC NULLS LAST, id ASC
            LIMIT 3
            """,
            (account_id, account_id),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        c.close()


def _account(account_id: int) -> dict[str, Any] | None:
    c = db.connect()
    try:
        row = c.execute(
            """SELECT id, company, website, industry, location, signal_category,
                      signal_evidence, equipment_needs, icp_enhanced_score, icp_score
               FROM accounts WHERE id = ?""",
            (account_id,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        c.close()


def poison_bounced_addresses() -> int:
    """Mark every bounced recipient invalid in email_validation — the data-level
    fence that keeps campaign pulls, alternates, and requeues off dead addresses."""
    _init_validation_table()
    now = time.time()
    c = db.connect()
    try:
        rows = c.execute(
            """SELECT DISTINCT lower(sq.to_email) AS em
               FROM email_sequences sq JOIN email_steps st ON st.sequence_id = sq.id
               WHERE COALESCE(st.bounced,0) = 1 AND COALESCE(sq.to_email,'') <> ''"""
        ).fetchall()
        n = 0
        for r in rows:
            c.execute(
                """INSERT INTO email_validation (email, ok, reason, is_role, has_mx, checked_at)
                   VALUES (?, 0, 'hard bounce', 0, 0, ?)
                   ON CONFLICT (email) DO UPDATE SET ok=0, reason='hard bounce',
                       checked_at=EXCLUDED.checked_at""",
                (r["em"], now),
            )
            n += 1
        c.commit()
        return n
    finally:
        c.close()


def list_bounced() -> dict[str, Any]:
    """Everything the Bounced tab needs: rows (+best alternate), summary, job state."""
    rows = _bounced_rows()
    with_alt = no_alt = requeued = 0
    for r in rows:
        if r["requeued"]:
            requeued += 1
            r["alternate"] = None
            continue
        alts = _alternates(int(r["account_id"]))
        r["alternate"] = alts[0] if alts else None
        if alts:
            with_alt += 1
        else:
            no_alt += 1
    return {
        "items": rows,
        "summary": {"total": len(rows), "with_alternate": with_alt,
                    "no_alternate": no_alt, "requeued": requeued},
        "job": dict(_STATE, results=list(_STATE["results"])),
    }


# ---------------------------------------------------------------------------
# Requeue
# ---------------------------------------------------------------------------
def _build_steps(lead: dict[str, Any], angle: str) -> tuple[list[dict[str, Any]], str]:
    """AI redraft for the new contact (user's call), falling back to the angle's
    canonical template copy so the batch never stalls on an OpenAI hiccup."""
    try:
        steps, provider = draft_email_sequence(lead, angle or None)
        if steps:
            return steps, provider
    except Exception:  # noqa: BLE001
        pass
    ang = get_angle(angle) or get_angle(pick_angle(lead))
    gaps = followup_gap_days() or [3, 5, 7]
    raw = render_angle_steps(ang, lead, brand.sender_name())
    steps = [{"subject": s["subject"], "body": s["body"],
              "delay_after_prev_days": 0 if i == 0 else gaps[(i - 1) % len(gaps)]}
             for i, s in enumerate(raw)]
    return steps, "template"


def requeue_one(row: dict[str, Any], *, dry_run: bool = False) -> dict[str, Any]:
    """Recover one bounced account via its best valid alternate contact."""
    out: dict[str, Any] = {"account_id": row["account_id"], "sequence_id": row.get("sequence_id"),
                           "company": row.get("company"), "bounced_email": row.get("to_email")}
    if row.get("requeued"):
        return {**out, "result": "already_requeued"}
    alts = _alternates(int(row["account_id"]))
    if not alts:
        return {**out, "result": "no_alternate"}
    chosen = None
    reasons: list[str] = []
    for alt in alts:
        em = (alt["email"] or "").strip().lower()
        v = validate_email(em, smtp_probe=True)
        _store_validation({em: v})
        if v.get("ok"):
            chosen = alt
            break
        reasons.append(f"{em}: {v.get('reason', 'invalid')}")
    if chosen is None:
        return {**out, "result": "invalid_alternate", "reason": "; ".join(reasons)[:300]}

    to_email = (chosen["email"] or "").strip().lower()
    out.update({"to_email": to_email, "person_name": chosen.get("person_name") or ""})
    if dry_run:
        return {**out, "result": "would_requeue"}

    acct = _account(int(row["account_id"])) or {}
    lead = {
        "company": acct.get("company") or row.get("company") or "",
        "person_name": chosen.get("person_name") or "",
        "job_title": chosen.get("job_title") or "",
        "website": acct.get("website") or "",
        "industry": acct.get("industry") or "",
        "signal_category": acct.get("signal_category") or "",
        "signal_evidence": acct.get("signal_evidence") or "",
        "equipment_needs": acct.get("equipment_needs") or "",
        "icp_score": acct.get("icp_enhanced_score") or acct.get("icp_score") or "",
        "email": to_email,
        "account_id": row["account_id"],
    }
    angle = row.get("angle") or pick_angle(lead)
    steps, drafted_via = _build_steps(lead, angle)
    seq = email_store.create_sequence(
        account_id=int(row["account_id"]), company=lead["company"],
        person_name=lead["person_name"], to_email=to_email, from_email="",
        provider="requeue", steps=steps, angle=angle,
    )
    email_store.approve_sequence(seq["id"], to_email=to_email)
    try:
        inbox = outreach_store.pick_send_inbox(require_warmed=False)
        if inbox:
            email_store.set_sequence_inbox(seq["id"], inbox["id"], inbox["email"])
    except Exception:  # noqa: BLE001 — global-config fallback still sends
        pass
    # Schedules step 0 for now; the 5-min scheduler drains it under caps/gap.
    email_store.mark_sequence_started(seq["id"])
    return {**out, "result": "requeued", "new_sequence_id": seq["id"], "drafted_via": drafted_via}


# ---------------------------------------------------------------------------
# Discovery (accounts with no alternate on file)
# ---------------------------------------------------------------------------
def _is_institution(acct: dict[str, Any]) -> bool:
    """Whether to crawl this account like a large institution rather than a
    company site — deeper, and tolerant of a shared parent domain."""
    blob = f"{acct.get('industry','')} {acct.get('company','')}".lower()
    return any(w in blob for w in ("school", "district", "university", "college", "county", "authority"))


def _save_discovered_contacts(account_id: int, contacts: list[dict[str, Any]]) -> int:
    c = db.connect()
    try:
        n = 0
        for i, ct in enumerate(contacts[:3]):
            name = (ct.get("name") or "").strip()
            if not name:
                continue
            c.execute(
                """INSERT INTO contacts (account_id, person_name, job_title, email,
                       source_kind, confidence, role_rank)
                   VALUES (?,?,?,?,?,?,?)""",
                (account_id, name, (ct.get("title") or "").strip(),
                 (ct.get("email") or "").strip().lower() or None,
                 "bounce_discovery", None, max(0, 3 - i)),
            )
            n += 1
        c.commit()
        return n
    finally:
        c.close()


def discover_for_account(row: dict[str, Any]) -> int:
    """Serper-crawl the account's site for named contacts; persist what's found.
    Returns how many contact rows were added."""
    from sources.contact_crawl import crawl_account_contacts

    acct = _account(int(row["account_id"]))
    if not acct:
        return 0
    result = crawl_account_contacts(acct.get("company") or "", acct.get("website") or "", _is_institution(acct))
    return _save_discovered_contacts(int(row["account_id"]), result.get("contacts") or [])


# ---------------------------------------------------------------------------
# Background job
# ---------------------------------------------------------------------------
def _run(account_ids: list[int] | None, dry_run: bool, include_discovery: bool) -> None:
    try:
        poisoned = 0 if dry_run else poison_bounced_addresses()
        rows = [r for r in _bounced_rows() if not r["requeued"]]
        if account_ids:
            wanted = {int(i) for i in account_ids}
            rows = [r for r in rows if int(r["account_id"]) in wanted]
        _STATE.update(total=len(rows),
                      message=("Dry run — nothing will be written. Working…" if dry_run
                               else f"{poisoned} bounced addresses fenced off. Working…"))

        deferred_discovery: list[dict[str, Any]] = []
        _STATE["phase"] = "requeue"
        for row in rows:
            res = requeue_one(row, dry_run=dry_run)
            _STATE["results"].append(res)
            _STATE["processed"] += 1
            k = res["result"]
            if k in ("requeued", "would_requeue"):
                _STATE["requeued"] += 1
            elif k == "no_alternate":
                _STATE["no_alternate"] += 1
                deferred_discovery.append(row)
            elif k == "invalid_alternate":
                _STATE["invalid_alternate"] += 1
            else:
                _STATE["skipped"] += 1

        if include_discovery and not dry_run and deferred_discovery:
            _STATE["phase"] = "discovery"
            _STATE["message"] = f"Finding contacts for {len(deferred_discovery)} accounts with no alternate…"
            for row in deferred_discovery:
                try:
                    added = discover_for_account(row)
                except Exception as e:  # noqa: BLE001 — one bad crawl must not kill the batch
                    added = 0
                    _STATE["results"].append({"account_id": row["account_id"], "company": row.get("company"),
                                              "result": "discovery_error", "reason": f"{type(e).__name__}: {e}"[:200]})
                if added:
                    _STATE["discovered"] += 1
                    res = requeue_one(row, dry_run=False)
                    _STATE["results"].append(res)
                    if res["result"] == "requeued":
                        _STATE["requeued"] += 1
                    elif res["result"] == "invalid_alternate":
                        _STATE["invalid_alternate"] += 1
                else:
                    _STATE["no_contact_found"] += 1
                    _STATE["results"].append({"account_id": row["account_id"], "company": row.get("company"),
                                              "result": "no_contact_found"})

        _STATE.update(status="done", finished_at=time.time(),
                      message=(f"Dry run — {_STATE['requeued']} would requeue."
                               if dry_run else
                               f"Done — {_STATE['requeued']} requeued, {_STATE['no_alternate']} had no alternate"
                               f" ({_STATE['no_contact_found']} still without a contact)."))
    except Exception as e:  # noqa: BLE001
        _STATE.update(status="error", finished_at=time.time(),
                      message=f"{type(e).__name__}: {e}"[:300])


def start_requeue(account_ids: list[int] | None = None, *, dry_run: bool = False,
                  include_discovery: bool = False) -> dict[str, Any]:
    """Kick off the recovery job in the background. Raises RuntimeError if one
    is already running. Poll ``list_bounced()['job']`` for progress."""
    global _thread
    with _lock:
        if _STATE["status"] == "running":
            raise RuntimeError("A bounce-requeue job is already running.")
        _STATE.update(status="running", phase="requeue", dry_run=bool(dry_run),
                      total=0, processed=0, requeued=0, no_alternate=0,
                      invalid_alternate=0, discovered=0, no_contact_found=0, skipped=0,
                      results=[], started_at=time.time(), finished_at=None,
                      message="Starting…")
        _thread = threading.Thread(target=_run, args=(account_ids, bool(dry_run), bool(include_discovery)),
                                   daemon=True, name="bounce-requeue")
        _thread.start()
    return {"started": True, "job": dict(_STATE, results=[])}
