"""Sample-download lead capture for the winthedayplanner.net landing page.

Visitors who request the free sample planner PDF land here: the public
``POST /api/public/sample-request`` endpoint (cockpit_api) validates the
submission and stores it in ``sample_leads`` so the cockpit can list them.
"""

from __future__ import annotations

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
            CREATE TABLE IF NOT EXISTS sample_leads (
                id BIGSERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                phone TEXT NOT NULL DEFAULT '',
                school TEXT NOT NULL DEFAULT '',
                role TEXT NOT NULL DEFAULT '',
                students_count TEXT NOT NULL DEFAULT '',
                school_type TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                grant_interest BOOLEAN NOT NULL DEFAULT FALSE,
                source TEXT NOT NULL DEFAULT '',
                ip TEXT NOT NULL DEFAULT '',
                user_agent TEXT NOT NULL DEFAULT '',
                created_at DOUBLE PRECISION NOT NULL
            )
            """
        )
        # Earlier releases shipped `organization` and no phone/district fields.
        # Bring older tables up to the current shape without touching any rows.
        for col in (
            "phone TEXT NOT NULL DEFAULT ''",
            "school TEXT NOT NULL DEFAULT ''",
            "students_count TEXT NOT NULL DEFAULT ''",
            "school_type TEXT NOT NULL DEFAULT ''",
            "notes TEXT NOT NULL DEFAULT ''",
            "grant_interest BOOLEAN NOT NULL DEFAULT FALSE",
        ):
            c.execute(f"ALTER TABLE sample_leads ADD COLUMN IF NOT EXISTS {col}")
        if _has_column(c, "organization"):
            c.execute("UPDATE sample_leads SET school = organization WHERE school = '' AND organization <> ''")
        c.commit()
    finally:
        c.close()


def _has_column(c: "db._Conn", column: str) -> bool:
    row = c.execute(
        "SELECT 1 FROM information_schema.columns WHERE table_name='sample_leads' AND column_name=?",
        (column,),
    ).fetchone()
    return bool(row)


def add_lead(
    *,
    name: str,
    email: str,
    phone: str = "",
    school: str = "",
    role: str = "",
    students_count: str = "",
    school_type: str = "",
    notes: str = "",
    grant_interest: bool = False,
    source: str = "",
    ip: str = "",
    user_agent: str = "",
) -> int:
    c = _conn()
    try:
        cur = c.execute(
            """
            INSERT INTO sample_leads
                (name, email, phone, school, role, students_count, school_type,
                 notes, grant_interest, source, ip, user_agent, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
            """,
            (name, email, phone, school, role, students_count, school_type,
             notes, grant_interest, source, ip, user_agent, time.time()),
        )
        lead_id = int(cur.fetchone()["id"])
        c.commit()
        return lead_id
    finally:
        c.close()


def list_leads(limit: int = 500) -> list[dict[str, Any]]:
    c = _conn()
    try:
        rows = c.execute(
            "SELECT * FROM sample_leads ORDER BY created_at DESC LIMIT ?",
            (int(limit),),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        c.close()
