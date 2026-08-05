#!/usr/bin/env python3
"""One-time importer: copy existing SQLite rows into the Postgres database.

Usage (run after the Postgres schema exists — e.g. after the API has booted once,
or after running ``python -c "import outreach.cockpit_api as c; c._init_db()"``):

    DATABASE_URL=postgresql://... \\
      python3 scripts/sqlite_to_pg.py \\
        --cockpit outreach_data/cockpit.sqlite \\
        --milestone2 outreach_data/milestone2.sqlite

Notes:
- Columns are introspected from each SQLite table, so optional columns that were
  added by later migrations (data_batch, equipment_needs, bounce_*) are handled.
- Explicit ``id`` values are preserved; each table's identity sequence is then
  bumped past the max id so future inserts don't collide.
- ``--truncate`` empties the target tables first (FK-safe order) for re-runs.
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path

# Allow running from the repo root without installing the package.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg  # noqa: E402

# Tables per source DB, in foreign-key-safe insert order (parents first).
COCKPIT_TABLES = [
    "users",
    "sessions",
    "accounts",
    "contacts",
    "evidence",
    "sweeps",
    "email_sequences",
    "email_steps",
    "email_send_log",
]
MILESTONE2_TABLES = ["runs", "leads", "sequence_steps", "events"]

# Tables whose ``id`` is a BIGSERIAL whose sequence must be reset after import.
SERIAL_ID_TABLES = {
    "users",
    "accounts",
    "contacts",
    "evidence",
    "sweeps",
    "email_sequences",
    "email_steps",
    "email_send_log",
    "leads",
    "sequence_steps",
    "events",
}


def _sqlite_columns(scon: sqlite3.Connection, table: str) -> list[str]:
    rows = scon.execute(f"PRAGMA table_info({table})").fetchall()
    return [r[1] for r in rows]


def _table_exists(scon: sqlite3.Connection, table: str) -> bool:
    row = scon.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    return row is not None


def _copy_table(scon: sqlite3.Connection, pg: "psycopg.Connection", table: str) -> int:
    if not _table_exists(scon, table):
        print(f"  - {table}: not in SQLite, skipping")
        return 0
    cols = _sqlite_columns(scon, table)
    if not cols:
        return 0
    rows = scon.execute(f"SELECT {', '.join(cols)} FROM {table}").fetchall()
    if not rows:
        print(f"  - {table}: 0 rows")
        return 0
    collist = ", ".join(cols)
    placeholders = ", ".join(["%s"] * len(cols))
    sql = f"INSERT INTO {table} ({collist}) VALUES ({placeholders})"
    with pg.cursor() as cur:
        cur.executemany(sql, [tuple(r) for r in rows])
    print(f"  - {table}: {len(rows)} rows")
    return len(rows)


def _reset_sequence(pg: "psycopg.Connection", table: str) -> None:
    with pg.cursor() as cur:
        cur.execute(
            "SELECT setval(pg_get_serial_sequence(%s, 'id'), "
            "COALESCE((SELECT MAX(id) FROM " + table + "), 1), "
            "(SELECT COUNT(*) FROM " + table + ") > 0)",
            (table,),
        )


def _truncate(pg: "psycopg.Connection", tables: list[str]) -> None:
    # Reverse order (children first) keeps FKs happy without CASCADE surprises.
    with pg.cursor() as cur:
        for t in reversed(tables):
            cur.execute(f"TRUNCATE TABLE {t} RESTART IDENTITY CASCADE")


def import_db(sqlite_path: str, tables: list[str], pg: "psycopg.Connection", truncate: bool) -> None:
    if not Path(sqlite_path).is_file():
        print(f"SQLite file not found, skipping: {sqlite_path}")
        return
    print(f"Importing {sqlite_path}")
    scon = sqlite3.connect(sqlite_path)
    try:
        if truncate:
            _truncate(pg, tables)
        for t in tables:
            _copy_table(scon, pg, t)
        for t in tables:
            if t in SERIAL_ID_TABLES and _table_exists(scon, t):
                _reset_sequence(pg, t)
        pg.commit()
    finally:
        scon.close()


def main() -> int:
    ap = argparse.ArgumentParser(description="Import SQLite data into Postgres.")
    ap.add_argument("--cockpit", help="Path to cockpit.sqlite")
    ap.add_argument("--milestone2", help="Path to milestone2.sqlite")
    ap.add_argument("--database-url", default=os.getenv("DATABASE_URL", ""))
    ap.add_argument("--truncate", action="store_true", help="Empty target tables first")
    args = ap.parse_args()

    if not args.database_url:
        print("DATABASE_URL is required (env or --database-url)", file=sys.stderr)
        return 2
    if not args.cockpit and not args.milestone2:
        print("Pass at least one of --cockpit / --milestone2", file=sys.stderr)
        return 2

    pg = psycopg.connect(args.database_url)
    try:
        if args.cockpit:
            import_db(args.cockpit, COCKPIT_TABLES, pg, args.truncate)
        if args.milestone2:
            import_db(args.milestone2, MILESTONE2_TABLES, pg, args.truncate)
    finally:
        pg.close()
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
