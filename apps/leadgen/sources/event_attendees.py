"""Shared loader for a trade-show attendee roster.

A roster is mostly names, titles and companies: the email is usually still to be
found. The generic ``merge_records`` path is wrong for it on two counts (it drops
anyone with no email, and it only attaches people when it first creates the
company), so each show that has a roster calls ``load_attendees`` here instead.

What this does that ``merge_records`` does not:

* keeps every person, emailable or not;
* attaches people to the account that already carries the company, creating the
  account only for a company new to the pool;
* drops placeholder "companies" (``N/A``, ``Retired``, ``Self`` and the like)
  and exact duplicate people, so only legitimate rows land in the CRM;
* leaves contacts from other sources alone. Idempotency is scoped to this
  roster's ``captured_by`` tag: a re-run clears and replaces only the rows this
  roster put in, never a prior enrichment or a different source's contacts.

Callers (``semicon_attendees.py``, ``workboat_attendees.py``) read their own CSV
shape, map each row to the small dict this function expects, and pass the list
in. The roster CSVs are personal data and are never committed.
"""

from __future__ import annotations

import html
import json
import re
import time
from typing import Any, Iterable

from outreach.cockpit_api import (
    _connect,
    _contact_kind_conf,
    _init_db,
    _title_role_rank,
    decode_html_entities,
)
from utils.exclusions import normalize_company_key

# Strings people type into the "company" box when they have no company. These
# are never real accounts, so a row whose company is one of them is not loaded.
PLACEHOLDER_COMPANIES = {
    "", "n/a", "na", "none", "none.", "test", "self", "self employed",
    "self-employed", "retired", "student", "unemployed", "home", "unknown",
    "no company", "independent", "-", ".", "x", "xx", "xxx", "tbd", "private",
    "me", "n.a", "n/a.", "nil",
}


# Spellings of one organisation that a roster's free-text company box splits
# into separate companies. Keyed by the name reduced to letters only, so case,
# dots and spaces do not matter. Sub-units ("USCG Sector New Orleans"),
# retirees and contractors are deliberately not here: they are not the same
# account.
COMPANY_ALIASES = {
    "unitedstatescoastguard": "U.S. Coast Guard",
    "uscoastguard": "U.S. Coast Guard",
    "uscg": "U.S. Coast Guard",
    "coastguard": "U.S. Coast Guard",
}


def _alpha(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def canonical_company(company: str) -> str:
    return COMPANY_ALIASES.get(_alpha(company), company)


def is_placeholder_company(company: str) -> bool:
    c = (company or "").strip().lower()
    return c in PLACEHOLDER_COMPANIES or len(_alpha(c)) < 2


def load_attendees(
    rows: Iterable[dict[str, Any]],
    *,
    source_bucket: str,
    data_batch: str,
    captured_by: str,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Load one show's attendee roster.

    Each row is a dict with: ``company`` (required), ``person`` (name),
    ``title``, ``email``, ``phone``, ``status`` (email verification status),
    ``location``, and an optional ``extra`` dict kept verbatim in ``raw_json``.
    """
    _init_db()
    # Names already in the pool are decoded first, so the decoded roster below
    # matches them instead of creating "G & H Towing" beside "G &amp; H Towing".
    if not dry_run:
        decode_html_entities()

    def _text(v: Any) -> str:
        # Badge exports escape their free text ("Great Lakes Dredge &amp; Dock").
        return html.unescape(str(v or "")).strip()

    dropped_placeholder = dropped_empty = duplicates = 0
    seen: set[tuple] = set()
    clean: list[dict[str, Any]] = []
    for r in rows:
        company = _text(r.get("company"))
        if is_placeholder_company(company):
            dropped_placeholder += 1
            continue
        company = canonical_company(company)
        person = _text(r.get("person"))
        email = (r.get("email") or "").strip()
        title = _text(r.get("title"))
        if not person and not email:
            dropped_empty += 1
            continue
        ckey = normalize_company_key(company)
        key = (ckey, person.lower(), title.lower(), email.lower())
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        clean.append(
            {
                "company": company,
                "ckey": ckey,
                "person": person,
                "title": title,
                "email": email,
                "phone": (r.get("phone") or "").strip(),
                "status": (r.get("status") or "").strip(),
                "location": _text(r.get("location")),
                "extra": r.get("extra") or {},
            }
        )

    companies = {r["ckey"] for r in clean}
    with_email = sum(1 for r in clean if "@" in r["email"])
    base_stats = {
        "people": len(clean),
        "companies": len(companies),
        "with_email": with_email,
        "dropped_placeholder": dropped_placeholder,
        "dropped_no_person_no_email": dropped_empty,
        "duplicates_removed": duplicates,
    }
    if dry_run:
        return {"ok": True, "dry_run": True, **base_stats}

    now = time.time()
    conn = _connect()
    try:
        # A prior partial load can leave accounts tagged with this batch but no
        # bucket. Adopt them so the pool is consistent (the /events overview keys
        # off the bucket) before anything else reads account state.
        conn.execute(
            "UPDATE accounts SET lead_source_bucket = ? "
            "WHERE data_batch = ? AND COALESCE(lead_source_bucket,'') = ''",
            (source_bucket, data_batch),
        )

        # Accounts already in this show's pool, by normalised company name. A show
        # account is one tagged with either the bucket or the batch, because the
        # overview keys off the bucket while the show pages key off the batch.
        pool: dict[str, int] = {}
        for row in conn.execute(
            "SELECT id, company FROM accounts "
            "WHERE lead_source_bucket = ? OR data_batch = ?",
            (source_bucket, data_batch),
        ).fetchall():
            pool[normalize_company_key(str(row["company"] or ""))] = int(row["id"])

        # Every account with a blank website, keyed by its exact company. The
        # unique index is (company, website), so a new account with a blank
        # website would collide with one of these; when it would, we attach to
        # the existing account rather than fail or duplicate it.
        blank_web: dict[str, int] = {}
        for row in conn.execute(
            "SELECT id, company FROM accounts WHERE COALESCE(website,'') = ''"
        ).fetchall():
            blank_web.setdefault(str(row["company"] or "").strip(), int(row["id"]))

        # People already on this pool's accounts from OTHER sources, so the roster
        # does not duplicate a person a prior load already captured.
        existing_people: set[tuple[int, str]] = set()
        for row in conn.execute(
            "SELECT c.account_id, lower(c.person_name) nm FROM contacts c "
            "JOIN accounts a ON a.id = c.account_id "
            "WHERE (a.lead_source_bucket = ? OR a.data_batch = ?) "
            "AND COALESCE(c.captured_by,'') <> ?",
            (source_bucket, data_batch, captured_by),
        ).fetchall():
            existing_people.add((int(row["account_id"]), str(row["nm"] or "")))

        # Idempotency, scoped to this roster only.
        conn.execute(
            "DELETE FROM contacts WHERE captured_by = ? AND account_id IN "
            "(SELECT id FROM accounts WHERE lead_source_bucket = ? OR data_batch = ?)",
            (captured_by, source_bucket, data_batch),
        )

        created_accounts = inserted = skipped_existing = null_website = 0
        for r in clean:
            account_id = pool.get(r["ckey"])
            if account_id is None:
                # The unique index is (company, website). If this exact company
                # already exists with a blank website in ANOTHER show's pool, a
                # second blank-website row would collide, and re-tagging that
                # account would move the company out of its own show. The index
                # treats NULL as distinct, so give this show's copy a NULL
                # website: a separate account that stays in this show's pool.
                collides = r["company"] in blank_web
                website_val = None if collides else ""
                cur = conn.execute(
                    """
                    INSERT INTO accounts (
                        company, website, location, signal_category, signal_evidence,
                        segment, lead_source_bucket, last_sweep_at, data_batch,
                        icp_score, icp_enhanced_score
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
                    """,
                    (
                        r["company"], website_val, r["location"], "event_attendee",
                        "Registered attendee.", "Attendee",
                        source_bucket, now, data_batch,
                        # An explicit 0, not NULL: the list view filters on
                        # COALESCE(icp_enhanced_score, icp_score) >= min_icp, and a
                        # NULL score fails `>= 0`, which would hide the company.
                        0, 0,
                    ),
                )
                account_id = int(cur.fetchone()["id"])
                pool[r["ckey"]] = account_id
                if collides:
                    null_website += 1
                else:
                    blank_web[r["company"]] = account_id
                created_accounts += 1

            if r["person"] and (account_id, r["person"].lower()) in existing_people:
                skipped_existing += 1
                continue

            source_kind, conf = _contact_kind_conf(r["email"], r["status"], False)
            payload = {
                "company": r["company"], "person": r["person"], "title": r["title"],
                "email": r["email"], "phone": r["phone"], "location": r["location"],
                **r["extra"],
            }
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
                    captured_by, 0, json.dumps(payload, default=str),
                ),
            )
            inserted += 1

        conn.commit()
        return {
            "ok": True,
            **base_stats,
            "inserted": inserted,
            "created_accounts": created_accounts,
            "created_with_null_website": null_website,
            "skipped_already_present": skipped_existing,
        }
    finally:
        conn.close()
