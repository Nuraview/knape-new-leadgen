"""Load the SEMICON West 2026 attendee roster into the cockpit.

A thin wrapper over ``event_attendees.load_attendees`` (which is where the real
logic lives: keep no-email people, attach to existing accounts, drop placeholder
companies and duplicates, idempotent per ``captured_by``). This file only knows
the shape of the tec5 export and the SEMICON pool.

The CSV is an off-repo export of tec5's ``crm_Leads`` (source
``semicon-2026-attendees``, ``deletedAt IS NULL``) and is deliberately NOT
committed, because it is personal data. Produce it with::

    psql "$TEC5_DATABASE_URL" -c "\\copy (
      SELECT btrim(company) company, \"firstName\" first_name,
             \"lastName\" last_name, \"jobTitle\" job_title,
             COALESCE(email,'') email, COALESCE(phone,'') phone,
             COALESCE(source_payload->>'email_status','') email_status
      FROM \"crm_Leads\"
      WHERE lead_source_id = '<semicon-2026-attendees source id>'
        AND \"deletedAt\" IS NULL
    ) TO STDOUT WITH CSV HEADER" > semicon_attendees_full.csv

Usage::

    python -m sources.semicon_attendees --csv /path/to/semicon_attendees_full.csv [--dry-run]
"""

from __future__ import annotations

import argparse
import csv
import json

from sources.event_attendees import load_attendees

SOURCE_BUCKET = "event:semicon-2026"
DATA_BATCH = "semicon-2026"
CAPTURED_BY = "semicon-portal"


def _rows(csv_path: str):
    with open(csv_path, encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh):
            first = (r.get("first_name") or "").strip()
            last = (r.get("last_name") or "").strip()
            yield {
                "company": r.get("company") or "",
                "person": " ".join(p for p in (first, last) if p),
                "title": r.get("job_title") or "",
                "email": r.get("email") or "",
                "phone": r.get("phone") or "",
                "status": r.get("email_status") or "",
            }


def load(csv_path: str, *, dry_run: bool = False) -> dict:
    return load_attendees(
        _rows(csv_path),
        source_bucket=SOURCE_BUCKET,
        data_batch=DATA_BATCH,
        captured_by=CAPTURED_BY,
        dry_run=dry_run,
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="Load the SEMICON West attendee roster.")
    ap.add_argument("--csv", required=True, help="Path to the attendee CSV export.")
    ap.add_argument("--dry-run", action="store_true", help="Count only; write nothing.")
    args = ap.parse_args()
    print(json.dumps(load(args.csv, dry_run=args.dry_run), indent=2))


if __name__ == "__main__":
    main()
