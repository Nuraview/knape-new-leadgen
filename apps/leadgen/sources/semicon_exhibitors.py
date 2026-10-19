"""SEMICON West 2026 exhibitor roster (semiconductor manufacturing show).

Unlike WEFTEC, SEMICON West's directory does not run on Map Your Show, so there
is no public Excel export to fetch live. The roster was captured once from the
public exhibitor directory (portal2026.semiconwest.org) and ships with the repo
as a CSV under ``sources/data/semicon-2026/``. This loader reads that file and
feeds it to the cockpit the same way the Map Your Show presets do: one seed
account per exhibitor, tagged into the ``event:semicon-2026`` pool so SEMICON
leads stay isolated from the main Knape discovery pipeline.

The CSV is the public exhibitor directory only (company, booth, website). It
carries no attendee people: those come from the show's attendee export, loaded
separately through ``sources.booth_scan_import``. Load attendees first and these
exhibitors second, so a company that is both keeps the attendee contacts that
were attached when its account was created.

Preview without writing anything:
    python -m sources.semicon_exhibitors --dry-run
Ingest into the cockpit database:
    python -m sources.semicon_exhibitors
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

SHOW_NAME = "SEMICON West 2026"
DATA_BATCH = "semicon-2026"
SOURCE_BUCKET = "event:semicon-2026"
DIRECTORY_URL = "https://portal2026.semiconwest.org"

CSV_PATH = Path(__file__).resolve().parent / "data" / "semicon-2026" / "semicon-2026-exhibitors.csv"

# Companies to keep out of the pool entirely. ArtSell is a competitor and
# contractor of the client and must never be contacted, so it is dropped at
# load time rather than merely tagged. Matched on the normalised name below.
_SKIP_COMPANIES = {"artsell"}


def _norm(name: str) -> str:
    return "".join(ch for ch in str(name or "").lower() if ch.isalnum())


def _parse_notes(notes: str) -> tuple[str, str, str]:
    """Pull (booth, website, portal_url) out of the CSV's notes field.

    Notes look like: ``Booth #5567 · http://www.3dsystems.com · https://portal2026.semiconwest.org/co/3d-systems``
    """
    booth = website = portal = ""
    for part in (p.strip() for p in str(notes or "").split("·")):
        low = part.lower()
        if low.startswith("booth"):
            booth = part.split("#", 1)[-1].strip() if "#" in part else part[len("booth"):].strip()
        elif "portal2026.semiconwest.org" in low:
            portal = part
        elif low.startswith("http"):
            website = part
    return booth, website, portal


def fetch_semicon_exhibitors(limit: int | None = None) -> list[dict]:
    """Return seed account records for every SEMICON West exhibitor.

    Record shape matches what ``outreach.cockpit_api.merge_records`` consumes.
    """
    if not CSV_PATH.is_file():
        print(f"Warning: {SHOW_NAME} — exhibitor CSV not found at {CSV_PATH}; 0 rows.")
        return []

    out: list[dict] = []
    skipped = 0
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as fh:
        for r in csv.DictReader(fh, delimiter=";"):
            company = str(r.get("company") or "").strip()
            if not company:
                continue
            if _norm(company) in _SKIP_COMPANIES:
                skipped += 1
                continue
            booth, website, portal = _parse_notes(r.get("notes", ""))
            booth_note = f" Booth {booth}." if booth else ""
            out.append(
                {
                    "company": company,
                    "website": website,
                    "post_url": portal or DIRECTORY_URL,
                    "source": f"{SHOW_NAME} Exhibitor Directory",
                    "signal_category": "event_exhibitor",
                    "signal_evidence": f"Exhibiting company at {SHOW_NAME}.{booth_note}",
                    "booth": booth,
                    "segment": str(r.get("segment") or "").strip(),
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
    p = argparse.ArgumentParser(description="Load SEMICON West 2026 exhibitors.")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--dry-run", action="store_true", help="print rows, write nothing")
    args = p.parse_args()

    rows = fetch_semicon_exhibitors(limit=args.limit)
    if args.dry_run or not rows:
        for r in rows[:20]:
            print(f"  - {r['company']!r} | {r['booth'] or '(no booth)'} | {r['website'] or '(no site)'}")
        print(f"[dry-run] {len(rows)} SEMICON exhibitor rows parsed; nothing written.")
        return

    from outreach.cockpit_api import merge_records

    res = merge_records(rows, data_batch_override=DATA_BATCH, source_bucket_override=SOURCE_BUCKET)
    print(f"Ingested SEMICON West exhibitors: {res}")


if __name__ == "__main__":
    _cli()
