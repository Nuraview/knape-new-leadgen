"""Load the International WorkBoat Show 2026 attendee roster into the cockpit.

A thin wrapper over ``event_attendees.load_attendees``. The roster is the badge
list the show owner released to the client; it carries name, title, company and
city. Emails are added to the CSV as verification passes complete (a status of
"verified" means the address exists in the event's own registration database),
and a row's verified email loads with it; everyone else still loads as an
emailless contact under their company.

The CSV is personal data and is NOT committed. It is read straight from the
path passed on the command line; the original file is never modified.

Usage::

    python -m sources.workboat_attendees --csv /path/to/attendees-2026.csv [--dry-run]
"""

from __future__ import annotations

import argparse
import csv
import json

from sources.event_attendees import load_attendees

SOURCE_BUCKET = "event:workboat-2026"
DATA_BATCH = "workboat-2026"
CAPTURED_BY = "workboat-portal"


def _rows(csv_path: str):
    with open(csv_path, encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh):
            # Prefer the combined name; fall back to first + last.
            name = (r.get("name") or "").strip()
            if not name:
                first = (r.get("first_name") or "").strip()
                last = (r.get("last_name") or "").strip()
                name = " ".join(p for p in (first, last) if p)
            extra = {}
            if (r.get("speaker") or "").strip():
                extra["speaker"] = True
            if (r.get("registration_id") or "").strip():
                extra["registration_id"] = r["registration_id"].strip()
            email = (r.get("email") or "").strip()
            yield {
                "company": r.get("company") or "",
                "person": name,
                "title": r.get("title") or "",
                "email": email,
                "phone": "",
                # "verified" = the address exists in the event's registration DB.
                # Only pass it through when an email is present, so emailless
                # people keep the plain default kind/confidence.
                "status": (r.get("email_status") or "").strip() if email else "",
                "location": (r.get("city_state") or "").strip(),
                "extra": extra,
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
    ap = argparse.ArgumentParser(description="Load the WorkBoat Show attendee roster.")
    ap.add_argument("--csv", required=True, help="Path to the attendee CSV.")
    ap.add_argument("--dry-run", action="store_true", help="Count only; write nothing.")
    args = ap.parse_args()
    print(json.dumps(load(args.csv, dry_run=args.dry_run), indent=2))


if __name__ == "__main__":
    main()
