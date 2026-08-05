"""Project-management (Trello-like) store: cards + timeline comments.

A deliberately simple in-dashboard kanban so the client reviews work here
instead of onboarding to Trello. Fixed six columns (mirrors their real Trello
board); cards carry title + description; comments render as a timeline.
Mirrors the ``outreach_store`` conventions (``db.connect`` shim, idempotent
``init_db``, INSERT … RETURNING id, whitelisted partial updates).
"""

from __future__ import annotations

import json
import time
from typing import Any

from outreach import db

# Fixed board columns (key, display title) — order matters.
COLUMNS: list[tuple[str, str]] = [
    ("new", "New Projects"),
    ("in_progress", "In Progress"),
    ("ready_for_review", "Ready for Review"),
    ("revision_requested", "Revision Requested"),
    ("approved_cancelled", "Approved / Cancelled"),
    ("on_hold", "On Hold"),
]
_COLUMN_KEYS = {k for k, _ in COLUMNS}


def _conn() -> db._Conn:
    return db.connect()


def init_db() -> None:
    c = _conn()
    try:
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS pm_cards (
                id BIGSERIAL PRIMARY KEY,
                column_key TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                position DOUBLE PRECISION NOT NULL DEFAULT 0,
                created_at DOUBLE PRECISION NOT NULL,
                updated_at DOUBLE PRECISION NOT NULL
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS pm_comments (
                id BIGSERIAL PRIMARY KEY,
                card_id INTEGER NOT NULL,
                author TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL,
                created_at DOUBLE PRECISION NOT NULL
            )
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_pm_comments_card ON pm_comments(card_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_pm_cards_column ON pm_cards(column_key)")
        # Trello-core card features (idempotent adds for existing installs).
        c.execute("ALTER TABLE pm_cards ADD COLUMN IF NOT EXISTS labels TEXT NOT NULL DEFAULT '[]'")
        c.execute("ALTER TABLE pm_cards ADD COLUMN IF NOT EXISTS due_at DOUBLE PRECISION")
        c.execute("ALTER TABLE pm_comments ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'comment'")
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS pm_checklist (
                id BIGSERIAL PRIMARY KEY,
                card_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                done INTEGER NOT NULL DEFAULT 0,
                position DOUBLE PRECISION NOT NULL DEFAULT 0
            )
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_pm_checklist_card ON pm_checklist(card_id)")
        c.commit()
    finally:
        c.close()


def _card_dict(r: Any) -> dict[str, Any]:
    d = dict(r)
    d["id"] = int(d["id"])
    try:
        d["labels"] = json.loads(d.get("labels") or "[]")
    except (TypeError, ValueError):
        d["labels"] = []
    return d


def list_board() -> list[dict[str, Any]]:
    """All columns (fixed order) with their cards + comment/checklist counts."""
    c = _conn()
    try:
        rows = c.execute(
            """
            SELECT p.*,
                   (SELECT COUNT(*) FROM pm_comments cm WHERE cm.card_id = p.id AND cm.kind = 'comment') AS comments_count,
                   (SELECT COUNT(*) FROM pm_checklist ck WHERE ck.card_id = p.id) AS checklist_total,
                   (SELECT COUNT(*) FROM pm_checklist ck WHERE ck.card_id = p.id AND ck.done = 1) AS checklist_done
            FROM pm_cards p
            ORDER BY p.position ASC, p.id ASC
            """
        ).fetchall()
        by_col: dict[str, list[dict[str, Any]]] = {k: [] for k, _ in COLUMNS}
        for r in rows:
            d = _card_dict(r)
            by_col.setdefault(str(d.get("column_key") or "new"), []).append(d)
        return [{"key": k, "title": t, "cards": by_col.get(k, [])} for k, t in COLUMNS]
    finally:
        c.close()


def create_card(title: str, description: str = "", column_key: str = "new") -> dict[str, Any]:
    if column_key not in _COLUMN_KEYS:
        column_key = "new"
    now = time.time()
    c = _conn()
    try:
        pos_row = c.execute(
            "SELECT COALESCE(MAX(position), 0) mx FROM pm_cards WHERE column_key = ?", (column_key,)
        ).fetchone()
        pos = float(pos_row["mx"] or 0) + 1.0
        cur = c.execute(
            """
            INSERT INTO pm_cards (column_key, title, description, position, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING id
            """,
            (column_key, title.strip(), description.strip(), pos, now, now),
        )
        card_id = int(cur.fetchone()["id"])
        c.commit()
        return get_card(card_id) or {"id": card_id}
    finally:
        c.close()


def get_card(card_id: int) -> dict[str, Any] | None:
    c = _conn()
    try:
        r = c.execute(
            """
            SELECT p.*,
                   (SELECT COUNT(*) FROM pm_comments cm WHERE cm.card_id = p.id AND cm.kind = 'comment') AS comments_count,
                   (SELECT COUNT(*) FROM pm_checklist ck WHERE ck.card_id = p.id) AS checklist_total,
                   (SELECT COUNT(*) FROM pm_checklist ck WHERE ck.card_id = p.id AND ck.done = 1) AS checklist_done
            FROM pm_cards p WHERE p.id = ?
            """,
            (card_id,),
        ).fetchone()
        return _card_dict(r) if r else None
    finally:
        c.close()


def list_comments(card_id: int) -> list[dict[str, Any]]:
    c = _conn()
    try:
        rows = c.execute(
            "SELECT * FROM pm_comments WHERE card_id = ? ORDER BY created_at ASC, id ASC", (card_id,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        c.close()


def update_card(card_id: int, fields: dict[str, Any], actor: str = "") -> dict[str, Any] | None:
    """Whitelisted partial update. ``labels`` is a list (stored as JSON);
    ``due_at`` of 0 clears the due date; a ``column_key`` change is logged as a
    timeline event ("Moved to …") attributed to ``actor``."""
    allowed = {"title", "description", "column_key", "position", "labels", "due_at"}
    sets = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if "column_key" in sets and sets["column_key"] not in _COLUMN_KEYS:
        sets.pop("column_key")
    if "labels" in sets:
        sets["labels"] = json.dumps([str(x) for x in (sets["labels"] or [])][:6])
    due_clear = "due_at" in sets and float(sets["due_at"] or 0) == 0
    if not sets:
        return get_card(card_id)
    prev = get_card(card_id)
    if prev is None:
        return None
    c = _conn()
    try:
        # Moving to a new column drops the card at that column's bottom unless an
        # explicit position was given.
        if "column_key" in sets and "position" not in sets and sets["column_key"] != prev.get("column_key"):
            pos_row = c.execute(
                "SELECT COALESCE(MAX(position), 0) mx FROM pm_cards WHERE column_key = ?",
                (sets["column_key"],),
            ).fetchone()
            sets["position"] = float(pos_row["mx"] or 0) + 1.0
        cols = ", ".join(f"{k} = ?" for k in sets)
        c.execute(
            f"UPDATE pm_cards SET {cols}, updated_at = ? WHERE id = ?",  # noqa: S608 — keys whitelisted
            (*sets.values(), time.time(), card_id),
        )
        if due_clear:
            c.execute("UPDATE pm_cards SET due_at = NULL WHERE id = ?", (card_id,))
        # Timeline event for stage moves (Trello-style activity).
        new_col = sets.get("column_key")
        if new_col and new_col != prev.get("column_key"):
            titles = dict(COLUMNS)
            c.execute(
                "INSERT INTO pm_comments (card_id, author, body, created_at, kind) VALUES (?, ?, ?, ?, 'event')",
                (
                    card_id,
                    (actor or "").strip(),
                    f"moved this card from {titles.get(str(prev.get('column_key')), '?')} to {titles.get(str(new_col), '?')}",
                    time.time(),
                ),
            )
        c.commit()
    finally:
        c.close()
    return get_card(card_id)


def delete_card(card_id: int) -> None:
    c = _conn()
    try:
        c.execute("DELETE FROM pm_comments WHERE card_id = ?", (card_id,))
        c.execute("DELETE FROM pm_checklist WHERE card_id = ?", (card_id,))
        c.execute("DELETE FROM pm_cards WHERE id = ?", (card_id,))
        c.commit()
    finally:
        c.close()


# ------------------------------ checklist ------------------------------


def list_checklist(card_id: int) -> list[dict[str, Any]]:
    c = _conn()
    try:
        rows = c.execute(
            "SELECT * FROM pm_checklist WHERE card_id = ? ORDER BY position ASC, id ASC", (card_id,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        c.close()


def add_check_item(card_id: int, text: str) -> list[dict[str, Any]]:
    c = _conn()
    try:
        pos_row = c.execute(
            "SELECT COALESCE(MAX(position), 0) mx FROM pm_checklist WHERE card_id = ?", (card_id,)
        ).fetchone()
        c.execute(
            "INSERT INTO pm_checklist (card_id, text, done, position) VALUES (?, ?, 0, ?)",
            (card_id, text.strip(), float(pos_row["mx"] or 0) + 1.0),
        )
        c.execute("UPDATE pm_cards SET updated_at = ? WHERE id = ?", (time.time(), card_id))
        c.commit()
    finally:
        c.close()
    return list_checklist(card_id)


def update_check_item(item_id: int, fields: dict[str, Any]) -> int | None:
    """Update a checklist item (text/done). Returns its card_id, or None."""
    allowed = {"text", "done"}
    sets = {k: v for k, v in fields.items() if k in allowed and v is not None}
    c = _conn()
    try:
        row = c.execute("SELECT card_id FROM pm_checklist WHERE id = ?", (item_id,)).fetchone()
        if not row:
            return None
        if sets:
            if "done" in sets:
                sets["done"] = 1 if sets["done"] else 0
            cols = ", ".join(f"{k} = ?" for k in sets)
            c.execute(
                f"UPDATE pm_checklist SET {cols} WHERE id = ?",  # noqa: S608 — keys whitelisted
                (*sets.values(), item_id),
            )
            c.execute("UPDATE pm_cards SET updated_at = ? WHERE id = ?", (time.time(), int(row["card_id"])))
            c.commit()
        return int(row["card_id"])
    finally:
        c.close()


def delete_check_item(item_id: int) -> int | None:
    c = _conn()
    try:
        row = c.execute("SELECT card_id FROM pm_checklist WHERE id = ?", (item_id,)).fetchone()
        if not row:
            return None
        c.execute("DELETE FROM pm_checklist WHERE id = ?", (item_id,))
        c.commit()
        return int(row["card_id"])
    finally:
        c.close()


def add_comment(card_id: int, author: str, body: str) -> list[dict[str, Any]]:
    c = _conn()
    try:
        c.execute(
            "INSERT INTO pm_comments (card_id, author, body, created_at) VALUES (?, ?, ?, ?)",
            (card_id, (author or "").strip(), body.strip(), time.time()),
        )
        c.execute("UPDATE pm_cards SET updated_at = ? WHERE id = ?", (time.time(), card_id))
        c.commit()
    finally:
        c.close()
    return list_comments(card_id)
