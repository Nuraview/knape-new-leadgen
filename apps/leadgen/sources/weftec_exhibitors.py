"""WEFTEC 2026 exhibitor roster (Water Environment Federation).

A thin preset over ``sources.mapyourshow_directory``. WEFTEC's public exhibitor
directory runs on Map Your Show at ``weftec26.mapyourshow.com``; this pins the
event's subdomain and the batch and source-bucket tags that keep WEFTEC leads in
their own pool, isolated from the main Knape discovery pipeline.

Run a preview without writing anything:
    python -m sources.weftec_exhibitors --dry-run
Ingest into the cockpit database:
    python -m sources.weftec_exhibitors
"""

from __future__ import annotations

import argparse

from sources.mapyourshow_directory import fetch_mapyourshow_exhibitors

SUBDOMAIN = "weftec26"
SHOW_NAME = "WEFTEC 2026"
DATA_BATCH = "weftec-2026"
SOURCE_BUCKET = "event:weftec-2026"


def fetch_weftec_exhibitors(limit: int | None = None) -> list[dict]:
    return fetch_mapyourshow_exhibitors(
        subdomain=SUBDOMAIN,
        show_name=SHOW_NAME,
        data_batch=DATA_BATCH,
        source_bucket=SOURCE_BUCKET,
        limit=limit,
    )


def _cli() -> None:
    p = argparse.ArgumentParser(description="Fetch WEFTEC 2026 exhibitors.")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--dry-run", action="store_true", help="print rows, write nothing")
    args = p.parse_args()

    rows = fetch_weftec_exhibitors(limit=args.limit)
    if args.dry_run or not rows:
        for r in rows[:20]:
            print(f"  - {r['company']!r} | {r['booth'] or '(no booth)'}")
        print(f"[dry-run] {len(rows)} WEFTEC exhibitor rows parsed; nothing written.")
        return

    from outreach.cockpit_api import merge_records

    res = merge_records(rows, data_batch_override=DATA_BATCH, source_bucket_override=SOURCE_BUCKET)
    print(f"Ingested WEFTEC exhibitors: {res}")


if __name__ == "__main__":
    _cli()
