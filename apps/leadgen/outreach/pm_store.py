"""Persistence for the Project Management board (Trello-lite kanban).

Jul-20 client call: Peter won't use Trello as a separate app, so a simple
board lives inside the cockpit. Fixed columns mirroring his Trello board;
cards carry a title, description and a chronological timeline of comments +
activity (created / moved / edited) in one table.

Ordering: fractional ``position`` per column. New cards append at max+1024; a
drag places the card at the midpoint of its destination neighbours. The
neighbours are sent as CARD IDS and the midpoint is computed here — the client
never sends a raw position — so concurrent drags cannot corrupt each other.
When a gap collapses the column is renumbered 1024, 2048, …
"""

from __future__ import annotations

import json
import time
from typing import Any

from outreach import db

# Column vocabulary (kept in code, not a table — matches how the cockpit
# handles other small vocabularies). Labels live in the frontend.
PM_COLUMNS = (
    "new",
    "in_progress",
    "ready_for_review",
    "revision_requested",
    "approved_cancelled",
    "on_hold",
)

# Trello-style fixed label palette; cards store a JSON array of these keys.
PM_LABELS = ("green", "yellow", "orange", "red", "purple", "blue")

# Event kinds on pm_card_events: comment | created | moved | updated
_STEP = 1024.0
_EPSILON = 1e-6


def _conn() -> db._Conn:
    return db.connect()


def init_db() -> None:
    c = _conn()
    try:
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS pm_cards (
                id BIGSERIAL PRIMARY KEY,
                column_key TEXT NOT NULL DEFAULT 'new',
                position DOUBLE PRECISION NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                created_by TEXT,
                archived_at DOUBLE PRECISION,
                created_at DOUBLE PRECISION NOT NULL,
                updated_at DOUBLE PRECISION NOT NULL
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS pm_card_events (
                id BIGSERIAL PRIMARY KEY,
                card_id INTEGER NOT NULL,
                kind TEXT NOT NULL DEFAULT 'comment',
                body TEXT,
                from_column TEXT,
                to_column TEXT,
                field TEXT,
                actor TEXT,
                created_at DOUBLE PRECISION NOT NULL
            )
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_pm_cards_col ON pm_cards(column_key, position)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_pm_card_events_card ON pm_card_events(card_id, created_at)")
        # Trello-core additions (Jul-21): labels, due date, checklist.
        c.execute("ALTER TABLE pm_cards ADD COLUMN IF NOT EXISTS due_at DOUBLE PRECISION")
        c.execute("ALTER TABLE pm_cards ADD COLUMN IF NOT EXISTS labels TEXT")
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS pm_checklist_items (
                id BIGSERIAL PRIMARY KEY,
                card_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                done BOOLEAN NOT NULL DEFAULT FALSE,
                position DOUBLE PRECISION NOT NULL,
                created_at DOUBLE PRECISION NOT NULL
            )
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_pm_checklist_card ON pm_checklist_items(card_id, position)")
        c.commit()
    finally:
        c.close()


def _parse_labels(raw: Any) -> list[str]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        return [str(x) for x in parsed if str(x) in PM_LABELS]
    except (ValueError, TypeError):
        return []


def _card_out(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    out["labels"] = _parse_labels(out.get("labels"))
    return out


def list_cards() -> list[dict[str, Any]]:
    """All live cards ordered by (column, position), with comment + checklist counts."""
    c = _conn()
    try:
        rows = c.execute(
            """
            SELECT p.*, COALESCE(cc.n, 0) AS comment_count,
                   COALESCE(cl.total, 0) AS checklist_total,
                   COALESCE(cl.done, 0) AS checklist_done
            FROM pm_cards p
            LEFT JOIN (
                SELECT card_id, COUNT(*) AS n
                FROM pm_card_events
                WHERE kind = 'comment'
                GROUP BY card_id
            ) cc ON cc.card_id = p.id
            LEFT JOIN (
                SELECT card_id, COUNT(*) AS total,
                       COUNT(*) FILTER (WHERE done) AS done
                FROM pm_checklist_items
                GROUP BY card_id
            ) cl ON cl.card_id = p.id
            WHERE p.archived_at IS NULL
            ORDER BY p.column_key, p.position
            """
        ).fetchall()
        return [_card_out(r) for r in rows]
    finally:
        c.close()


def get_card(card_id: int) -> dict[str, Any] | None:
    """One card + full event timeline (ascending) + checklist items (in order)."""
    c = _conn()
    try:
        row = c.execute("SELECT * FROM pm_cards WHERE id=?", (card_id,)).fetchone()
        if not row:
            return None
        events = c.execute(
            "SELECT * FROM pm_card_events WHERE card_id=? ORDER BY created_at, id",
            (card_id,),
        ).fetchall()
        checklist = c.execute(
            "SELECT * FROM pm_checklist_items WHERE card_id=? ORDER BY position, id",
            (card_id,),
        ).fetchall()
        return {
            "card": _card_out(row),
            "events": [dict(e) for e in events],
            "checklist": [dict(i) for i in checklist],
        }
    finally:
        c.close()


def create_card(
    title: str,
    description: str | None,
    column_key: str,
    actor: str,
) -> dict[str, Any]:
    title = title.strip()
    if not title:
        raise ValueError("Title is required")
    if column_key not in PM_COLUMNS:
        raise ValueError(f"Unknown column: {column_key}")
    now = time.time()
    c = _conn()
    try:
        max_row = c.execute(
            "SELECT MAX(position) AS m FROM pm_cards WHERE column_key=? AND archived_at IS NULL",
            (column_key,),
        ).fetchone()
        position = float(max_row["m"] or 0.0) + _STEP
        cur = c.execute(
            """
            INSERT INTO pm_cards (column_key, position, title, description, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (column_key, position, title, (description or "").strip() or None, actor, now, now),
        )
        card_id = int(cur.fetchone()["id"])
        c.execute(
            "INSERT INTO pm_card_events (card_id, kind, to_column, actor, created_at) VALUES (?, 'created', ?, ?, ?)",
            (card_id, column_key, actor, now),
        )
        c.commit()
        row = c.execute("SELECT * FROM pm_cards WHERE id=?", (card_id,)).fetchone()
        return _card_out(row)
    finally:
        c.close()


def update_card(card_id: int, patch: dict[str, Any], actor: str) -> dict[str, Any]:
    """Apply the provided fields (title / description / due_at / labels) and log
    an 'updated' event per changed field. A key absent from ``patch`` is left
    unchanged; ``description=None`` clears it, ``due_at=None`` clears the date.
    """
    now = time.time()
    c = _conn()
    try:
        row = c.execute("SELECT * FROM pm_cards WHERE id=?", (card_id,)).fetchone()
        if not row:
            raise LookupError("Card not found")
        sets: dict[str, Any] = {}
        if "title" in patch:
            title = str(patch["title"] or "").strip()
            if title and title != row["title"]:
                sets["title"] = title
        if "description" in patch:
            desc = (str(patch["description"]).strip() or None) if patch["description"] is not None else None
            if desc != row["description"]:
                sets["description"] = desc
        if "due_at" in patch:
            due = float(patch["due_at"]) if patch["due_at"] is not None else None
            if due != row.get("due_at"):
                sets["due_at"] = due
        if "labels" in patch:
            labels = [str(x) for x in (patch["labels"] or [])]
            bad = [x for x in labels if x not in PM_LABELS]
            if bad:
                raise ValueError(f"Unknown label: {bad[0]}")
            new_json = json.dumps(labels)
            if _parse_labels(row.get("labels")) != labels:
                sets["labels"] = new_json
        if sets:
            assigns = ", ".join(f"{k}=?" for k in sets)
            c.execute(
                f"UPDATE pm_cards SET {assigns}, updated_at=? WHERE id=?",
                (*sets.values(), now, card_id),
            )
            for field in sets:
                c.execute(
                    "INSERT INTO pm_card_events (card_id, kind, field, actor, created_at) VALUES (?, 'updated', ?, ?, ?)",
                    (card_id, "due date" if field == "due_at" else field, actor, now),
                )
            c.commit()
        out = c.execute("SELECT * FROM pm_cards WHERE id=?", (card_id,)).fetchone()
        return _card_out(out)
    finally:
        c.close()


def add_checklist_item(card_id: int, text: str) -> dict[str, Any]:
    text = text.strip()
    if not text:
        raise ValueError("Checklist item cannot be empty")
    now = time.time()
    c = _conn()
    try:
        if not c.execute("SELECT id FROM pm_cards WHERE id=?", (card_id,)).fetchone():
            raise LookupError("Card not found")
        max_row = c.execute(
            "SELECT MAX(position) AS m FROM pm_checklist_items WHERE card_id=?", (card_id,)
        ).fetchone()
        cur = c.execute(
            "INSERT INTO pm_checklist_items (card_id, text, position, created_at) VALUES (?, ?, ?, ?) RETURNING id",
            (card_id, text, float(max_row["m"] or 0.0) + _STEP, now),
        )
        item_id = int(cur.fetchone()["id"])
        c.commit()
        out = c.execute("SELECT * FROM pm_checklist_items WHERE id=?", (item_id,)).fetchone()
        return dict(out)
    finally:
        c.close()


def update_checklist_item(item_id: int, done: bool | None, text: str | None) -> dict[str, Any]:
    c = _conn()
    try:
        row = c.execute("SELECT * FROM pm_checklist_items WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise LookupError("Checklist item not found")
        new_done = row["done"] if done is None else bool(done)
        new_text = row["text"]
        if text is not None and text.strip():
            new_text = text.strip()
        c.execute(
            "UPDATE pm_checklist_items SET done=?, text=? WHERE id=?",
            (new_done, new_text, item_id),
        )
        c.commit()
        out = c.execute("SELECT * FROM pm_checklist_items WHERE id=?", (item_id,)).fetchone()
        return dict(out)
    finally:
        c.close()


def delete_checklist_item(item_id: int) -> None:
    c = _conn()
    try:
        cur = c.execute("DELETE FROM pm_checklist_items WHERE id=?", (item_id,))
        if cur.rowcount == 0:
            raise LookupError("Checklist item not found")
        c.commit()
    finally:
        c.close()


def move_card(
    card_id: int,
    to_column: str,
    after_card_id: int | None,
    before_card_id: int | None,
    actor: str,
) -> dict[str, Any]:
    """Place the card in ``to_column`` between its new neighbours.

    ``after_card_id`` = the card directly above in the new order,
    ``before_card_id`` = the card directly below. Either may be None at the
    edges. Stale neighbours (moved elsewhere meanwhile) degrade to an edge
    placement instead of failing the drag.
    """
    if to_column not in PM_COLUMNS:
        raise ValueError(f"Unknown column: {to_column}")
    now = time.time()
    c = _conn()
    try:
        row = c.execute("SELECT * FROM pm_cards WHERE id=?", (card_id,)).fetchone()
        if not row:
            raise LookupError("Card not found")
        from_column = str(row["column_key"])

        def neighbour_pos(nid: int | None) -> float | None:
            if nid is None:
                return None
            n = c.execute(
                "SELECT position, column_key FROM pm_cards WHERE id=? AND archived_at IS NULL",
                (nid,),
            ).fetchone()
            if not n or n["column_key"] != to_column:
                return None
            return float(n["position"])

        def reindex() -> None:
            rows = c.execute(
                "SELECT id FROM pm_cards WHERE column_key=? AND archived_at IS NULL ORDER BY position",
                (to_column,),
            ).fetchall()
            for i, r in enumerate(rows):
                c.execute("UPDATE pm_cards SET position=? WHERE id=?", ((i + 1) * _STEP, r["id"]))

        after_pos = neighbour_pos(after_card_id)
        before_pos = neighbour_pos(before_card_id)
        if after_pos is not None and before_pos is not None:
            if abs(before_pos - after_pos) < _EPSILON:
                reindex()
                after_pos = neighbour_pos(after_card_id)
                before_pos = neighbour_pos(before_card_id)
        if after_pos is not None and before_pos is not None:
            position = (after_pos + before_pos) / 2.0
        elif after_pos is not None:
            position = after_pos + _STEP
        elif before_pos is not None:
            position = before_pos - _STEP / 2.0
        else:
            max_row = c.execute(
                "SELECT MAX(position) AS m FROM pm_cards WHERE column_key=? AND archived_at IS NULL",
                (to_column,),
            ).fetchone()
            position = float(max_row["m"] or 0.0) + _STEP

        c.execute(
            "UPDATE pm_cards SET column_key=?, position=?, updated_at=? WHERE id=?",
            (to_column, position, now, card_id),
        )
        if from_column != to_column:
            c.execute(
                "INSERT INTO pm_card_events (card_id, kind, from_column, to_column, actor, created_at) "
                "VALUES (?, 'moved', ?, ?, ?, ?)",
                (card_id, from_column, to_column, actor, now),
            )
        c.commit()
        out = c.execute("SELECT * FROM pm_cards WHERE id=?", (card_id,)).fetchone()
        return _card_out(out)
    finally:
        c.close()


def add_comment(card_id: int, body: str, actor: str) -> dict[str, Any]:
    body = body.strip()
    if not body:
        raise ValueError("Comment cannot be empty")
    now = time.time()
    c = _conn()
    try:
        row = c.execute("SELECT id FROM pm_cards WHERE id=?", (card_id,)).fetchone()
        if not row:
            raise LookupError("Card not found")
        cur = c.execute(
            "INSERT INTO pm_card_events (card_id, kind, body, actor, created_at) "
            "VALUES (?, 'comment', ?, ?, ?) RETURNING id",
            (card_id, body, actor, now),
        )
        event_id = int(cur.fetchone()["id"])
        c.commit()
        out = c.execute("SELECT * FROM pm_card_events WHERE id=?", (event_id,)).fetchone()
        return dict(out)
    finally:
        c.close()


def archive_card(card_id: int) -> None:
    """Soft delete — the card leaves the board, its history stays."""
    now = time.time()
    c = _conn()
    try:
        cur = c.execute(
            "UPDATE pm_cards SET archived_at=?, updated_at=? WHERE id=? AND archived_at IS NULL",
            (now, now, card_id),
        )
        if cur.rowcount == 0:
            raise LookupError("Card not found")
        c.commit()
    finally:
        c.close()
