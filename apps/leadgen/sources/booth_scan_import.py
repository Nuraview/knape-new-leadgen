"""Import a client's own booth-scan export into the event lead pool.

When Knape's booth scans a visitor at a show (WEFTEC, WorkBoat), that scan is the
client's own data: a person who walked up and shared their badge. The show's
lead-retrieval app lets the exhibitor export those scans as a CSV or XLSX. This
module reads that export file and loads the scanned people as contacts in the
event pool, tagged so they are campaigned alongside the exhibitor companies.

It reads a file the client hands us. It never logs into or pulls from the show
platform, and it is the only path by which actual attendee people enter the
pipeline. Column names vary between apps, so headers are matched by synonym.

Preview a file without writing:
    python -m sources.booth_scan_import --file scans.csv --event weftec-2026 \
        --show "WEFTEC 2026" --dry-run
Load it:
    python -m sources.booth_scan_import --file scans.csv --event weftec-2026 \
        --show "WEFTEC 2026"
"""

from __future__ import annotations

import argparse
import csv
import io
import re
from pathlib import Path

# Header synonyms, lower-cased. First match wins.
_FIELD_SYNONYMS: dict[str, tuple[str, ...]] = {
    "person_name": ("name", "full name", "fullname", "attendee", "contact name", "first and last name"),
    "first_name": ("first name", "firstname", "first", "given name"),
    "last_name": ("last name", "lastname", "last", "surname", "family name"),
    "job_title": ("title", "job title", "jobtitle", "position", "role"),
    "company": ("company", "organization", "organisation", "employer", "account", "company name"),
    "email": ("email", "e-mail", "email address", "work email"),
    "phone": ("phone", "telephone", "mobile", "cell", "phone number"),
    "linkedin_url": ("linkedin", "linkedin url", "linkedin profile"),
    "notes": ("notes", "note", "comments", "comment", "remarks"),
    "booth": ("booth", "booth number", "stand"),
}

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _norm_header(h: str) -> str:
    return re.sub(r"\s+", " ", str(h or "").strip().lower())


def _build_index(headers: list[str]) -> dict[str, int]:
    """Map our field names to column indices using the synonym table."""
    lowered = [_norm_header(h) for h in headers]
    idx: dict[str, int] = {}
    for field, syns in _FIELD_SYNONYMS.items():
        for i, h in enumerate(lowered):
            if h in syns:
                idx[field] = i
                break
    return idx


def _rows_from_file(path: Path) -> list[list[str]]:
    """Return the sheet as a list of string rows, including the header row."""
    suffix = path.suffix.lower()
    if suffix in (".xlsx", ".xlsm"):
        # Reuse the project's stdlib xlsx reader (no openpyxl dependency).
        from storage.xlsx_output import _read_sheet_all_rows

        return _read_sheet_all_rows(path)
    # CSV / TSV. Sniff the delimiter; fall back to comma.
    raw = path.read_text(encoding="utf-8-sig", errors="replace")
    try:
        dialect = csv.Sniffer().sniff(raw[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    return [list(r) for r in csv.reader(io.StringIO(raw), dialect)]


def _cell(row: list[str], i: int | None) -> str:
    if i is None or i >= len(row):
        return ""
    return str(row[i] or "").strip()


def load_booth_scans(
    *,
    file_path: str,
    event_slug: str,
    show_name: str,
    limit: int | None = None,
) -> list[dict]:
    """Parse a booth-scan export into event-contact records.

    Record shape matches ``outreach.cockpit_api.merge_records``. People with a
    LinkedIn profile carry it in ``post_url`` so the merge recognises it.
    """
    path = Path(file_path).expanduser()
    if not path.is_file():
        raise FileNotFoundError(f"Booth-scan file not found: {path}")

    all_rows = _rows_from_file(path)
    if not all_rows:
        print(f"Warning: {path.name} is empty.")
        return []

    idx = _build_index(all_rows[0])
    if "email" not in idx and "person_name" not in idx and "first_name" not in idx:
        raise RuntimeError(
            f"Could not find name or email columns in {path.name}. "
            f"Headers seen: {all_rows[0]}"
        )

    out: list[dict] = []
    seen_emails: set[str] = set()
    for row in all_rows[1:]:
        if not any(str(c or "").strip() for c in row):
            continue
        name = _cell(row, idx.get("person_name"))
        if not name:
            name = " ".join(x for x in (_cell(row, idx.get("first_name")), _cell(row, idx.get("last_name"))) if x).strip()
        company = _cell(row, idx.get("company"))
        email = _cell(row, idx.get("email")).lower()
        if email and not _EMAIL_RE.match(email):
            email = ""
        if email:
            if email in seen_emails:
                continue
            seen_emails.add(email)
        # A scan with neither a usable email nor a named person is noise.
        if not email and not name:
            continue
        linkedin = _cell(row, idx.get("linkedin_url"))
        is_li_profile = "linkedin.com/in/" in linkedin.lower()
        notes = _cell(row, idx.get("notes"))
        booth = _cell(row, idx.get("booth"))
        # A booth scan without a company still belongs to the person; label it so
        # the row groups on its own rather than merging into a blank-company bucket.
        company = company or (f"{name} (booth scan)" if name else "")

        evidence = f"Scanned at the {show_name} booth."
        if booth:
            evidence += f" Booth {booth}."
        if notes:
            evidence += f" Notes: {notes}"

        out.append(
            {
                "company": company,
                "website": "",
                "person_name": name,
                "job_title": _cell(row, idx.get("job_title")),
                "email": email,
                "phone": _cell(row, idx.get("phone")),
                "linkedin_url": linkedin,
                # merge_records detects LinkedIn via post_url; give it the profile.
                "post_url": linkedin if is_li_profile else "",
                "source": f"{show_name} Booth Scan",
                "signal_category": "event_booth_scan",
                "signal_evidence": evidence,
                "event": show_name,
                "data_batch": event_slug,
                "lead_source_bucket": f"event:{event_slug}",
            }
        )

    print(f"  {show_name} booth scans ({path.name}): {len(out)} people.")
    return out[: max(0, limit)] if limit is not None else out


def _cli() -> None:
    p = argparse.ArgumentParser(description="Import a client's own booth-scan export.")
    p.add_argument("--file", required=True, help="CSV or XLSX export from the lead-retrieval app")
    p.add_argument("--event", required=True, help="event slug, e.g. weftec-2026 or workboat-2025")
    p.add_argument("--show", required=True, help='human show name, e.g. "WEFTEC 2026"')
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--dry-run", action="store_true", help="print rows, write nothing")
    args = p.parse_args()

    rows = load_booth_scans(
        file_path=args.file, event_slug=args.event, show_name=args.show, limit=args.limit
    )
    if args.dry_run or not rows:
        for r in rows[:20]:
            print(f"  - {r['person_name'] or '(no name)'} | {r['job_title']} | {r['company']} | {r['email'] or '(no email)'}")
        print(f"[dry-run] {len(rows)} booth-scan rows parsed; nothing written.")
        return

    from outreach.cockpit_api import merge_records

    res = merge_records(
        rows,
        data_batch_override=args.event,
        source_bucket_override=f"event:{args.event}",
    )
    print(f"Ingested booth scans: {res}")


if __name__ == "__main__":
    _cli()
