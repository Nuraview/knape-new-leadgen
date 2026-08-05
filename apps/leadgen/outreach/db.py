"""Postgres connection layer (psycopg 3) exposed as a sqlite3-compatible shim.

The cockpit/outreach persistence modules were written against the stdlib
``sqlite3`` surface: ``conn.execute(sql, params)`` returns a cursor you can
``.fetchone()`` / ``.fetchall()`` / iterate, plus ``conn.commit()`` and
``conn.close()``. This module backs that same surface with a Postgres database
(``DATABASE_URL``) so the call sites needed only minimal edits.

What this shim handles:
- ``?`` placeholders are rewritten to psycopg's ``%s`` at execute time. (Our SQL
  never contains a literal ``%`` — LIKE patterns are passed as parameters — so a
  plain positional swap is correct.)
- Rows come back as dicts (``dict_row``), so ``row["col"]`` and ``dict(row)`` keep
  working exactly as they did with ``sqlite3.Row``.
- ``executescript`` runs a multi-statement DDL block (split on ``;``).

What changed at the call sites instead of here:
- There is no ``lastrowid``. Inserts that need the new id use
  ``INSERT ... RETURNING id`` and read ``cur.fetchone()["id"]``.
- SQLite ``instr(h, n) > 0`` became Postgres ``strpos(h, n) > 0`` (same arg order).
"""

from __future__ import annotations

from typing import Any, Sequence

import psycopg
from psycopg.rows import dict_row

from config import DATABASE_URL


def _translate(sql: str) -> str:
    return sql.replace("?", "%s")


class _Conn:
    """A thin ``sqlite3.Connection``-compatible wrapper over a psycopg connection."""

    def __init__(self, raw: "psycopg.Connection[Any]") -> None:
        self._raw = raw

    def execute(self, sql: str, params: Sequence[Any] | None = ()) -> "psycopg.Cursor[Any]":
        cur = self._raw.cursor()
        cur.execute(_translate(sql), tuple(params) if params else None)
        return cur

    def executescript(self, script: str) -> None:
        for stmt in script.split(";"):
            if stmt.strip():
                self._raw.execute(_translate(stmt))

    def commit(self) -> None:
        self._raw.commit()

    def close(self) -> None:
        self._raw.close()


def connect() -> _Conn:
    """Open a new Postgres connection with dict rows (caller commits + closes)."""
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set — cannot connect to Postgres")
    raw = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    return _Conn(raw)
