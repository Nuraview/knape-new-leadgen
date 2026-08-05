"""Postgres persistence for Milestone 2 leads, sequence steps, and engagement events."""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

from outreach import db
from utils.domain import website_to_domain

_SUFFIX_TOKENS: frozenset[str] = frozenset(
    {
        "inc",
        "incorporated",
        "llc",
        "ltd",
        "limited",
        "corp",
        "corporation",
        "company",
        "co",
        "the",
        "plc",
        "pa",
        "lp",
        "llp",
        "pc",
        "ps",
        "srl",
        "dba",
    }
)


def company_match_fingerprint(name: str) -> str:
    """Normalize company names for matching (suffixes and punctuation stripped)."""
    s = (name or "").lower()
    for ch in ",.&'/-":
        s = s.replace(ch, " ")
    s = s.replace(".", " ")
    parts = [p for p in s.split() if p and p not in _SUFFIX_TOKENS]
    return " ".join(parts).strip()


def _lead_matches_account_score(
    lead_company: str,
    payload_json: str | None,
    account_company: str,
    account_website: str,
) -> int:
    """How well an M2 lead row matches the cockpit account (higher is better)."""
    ac = (account_company or "").strip()
    aw = (account_website or "").strip()
    if not ac and not aw:
        return 0
    score = 0
    fp_a = company_match_fingerprint(ac)
    fp_l = company_match_fingerprint(lead_company or "")
    if fp_a and fp_l and fp_a == fp_l:
        score += 4
    dom_a = website_to_domain(aw)
    if dom_a and payload_json:
        try:
            payload = json.loads(payload_json)
        except (json.JSONDecodeError, TypeError):
            payload = {}
        if isinstance(payload, dict):
            dom_l = website_to_domain(str(payload.get("website") or ""))
            if dom_l and dom_a == dom_l:
                score += 3
    return score


def _steps_dicts_from_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "step_index": int(r["step_index"]),
            "subject": str(r["subject"] or ""),
            "body": str(r["body"] or ""),
            "delay_after_prev_days": int(r["delay_after_prev_days"] or 0),
        }
        for r in rows
    ]



def _connect(db_path: str | None = None) -> db._Conn:
    # ``db_path`` is accepted for backwards-compatible call sites but ignored:
    # storage is now a single Postgres database addressed by ``DATABASE_URL``.
    return db.connect()


def init_db(db_path: str | None = None) -> None:
    conn = _connect(db_path)
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY,
                created_at DOUBLE PRECISION NOT NULL,
                note TEXT
            );
            CREATE TABLE IF NOT EXISTS leads (
                id BIGSERIAL PRIMARY KEY,
                run_id TEXT NOT NULL,
                lead_key TEXT NOT NULL,
                email TEXT NOT NULL,
                company TEXT,
                person_name TEXT,
                job_title TEXT,
                signal_evidence TEXT,
                source TEXT,
                icp_score TEXT,
                payload_json TEXT,
                FOREIGN KEY (run_id) REFERENCES runs(id)
            );
            CREATE INDEX IF NOT EXISTS idx_leads_run ON leads(run_id);
            CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
            CREATE TABLE IF NOT EXISTS sequence_steps (
                id BIGSERIAL PRIMARY KEY,
                lead_id INTEGER NOT NULL,
                step_index INTEGER NOT NULL,
                subject TEXT NOT NULL,
                body TEXT NOT NULL,
                delay_after_prev_days INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (lead_id) REFERENCES leads(id)
            );
            CREATE TABLE IF NOT EXISTS events (
                id BIGSERIAL PRIMARY KEY,
                lead_id INTEGER,
                run_id TEXT,
                event_type TEXT NOT NULL,
                payload_json TEXT,
                created_at DOUBLE PRECISION NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
            CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id);
            """
        )
        conn.commit()
    finally:
        conn.close()


def new_run_id() -> str:
    return str(uuid.uuid4())


def insert_run(db_path: str, run_id: str, note: str = "") -> None:
    init_db(db_path)
    conn = _connect(db_path)
    try:
        conn.execute(
            "INSERT INTO runs (id, created_at, note) VALUES (?, ?, ?)",
            (run_id, time.time(), note),
        )
        conn.commit()
    finally:
        conn.close()


def insert_lead_with_steps(
    db_path: str,
    run_id: str,
    lead_key: str,
    email: str,
    lead: dict[str, Any],
    steps: list[dict[str, Any]],
) -> int:
    """steps: {subject, body, delay_after_prev_days}. Returns lead row id."""
    init_db(db_path)
    conn = _connect(db_path)
    try:
        cur = conn.execute(
            """
            INSERT INTO leads (run_id, lead_key, email, company, person_name, job_title,
                signal_evidence, source, icp_score, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
            """,
            (
                run_id,
                lead_key,
                email,
                lead.get("company", ""),
                lead.get("person_name", ""),
                lead.get("job_title", ""),
                lead.get("signal_evidence", ""),
                lead.get("source", ""),
                str(lead.get("icp_score", "")),
                json.dumps(lead, default=str),
            ),
        )
        lead_id = int(cur.fetchone()["id"])
        for i, st in enumerate(steps):
            conn.execute(
                """
                INSERT INTO sequence_steps (lead_id, step_index, subject, body, delay_after_prev_days)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    lead_id,
                    i,
                    st.get("subject", ""),
                    st.get("body", ""),
                    int(st.get("delay_after_prev_days", 0)),
                ),
            )
        conn.execute(
            "INSERT INTO events (lead_id, run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
            (
                lead_id,
                run_id,
                "draft_ready",
                json.dumps({"step_count": len(steps)}),
                time.time(),
            ),
        )
        conn.commit()
        return lead_id
    finally:
        conn.close()


def record_event(
    db_path: str,
    event_type: str,
    payload: dict[str, Any],
    *,
    lead_id: int | None = None,
    run_id: str | None = None,
) -> None:
    init_db(db_path)
    conn = _connect(db_path)
    try:
        conn.execute(
            "INSERT INTO events (lead_id, run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
            (lead_id, run_id, event_type, json.dumps(payload, default=str), time.time()),
        )
        conn.commit()
    finally:
        conn.close()


def resolve_lead_id_by_email(db_path: str, email: str) -> int | None:
    init_db(db_path)
    conn = _connect(db_path)
    try:
        row = conn.execute(
            "SELECT id FROM leads WHERE lower(email) = lower(?) ORDER BY id DESC LIMIT 1",
            (email.strip(),),
        ).fetchone()
        return int(row["id"]) if row else None
    finally:
        conn.close()


def _fetch_steps_for_lead_id(conn: db._Conn, lead_id: int) -> list[dict[str, Any]] | None:
    rows = conn.execute(
        """
        SELECT step_index, subject, body, delay_after_prev_days
        FROM sequence_steps
        WHERE lead_id = ?
        ORDER BY step_index ASC
        """,
        (lead_id,),
    ).fetchall()
    if not rows:
        return None
    return _steps_dicts_from_rows(list(rows))


def fetch_sequence_steps_for_latest_company_lead(db_path: str, company: str) -> list[dict[str, Any]] | None:
    """Steps from the most recent M2 lead for ``company`` that actually has ``sequence_steps`` rows."""
    company = (company or "").strip()
    if not company:
        return None
    init_db(db_path)
    conn = _connect(db_path)
    try:
        lead_row = conn.execute(
            """
            SELECT l.id FROM leads l
            WHERE lower(trim(l.company)) = lower(trim(?))
              AND EXISTS (SELECT 1 FROM sequence_steps s WHERE s.lead_id = l.id)
            ORDER BY l.id DESC
            LIMIT 1
            """,
            (company,),
        ).fetchone()
        if lead_row:
            return _fetch_steps_for_lead_id(conn, int(lead_row["id"]))
        fp = company_match_fingerprint(company)
        if not fp:
            return None
        rows = conn.execute(
            """
            SELECT l.id, l.company FROM leads l
            WHERE EXISTS (SELECT 1 FROM sequence_steps s WHERE s.lead_id = l.id)
            ORDER BY l.id DESC
            LIMIT 400
            """
        ).fetchall()
        for r in rows:
            if company_match_fingerprint(str(r["company"] or "")) == fp:
                return _fetch_steps_for_lead_id(conn, int(r["id"]))
        return None
    finally:
        conn.close()


def fetch_sequence_steps_for_contact_emails(
    db_path: str,
    emails: list[str],
    *,
    account_company: str | None = None,
    account_website: str | None = None,
) -> list[dict[str, Any]] | None:
    """M2 sequence steps for a cockpit contact list.

    When ``account_company`` / ``account_website`` are set, only returns steps for a lead
    that matches that account (fingerprint company and/or website domain from payload).
    Otherwise keeps legacy behavior: first M2 row with that email that has steps.
    """
    init_db(db_path)
    conn = _connect(db_path)
    try:
        strict = bool((account_company or "").strip() or (account_website or "").strip())
        for raw in emails:
            e = (raw or "").strip()
            if not e:
                continue
            if not strict:
                row = conn.execute(
                    """
                    SELECT id FROM leads
                    WHERE lower(email) = lower(?)
                    ORDER BY id DESC
                    LIMIT 1
                    """,
                    (e,),
                ).fetchone()
                if not row:
                    continue
                steps = _fetch_steps_for_lead_id(conn, int(row["id"]))
                if steps:
                    return steps
                continue
            cand = conn.execute(
                """
                SELECT l.id, l.company, l.payload_json
                FROM leads l
                WHERE lower(l.email) = lower(?)
                  AND EXISTS (SELECT 1 FROM sequence_steps s WHERE s.lead_id = l.id)
                ORDER BY l.id DESC
                LIMIT 40
                """,
                (e,),
            ).fetchall()
            best_id: int | None = None
            best_score = -1
            for r in cand:
                sc = _lead_matches_account_score(
                    str(r["company"] or ""),
                    str(r["payload_json"] or "") if r["payload_json"] is not None else None,
                    (account_company or "").strip(),
                    (account_website or "").strip(),
                )
                if sc > best_score:
                    best_score = sc
                    best_id = int(r["id"])
            if best_id is not None and best_score >= 3:
                steps = _fetch_steps_for_lead_id(conn, best_id)
                if steps:
                    return steps
        return None
    finally:
        conn.close()


def aggregate_stats(db_path: str, run_id: str | None = None) -> dict[str, Any]:
    init_db(db_path)
    conn = _connect(db_path)
    try:
        if run_id:
            lead_total = conn.execute(
                "SELECT COUNT(*) AS c FROM leads WHERE run_id = ?", (run_id,)
            ).fetchone()["c"]
            ev_where = "run_id = ?"
            ev_arg: tuple[Any, ...] = (run_id,)
        else:
            lead_total = conn.execute("SELECT COUNT(*) AS c FROM leads").fetchone()["c"]
            ev_where = "1=1"
            ev_arg = ()

        def count_event(t: str) -> int:
            row = conn.execute(
                f"SELECT COUNT(*) AS c FROM events WHERE {ev_where} AND event_type = ?",
                (*ev_arg, t),
            ).fetchone()
            return int(row["c"])

        opens = count_event("open") + count_event("email_opened")
        replies = count_event("reply") + count_event("email_replied")
        bounces = count_event("bounce") + count_event("email_bounced")
        sent = count_event("instantly_pushed") + count_event("smtp_sent")
        drafts = count_event("draft_ready")

        def rate(num: int, den: int) -> float | None:
            if den <= 0:
                return None
            return round(100.0 * num / den, 2)

        sent_denom = sent
        return {
            "leads_total": int(lead_total),
            "drafts_recorded": int(drafts),
            "sent_or_pushed": int(sent),
            "opens": int(opens),
            "replies": int(replies),
            "bounces": int(bounces),
            "open_rate_pct": rate(opens, sent_denom),
            "reply_rate_pct": rate(replies, sent_denom),
            "bounce_rate_pct": rate(bounces, sent_denom),
            "run_id": run_id,
            "updated_at": time.time(),
        }
    finally:
        conn.close()
