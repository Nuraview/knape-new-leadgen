"""The client's own judgement on a lead, stored beside the model's ICP score.

Keyed on ``normalize_company_key(company)`` rather than ``accounts.id``. That is
not a stylistic choice: the sync paths rebuild the accounts table with DELETE +
INSERT on every scrape, so account ids are reassigned and anything stored
against them would silently vanish the next time the pipeline ran. The company
key is the identity the lead records already dedupe on, so a rating a client
gave in March still points at the same company in August.

The table is created in ``cockpit_api._init_db``; this module only reads/writes.
"""

from __future__ import annotations

import time
from typing import Any

from outreach import db
from utils.exclusions import normalize_company_key

#: The client's 0–10 verdict. 0 is a real rating ("useless"), which is why the
#: column is nullable and "unrated" is NULL rather than 0.
RATING_MIN = 0
RATING_MAX = 10


def key_for(company: str) -> str:
    return normalize_company_key(str(company or "").strip())


def clamp_rating(value: Any) -> int | None:
    """Coerce to an int in 0–10, or None to mean "no rating"."""
    if value is None or value == "":
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return max(RATING_MIN, min(RATING_MAX, n))


def get_rating(company: str) -> dict[str, Any] | None:
    key = key_for(company)
    if not key:
        return None
    conn = db.connect()
    try:
        row = conn.execute(
            "SELECT rating, rated_by, rated_at FROM lead_feedback WHERE lead_key = ?", (key,)
        ).fetchone()
        if not row or row.get("rating") is None:
            return None
        return {
            "rating": int(row["rating"]),
            "rated_by": str(row.get("rated_by") or ""),
            "rated_at": float(row.get("rated_at") or 0),
        }
    finally:
        conn.close()


def set_rating(company: str, rating: Any, *, rated_by: str = "") -> dict[str, Any] | None:
    """Store (or clear, when ``rating`` is None) the client's score for a company."""
    key = key_for(company)
    if not key:
        return None
    value = clamp_rating(rating)
    now = time.time()
    conn = db.connect()
    try:
        conn.execute(
            "INSERT INTO lead_feedback (lead_key, company, rating, rated_by, rated_at) "
            "VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT (lead_key) DO UPDATE SET "
            "company = excluded.company, rating = excluded.rating, "
            "rated_by = excluded.rated_by, rated_at = excluded.rated_at",
            (key, str(company or "").strip(), value, rated_by, now),
        )
        conn.commit()
    finally:
        conn.close()
    if value is None:
        return None
    return {"rating": value, "rated_by": rated_by, "rated_at": now}


def ratings_by_key() -> dict[str, int]:
    """Every stored rating, for bulk-joining onto a page of accounts."""
    conn = db.connect()
    try:
        rows = conn.execute(
            "SELECT lead_key, rating FROM lead_feedback WHERE rating IS NOT NULL"
        ).fetchall()
        return {str(r["lead_key"]): int(r["rating"]) for r in rows}
    finally:
        conn.close()


def rating_summary() -> dict[str, Any]:
    """Headline numbers for the dashboard: how many rated, and how highly."""
    conn = db.connect()
    try:
        row = conn.execute(
            "SELECT COUNT(*) AS rated, AVG(rating) AS avg_rating, "
            "COUNT(*) FILTER (WHERE rating >= 8) AS top_rated "
            "FROM lead_feedback WHERE rating IS NOT NULL"
        ).fetchone()
        avg = row.get("avg_rating") if row else None
        return {
            "rated": int((row or {}).get("rated") or 0),
            "top_rated": int((row or {}).get("top_rated") or 0),
            "avg_rating": round(float(avg), 1) if avg is not None else None,
        }
    finally:
        conn.close()
