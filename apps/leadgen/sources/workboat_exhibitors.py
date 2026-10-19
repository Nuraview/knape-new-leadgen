"""International WorkBoat Show 2026 exhibitor roster (commercial-vessel show).

The WorkBoat directory runs on SmallWorldLabs, not Map Your Show, so there is no
live Excel export to fetch. The public exhibitor list was captured to a CSV that
ships with the repo under ``sources/data/workboat-2026/``. This loader reads it
and feeds the cockpit the same way the other event presets do: one seed account
per exhibitor, tagged into the ``event:workboat-2026`` pool.

Public exhibitor directory only (company, booth, website, blurb). No attendee
people. Partial list for now (first directory pages); re-run after topping up the
CSV with the remaining pages.

    python -m sources.workboat_exhibitors --dry-run
    python -m sources.workboat_exhibitors
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

SHOW_NAME = "International WorkBoat Show 2026"
DATA_BATCH = "workboat-2026"
SOURCE_BUCKET = "event:workboat-2026"
DIRECTORY_URL = "https://www.workboatshow.com/"

CSV_PATH = Path(__file__).resolve().parent / "data" / "workboat-2026" / "workboat-2026-exhibitors.csv"

_SKIP_COMPANIES = {"artsell"}


def _norm(name: str) -> str:
    return "".join(ch for ch in str(name or "").lower() if ch.isalnum())


def fetch_workboat_exhibitors(limit: int | None = None) -> list[dict]:
    if not CSV_PATH.is_file():
        print(f"Warning: {SHOW_NAME} - exhibitor CSV not found at {CSV_PATH}; 0 rows.")
        return []
    out: list[dict] = []
    skipped = 0
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as fh:
        for r in csv.DictReader(fh):
            company = str(r.get("name") or "").strip()
            if not company:
                continue
            if _norm(company) in _SKIP_COMPANIES:
                skipped += 1
                continue
            booth = str(r.get("booth") or "").strip()
            website = str(r.get("website") or "").strip()
            if website and not website.lower().startswith("http"):
                website = "https://" + website
            desc = str(r.get("description") or "").strip()
            booth_note = f" Booth {booth}." if booth else ""
            out.append(
                {
                    "company": company,
                    "website": website,
                    "post_url": str(r.get("profile") or "").strip() or DIRECTORY_URL,
                    "source": f"{SHOW_NAME} Exhibitor Directory",
                    "signal_category": "event_exhibitor",
                    "signal_evidence": f"Exhibiting company at {SHOW_NAME}.{booth_note}",
                    "company_profile": desc[:600],
                    "booth": booth,
                    "event": SHOW_NAME,
                    "data_batch": DATA_BATCH,
                    "lead_source_bucket": SOURCE_BUCKET,
                }
            )
            if limit is not None and len(out) >= limit:
                break
    note = f" ({skipped} skipped)" if skipped else ""
    print(f"  {SHOW_NAME} (public directory CSV): {len(out)} exhibitor rows{note}.")
    return out


def _cli() -> None:
    p = argparse.ArgumentParser(description="Load WorkBoat Show 2026 exhibitors.")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--dry-run", action="store_true", help="print rows, write nothing")
    args = p.parse_args()
    rows = fetch_workboat_exhibitors(limit=args.limit)
    if args.dry_run or not rows:
        for r in rows[:20]:
            print(f"  - {r['company']!r} | {r['booth'] or '(no booth)'} | {r['website'] or '(no site)'}")
        print(f"[dry-run] {len(rows)} WorkBoat exhibitor rows parsed; nothing written.")
        return
    from outreach.cockpit_api import merge_records
    res = merge_records(rows, data_batch_override=DATA_BATCH, source_bucket_override=SOURCE_BUCKET)
    print(f"Ingested WorkBoat exhibitors: {res}")


if __name__ == "__main__":
    _cli()
