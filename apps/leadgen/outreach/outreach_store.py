"""Multi-inbox + campaign persistence for the outreach module.

Tables live in the cockpit Postgres DB so the dashboard reads them directly.
- ``outreach_inboxes``: sender mailboxes (Mailu), each with its own SMTP/IMAP
  creds, daily cap, warm-up status, and health. Sending rotates across these.
- ``outreach_campaigns``: a named send campaign with assigned inboxes.
Sequences (``email_sequences``) gain ``inbox_id`` + ``campaign_id`` links.
"""

from __future__ import annotations

import json
import time
from typing import Any

from outreach import db


def _conn() -> "db._Conn":
    return db.connect()


def init_db() -> None:
    c = _conn()
    try:
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS outreach_inboxes (
                id BIGSERIAL PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                domain TEXT,
                from_name TEXT,
                smtp_host TEXT,
                smtp_port INTEGER DEFAULT 465,
                smtp_ssl INTEGER DEFAULT 1,
                smtp_user TEXT,
                smtp_password TEXT,
                imap_host TEXT,
                imap_port INTEGER DEFAULT 993,
                daily_cap INTEGER DEFAULT 25,
                warmup_status TEXT DEFAULT 'pending',
                health_status TEXT DEFAULT 'unknown',
                enabled INTEGER DEFAULT 1,
                created_at DOUBLE PRECISION NOT NULL
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS outreach_campaigns (
                id BIGSERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                inbox_ids TEXT DEFAULT '[]',
                daily_limit INTEGER DEFAULT 50,
                note TEXT,
                created_at DOUBLE PRECISION NOT NULL,
                updated_at DOUBLE PRECISION
            )
            """
        )
        # Link sequences to a sending inbox + campaign; per-inbox send log column.
        c.execute("ALTER TABLE email_sequences ADD COLUMN IF NOT EXISTS inbox_id INTEGER")
        c.execute("ALTER TABLE email_sequences ADD COLUMN IF NOT EXISTS campaign_id INTEGER")
        c.execute("ALTER TABLE email_sequences ADD COLUMN IF NOT EXISTS replied INTEGER DEFAULT 0")
        c.execute("ALTER TABLE email_send_log ADD COLUMN IF NOT EXISTS inbox_email TEXT")
        c.commit()
    finally:
        c.close()


# --- inboxes ---

def upsert_inbox(inbox: dict[str, Any]) -> None:
    c = _conn()
    try:
        existing = c.execute("SELECT id FROM outreach_inboxes WHERE email=?", (inbox["email"],)).fetchone()
        if existing:
            c.execute(
                """UPDATE outreach_inboxes SET domain=?, from_name=?, smtp_host=?, smtp_port=?, smtp_ssl=?,
                   smtp_user=?, smtp_password=?, imap_host=?, imap_port=?, daily_cap=? WHERE email=?""",
                (
                    inbox.get("domain"), inbox.get("from_name"), inbox.get("smtp_host"),
                    inbox.get("smtp_port", 465), inbox.get("smtp_ssl", 1), inbox.get("smtp_user"),
                    inbox.get("smtp_password"), inbox.get("imap_host"), inbox.get("imap_port", 993),
                    inbox.get("daily_cap", 25), inbox["email"],
                ),
            )
        else:
            c.execute(
                """INSERT INTO outreach_inboxes
                   (email, domain, from_name, smtp_host, smtp_port, smtp_ssl, smtp_user, smtp_password,
                    imap_host, imap_port, daily_cap, warmup_status, health_status, enabled, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    inbox["email"], inbox.get("domain"), inbox.get("from_name"), inbox.get("smtp_host"),
                    inbox.get("smtp_port", 465), inbox.get("smtp_ssl", 1), inbox.get("smtp_user") or inbox["email"],
                    inbox.get("smtp_password"), inbox.get("imap_host"), inbox.get("imap_port", 993),
                    inbox.get("daily_cap", 25), inbox.get("warmup_status", "pending"),
                    inbox.get("health_status", "unknown"), 1, time.time(),
                ),
            )
        c.commit()
    finally:
        c.close()


def list_inboxes(include_secrets: bool = False) -> list[dict[str, Any]]:
    c = _conn()
    try:
        rows = c.execute("SELECT * FROM outreach_inboxes ORDER BY id").fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["sends_today"] = sends_today(d["email"])
            if not include_secrets:
                d.pop("smtp_password", None)
            out.append(d)
        return out
    finally:
        c.close()


def get_inbox(inbox_id: int, include_secrets: bool = True) -> dict[str, Any] | None:
    c = _conn()
    try:
        r = c.execute("SELECT * FROM outreach_inboxes WHERE id=?", (inbox_id,)).fetchone()
        if not r:
            return None
        d = dict(r)
        if not include_secrets:
            d.pop("smtp_password", None)
        return d
    finally:
        c.close()


def update_inbox(inbox_id: int, fields: dict[str, Any]) -> None:
    allowed = {"warmup_status", "health_status", "enabled", "daily_cap", "from_name"}
    sets = {k: v for k, v in fields.items() if k in allowed}
    if not sets:
        return
    c = _conn()
    try:
        cols = ", ".join(f"{k}=?" for k in sets)
        c.execute(f"UPDATE outreach_inboxes SET {cols} WHERE id=?", (*sets.values(), inbox_id))
        c.commit()
    finally:
        c.close()


def sends_today(inbox_email: str) -> int:
    c = _conn()
    try:
        r = c.execute(
            "SELECT COUNT(*) AS n FROM email_send_log WHERE inbox_email=? AND ts >= ?",
            (inbox_email, time.time() - 86400),
        ).fetchone()
        return int(r["n"]) if r else 0
    finally:
        c.close()


def pick_send_inbox(assigned_ids: list[int] | None = None, require_warmed: bool = True) -> dict[str, Any] | None:
    """Least-recently-used enabled inbox that is under its daily cap (and warmed)."""
    c = _conn()
    try:
        rows = c.execute("SELECT * FROM outreach_inboxes WHERE enabled=1 ORDER BY id").fetchall()
    finally:
        c.close()
    cands = []
    for r in rows:
        d = dict(r)
        if assigned_ids and d["id"] not in assigned_ids:
            continue
        if require_warmed and d.get("warmup_status") != "warmed":
            continue
        used = sends_today(d["email"])
        if used >= (d.get("daily_cap") or 25):
            continue
        d["sends_today"] = used
        cands.append(d)
    if not cands:
        return None
    # least used first (spreads volume)
    cands.sort(key=lambda x: x["sends_today"])
    return cands[0]


# --- campaigns ---

def create_campaign(name: str, inbox_ids: list[int], daily_limit: int = 50, note: str = "") -> int:
    c = _conn()
    try:
        cur = c.execute(
            "INSERT INTO outreach_campaigns (name, status, inbox_ids, daily_limit, note, created_at) VALUES (?,?,?,?,?,?) RETURNING id",
            (name, "draft", json.dumps(inbox_ids), daily_limit, note, time.time()),
        )
        cid = int(cur.fetchone()["id"])
        c.commit()
        return cid
    finally:
        c.close()


def list_campaigns() -> list[dict[str, Any]]:
    c = _conn()
    try:
        rows = c.execute("SELECT * FROM outreach_campaigns ORDER BY id DESC").fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["inbox_ids"] = json.loads(d.get("inbox_ids") or "[]")
            seqs = c.execute(
                "SELECT COUNT(*) AS n, SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent, "
                "SUM(CASE WHEN replied=1 THEN 1 ELSE 0 END) AS replied FROM email_sequences WHERE campaign_id=?",
                (d["id"],),
            ).fetchone()
            d["leads"] = int(seqs["n"] or 0)
            d["sent"] = int(seqs["sent"] or 0)
            d["replied"] = int(seqs["replied"] or 0)
            out.append(d)
        return out
    finally:
        c.close()


def get_campaign(campaign_id: int) -> dict[str, Any] | None:
    c = _conn()
    try:
        r = c.execute("SELECT * FROM outreach_campaigns WHERE id=?", (campaign_id,)).fetchone()
        if not r:
            return None
        d = dict(r)
        d["inbox_ids"] = json.loads(d.get("inbox_ids") or "[]")
        return d
    finally:
        c.close()


def set_campaign_status(campaign_id: int, status: str) -> None:
    c = _conn()
    try:
        c.execute("UPDATE outreach_campaigns SET status=?, updated_at=? WHERE id=?", (status, time.time(), campaign_id))
        c.commit()
    finally:
        c.close()
