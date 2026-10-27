"""Per-show messaging angles, as shown for the client's approval.

Backs the "Possible messaging angles" tab under each show: every angle in
``messaging_angles.EVENT_ANGLE_SETS[slug]`` rendered against a real lead from
that show's pool, with its dated send plan, how many leads the set would reach,
and the client's review (pending / approved / changes requested).

A review is a record and nothing else. Approving an angle does not draft,
queue or send anything; the show pools stay excluded from automatic sending.

The table (``event_angle_reviews``) is created by ``cockpit_api._init_db``.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
import time
from typing import Any
from zoneinfo import ZoneInfo

from outreach import brand, db
from outreach import messaging_angles as ma

STATUSES = ("pending", "approved", "changes_requested")

#: Accounts we would actually write to: not a partner manufacturer, competitor,
#: school or unrelated company.
_TARGET_TIERS_SQL = "(left(eff, 2) <> 'X-' AND eff <> 'T3-PARTNER')"

#: "Houston, TX", "Lafayette, Louisiana", "JEFFERSON, LA 70121" ... Passed as a
#: parameter: the db shim rewrites every literal "?" in SQL text.
TX_LA_REGEX = r"(^|[\s,])(TX|LA|Tex\.?|Texas|Louisiana)\.?(\s+\d{5}(-\d{4})?)?\s*$"


def copy_hash(angle: dict[str, Any]) -> str:
    """Fingerprint of the angle's template copy, stored at review time."""
    raw = json.dumps(
        [{"d": st.get("day"), "s": st["subject"], "b": st["body"]} for st in angle["steps"]],
        sort_keys=True,
    )
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def get_reviews(slug: str) -> dict[str, dict[str, Any]]:
    c = db.connect()
    try:
        rows = c.execute(
            "SELECT * FROM event_angle_reviews WHERE event_slug = ?", (slug,)
        ).fetchall()
        return {r["angle_key"]: dict(r) for r in rows}
    finally:
        c.close()


def set_review(slug: str, key: str, status: str, note: str, by: str) -> dict[str, Any]:
    """Record the client's verdict on one angle. Raises ValueError on bad input."""
    ev = ma.event_angle_set(slug)
    angle = ma.get_angle(key)
    if not ev or not angle or angle.get("event") != slug:
        raise ValueError(f"Unknown angle {key!r} for show {slug!r}")
    if status not in STATUSES:
        raise ValueError(f"Status must be one of {', '.join(STATUSES)}")
    note = (note or "").strip()[:4000]
    if status == "changes_requested" and not note:
        raise ValueError("Say what should change: a note is required when requesting changes.")
    c = db.connect()
    try:
        c.execute(
            """
            INSERT INTO event_angle_reviews (angle_key, event_slug, status, note, reviewed_by, reviewed_at, copy_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (angle_key) DO UPDATE SET
                event_slug = EXCLUDED.event_slug, status = EXCLUDED.status, note = EXCLUDED.note,
                reviewed_by = EXCLUDED.reviewed_by, reviewed_at = EXCLUDED.reviewed_at,
                copy_hash = EXCLUDED.copy_hash
            """,
            (key, slug, status, note, (by or "")[:200], time.time(), copy_hash(angle)),
        )
        c.commit()
    finally:
        c.close()
    return get_reviews(slug)[key]


def _pool_where() -> str:
    return "lower(COALESCE(a.lead_source_bucket,'')) = ?"


def _sample_lead(c: "db._Conn", slug: str, ev: dict[str, Any], tier_sql: str) -> dict[str, Any] | None:
    """A real, named lead from the pool to render the preview against: best tier
    first and, for a pre-show set, a Texas/Louisiana company first."""
    local_first = "(COALESCE(a.location,'') ~* ?) DESC," if ev.get("send_before_show") else ""
    params: tuple[Any, ...] = ("%@%", f"event:{slug}") + ((TX_LA_REGEX,) if local_first else ())
    row = c.execute(
        f"""
        SELECT a.id, a.company, COALESCE(a.location,'') AS location, COALESCE(a.industry,'') AS industry,
               ({tier_sql}) AS tier, p.person_name, COALESCE(p.job_title,'') AS job_title
        FROM accounts a
        JOIN LATERAL (
            SELECT person_name, job_title FROM contacts ct
            WHERE ct.account_id = a.id AND trim(COALESCE(ct.person_name,'')) <> ''
            ORDER BY (COALESCE(ct.email,'') LIKE ?) DESC, ct.role_rank DESC NULLS LAST,
                     ct.confidence DESC NULLS LAST, ct.id
            LIMIT 1
        ) p ON TRUE
        WHERE {_pool_where()}
          AND ({tier_sql}) IN ('T0-HOT', 'T1-WARM', 'T2-ICP')
        ORDER BY {local_first}
                 CASE ({tier_sql}) WHEN 'T0-HOT' THEN 0 WHEN 'T1-WARM' THEN 1 ELSE 2 END,
                 a.id
        LIMIT 1
        """,
        params,
    ).fetchone()
    if not row:
        return None
    person = str(row["person_name"] or "").strip()
    if person.isupper():
        person = person.title()
    return {
        "account_id": int(row["id"]),
        "company": row["company"],
        "person_name": person,
        "job_title": row["job_title"],
        "location": row["location"],
        "industry": row["industry"],
        "tier": row["tier"],
        "lead_source_bucket": f"event:{slug}",
        "source": "pool",
    }


def _reach(c: "db._Conn", slug: str, tier_sql: str) -> dict[str, int]:
    """How much of the pool the set would reach, overall and in Texas/Louisiana."""
    row = c.execute(
        f"""
        SELECT
            COUNT(*) AS pool,
            COUNT(*) FILTER (WHERE {_TARGET_TIERS_SQL}) AS targetable,
            COUNT(*) FILTER (WHERE {_TARGET_TIERS_SQL} AND emails > 0) AS reachable,
            COALESCE(SUM(emails) FILTER (WHERE {_TARGET_TIERS_SQL}), 0) AS contacts_with_email,
            COUNT(*) FILTER (WHERE located) AS located,
            COUNT(*) FILTER (WHERE txla) AS pool_tx_la,
            COUNT(*) FILTER (WHERE txla AND {_TARGET_TIERS_SQL}) AS targetable_tx_la,
            COUNT(*) FILTER (WHERE txla AND {_TARGET_TIERS_SQL} AND emails > 0) AS reachable_tx_la,
            COALESCE(SUM(emails) FILTER (WHERE txla AND {_TARGET_TIERS_SQL}), 0) AS contacts_with_email_tx_la
        FROM (
            SELECT ({tier_sql}) AS eff,
                   trim(COALESCE(a.location,'')) <> '' AS located,
                   COALESCE(a.location,'') ~* ? AS txla,
                   (SELECT COUNT(DISTINCT lower(ct.email)) FROM contacts ct
                     WHERE ct.account_id = a.id AND ct.email LIKE ?) AS emails
            FROM accounts a
            WHERE {_pool_where()}
        ) t
        """,
        (TX_LA_REGEX, "%@%", f"event:{slug}"),
    ).fetchone()
    return {k: int(v or 0) for k, v in dict(row).items()}


def _local_date(ts: float) -> _dt.date:
    return _dt.datetime.fromtimestamp(ts, ZoneInfo("America/Chicago")).date()


def event_payload(slug: str, tier_sql: str) -> dict[str, Any]:
    """Everything the approval tab shows for one show. ``items`` is empty for a
    show that has no angle set yet."""
    slug = (slug or "").strip().lower()
    ev = ma.event_angle_set(slug)
    if not ev:
        return {"event": slug, "has_set": False, "items": []}

    c = db.connect()
    try:
        sample = _sample_lead(c, slug, ev, tier_sql) or {**ev["sample"], "source": "static"}
        reach = _reach(c, slug, tier_sql)
    finally:
        c.close()
    reviews = get_reviews(slug)
    signer = brand.sender_name()
    today = ma.today_local()

    items = []
    for a in ev["angles"]:
        rv = reviews.get(a["key"]) or {}
        status = rv.get("status") or "pending"
        if status == "approved" and rv.get("reviewed_at"):
            start, basis = ma.next_send_day(_local_date(float(rv["reviewed_at"]))), "approval"
        else:
            start, basis = ma.next_send_day(today), "if_approved_today"
        steps = ma.render_angle_steps(a, sample, signer, start=start, include_skipped=True)
        label, url = a["primary_link"]
        items.append({
            "key": a["key"],
            "name": a["name"],
            "hook": a["hook"],
            "link": {"label": label, "url": url},
            "status": status,
            "note": rv.get("note") or "",
            "reviewed_by": rv.get("reviewed_by") or "",
            "reviewed_at": rv.get("reviewed_at"),
            # Approved copy that has since been edited needs another look.
            "stale": bool(rv.get("copy_hash")) and rv.get("copy_hash") != copy_hash(a),
            "start_date": start.isoformat(),
            "start_basis": basis,
            "steps": [
                {
                    "index": i,
                    "day": st.get("day"),
                    "subject": st["subject"],
                    "body": st["body"],
                    "send_date": st.get("send_date"),
                    "skipped": bool(st.get("skipped")),
                    "delay_after_prev_days": st.get("delay_after_prev_days", 0),
                }
                for i, st in enumerate(steps)
            ],
        })

    landing_path = ev.get("landing_path") or ""
    landing_url = ma.event_landing_url(slug)
    return {
        "event": slug,
        "has_set": True,
        "show": ev["show"],
        "show_dates": list(ev["show_dates"]),
        "location": ev.get("location") or "",
        "send_before_show": bool(ev.get("send_before_show")),
        "today": today.isoformat(),
        "landing": {
            "path": landing_path,
            "url": landing_url,
            # False: the page exists but OUTREACH_APPROVED_LINKS does not list it
            # yet, so the copy links to the primary site instead.
            "approved": bool(landing_url) if landing_path else None,
            "fallback": ma.LINK_PROGRAM,
        },
        "sample": sample,
        "reach": reach,
        "items": items,
        "sends_nothing": True,
    }
