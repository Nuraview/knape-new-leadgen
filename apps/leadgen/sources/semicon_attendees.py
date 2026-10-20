"""Load the full SEMICON West 2026 attendee roster into the cockpit.

The generic additive loader (``merge_records``) is wrong for an attendee roster
in two ways, both of which make the Attendees view look far emptier than the
tec5 source it is ported from:

1. It drops any person who has no email and no LinkedIn
   (``if not email and not (person and is_li): continue``). A trade-show roster
   is mostly names and titles with the email still to be found, so this throws
   away well over half the people and, with them, every company whose people
   were all no-email.
2. It attaches contacts ONLY when it first creates the account. A person whose
   company already exists in the pool (as an exhibitor, or from an earlier
   attendee run) gets no contact row at all.

This loader does the opposite on purpose: it keeps every person, and it attaches
them to the account that already carries the company, creating the account only
when the company is genuinely new to the pool. It is the people-level companion
to ``semicon_exhibitors.py`` (which loads the 842 booths).

Idempotent: it clears the ``event:semicon-2026`` pool's contacts and reloads
them from the CSV, so a re-run converges on the same state. Exhibitor accounts
carry no contacts of their own, so clearing the pool's contacts only removes
rows this loader put there.

The CSV is an off-repo export of tec5's ``crm_Leads`` (source
``semicon-2026-attendees``) and is deliberately NOT committed, because it is
personal data. Produce it with::

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
import time

from outreach.cockpit_api import (
    _connect,
    _contact_kind_conf,
    _init_db,
    _title_role_rank,
)
from utils.exclusions import normalize_company_key

SOURCE_BUCKET = "event:semicon-2026"
DATA_BATCH = "semicon-2026"
CAPTURED_BY = "semicon-portal"

# ArtSell is a competitor and contractor of Peter's; it is kept out of the pool
# the same way the exhibitor loader keeps it out.
_SKIP_COMPANIES = {"artsell"}


def _person_name(first: str, last: str) -> str:
    return " ".join(p for p in (first.strip(), last.strip()) if p).strip()


def load(csv_path: str, *, dry_run: bool = False) -> dict:
    _init_db()

    # Read and dedup the roster. Two rows are the same person when they share a
    # normalised company plus the same name, title and email. tec5 itself counts
    # raw rows, but a duplicate contact helps nobody, so we collapse exact repeats.
    seen: set[tuple] = set()
    rows: list[dict] = []
    skipped = 0
    with open(csv_path, encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh):
            company = (r.get("company") or "").strip()
            if not company:
                skipped += 1
                continue
            ckey = normalize_company_key(company)
            if ckey in _SKIP_COMPANIES:
                skipped += 1
                continue
            first = (r.get("first_name") or "").strip()
            last = (r.get("last_name") or "").strip()
            title = (r.get("job_title") or "").strip()
            email = (r.get("email") or "").strip()
            phone = (r.get("phone") or "").strip()
            status = (r.get("email_status") or "").strip()
            person = _person_name(first, last)
            if not person and not email:
                skipped += 1
                continue
            key = (ckey, person.lower(), title.lower(), email.lower())
            if key in seen:
                continue
            seen.add(key)
            rows.append(
                {
                    "company": company,
                    "ckey": ckey,
                    "person": person,
                    "title": title,
                    "email": email,
                    "phone": phone,
                    "status": status,
                }
            )

    companies = {r["ckey"] for r in rows}
    with_email = sum(1 for r in rows if "@" in r["email"])
    if dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "people": len(rows),
            "companies": len(companies),
            "with_email": with_email,
            "skipped": skipped,
        }

    now = time.time()
    conn = _connect()
    try:
        # Map every account already in the pool by normalised company name.
        pool: dict[str, int] = {}
        for row in conn.execute(
            "SELECT id, company FROM accounts WHERE lead_source_bucket = ?",
            (SOURCE_BUCKET,),
        ).fetchall():
            pool[normalize_company_key(str(row["company"] or ""))] = int(row["id"])

        # Clear this pool's contacts so the reload is idempotent. Exhibitor
        # accounts carry no contacts, so this only removes prior attendee rows.
        conn.execute(
            "DELETE FROM contacts WHERE account_id IN "
            "(SELECT id FROM accounts WHERE lead_source_bucket = ?)",
            (SOURCE_BUCKET,),
        )

        created_accounts = 0
        inserted = 0
        for r in rows:
            account_id = pool.get(r["ckey"])
            if account_id is None:
                # A registered company that never exhibited and was not seen on a
                # prior run: give it a minimal account in the pool.
                cur = conn.execute(
                    """
                    INSERT INTO accounts (
                        company, website, signal_category, signal_evidence,
                        segment, lead_source_bucket, last_sweep_at, data_batch
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
                    """,
                    (
                        r["company"], "", "event_attendee",
                        "SEMICON West 2026 registered attendee.",
                        "Attendee", SOURCE_BUCKET, now, DATA_BATCH,
                    ),
                )
                account_id = int(cur.fetchone()["id"])
                pool[r["ckey"]] = account_id
                created_accounts += 1

            source_kind, conf = _contact_kind_conf(r["email"], r["status"], False)
            conn.execute(
                """
                INSERT INTO contacts (
                    account_id, person_name, job_title, email, phone, linkedin_url,
                    source_kind, confidence, role_rank, captured_by, repeat_attendee, raw_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    account_id, r["person"], r["title"], r["email"], r["phone"], "",
                    source_kind, conf, _title_role_rank(r["title"]),
                    CAPTURED_BY, 0,
                    json.dumps(
                        {k: r[k] for k in ("company", "person", "title", "email", "phone", "status")}
                    ),
                ),
            )
            inserted += 1

        conn.commit()
        return {
            "ok": True,
            "people": inserted,
            "companies": len(companies),
            "with_email": with_email,
            "created_accounts": created_accounts,
            "skipped": skipped,
        }
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Load the SEMICON West attendee roster.")
    ap.add_argument("--csv", required=True, help="Path to the attendee CSV export.")
    ap.add_argument("--dry-run", action="store_true", help="Count only; write nothing.")
    args = ap.parse_args()
    result = load(args.csv, dry_run=args.dry_run)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
