"""Contact-layer pipeline step: attach named people (email/LinkedIn) to leads in 1.xlsx.

Waterfall per account (see ``sources/contact_crawl.py``): own-site staff-page crawl →
Gemini extraction → email pattern inference → Serper LinkedIn x-ray. Public data only.

Usage: ``python main.py contacts`` (env ``CONTACTS_MAX_ACCOUNTS`` caps a run, 0 = all).
Primary contact fills the account's own lead row; extra contacts become appended rows
with the same ``company`` so the cockpit sync groups them into one account with
multiple contacts.
"""

from __future__ import annotations

import os

from sources.contact_crawl import crawl_account_contacts
from storage.xlsx_output import load_leads_from_xlsx, save_to_xlsx
from utils import pipeline_events as events

CONTACTS_MAX_ACCOUNTS = int(os.getenv("CONTACTS_MAX_ACCOUNTS", "0"))


def _is_school(lead: dict) -> bool:
    blob = f"{lead.get('company', '')} {lead.get('source', '')}".lower()
    return "nces" in blob or "school" in blob or "high" in blob


def _company_key(lead: dict) -> str:
    return (lead.get("company") or "").strip().upper()


def run_contacts() -> None:
    print("Contact layer: crawling public staff pages + LinkedIn x-ray.")
    events.run_started("contacts")
    try:
        _run_contacts()
        events.run_finished("contacts", ok=True)
    except Exception as e:  # surface to dashboard, mirror milestone1 behavior
        events.run_finished("contacts", ok=False, error=str(e)[:300])
        raise


def _run_contacts() -> None:
    leads = load_leads_from_xlsx("1.xlsx")
    if not leads:
        print("No leads in 1.xlsx — run milestone1 first.")
        return

    by_company: dict[str, list[dict]] = {}
    for lead in leads:
        by_company.setdefault(_company_key(lead), []).append(lead)

    todo = [
        (key, rows)
        for key, rows in by_company.items()
        if not any((r.get("person_name") or "").strip() for r in rows)
    ]
    if CONTACTS_MAX_ACCOUNTS > 0:
        todo = todo[:CONTACTS_MAX_ACCOUNTS]
    print(f"  Accounts without a named contact: {len(todo)} (of {len(by_company)}).")

    new_rows: list[dict] = []
    found_people = found_emails = found_li = 0
    for i, (key, rows) in enumerate(todo, 1):
        base = rows[0]
        company = base.get("company") or ""
        result = crawl_account_contacts(company, base.get("website") or "", _is_school(base))
        contacts = result.get("contacts") or []
        li_url = result.get("linkedin_url") or ""

        if contacts:
            found_people += 1
            primary = contacts[0]
            base["person_name"] = primary["name"]
            base["job_title"] = primary["title"]
            if primary.get("email"):
                base["email"] = primary["email"]
                base["email_verification_status"] = primary.get("email_status", "site_published")
                found_emails += 1
            for extra in contacts[1:3]:
                row = dict(base)
                row["person_name"] = extra["name"]
                row["job_title"] = extra["title"]
                row["email"] = extra.get("email", "")
                row["email_verification_status"] = (
                    extra.get("email_status", "site_published") if extra.get("email") else ""
                )
                new_rows.append(row)
        if li_url and not (base.get("post_url") or "").startswith("https://www.linkedin.com"):
            # Keep the evidence URL; LinkedIn profile goes on a contact row.
            row = dict(base)
            row["person_name"] = base.get("person_name") or ""
            row["post_url"] = li_url
            if row["person_name"]:
                new_rows.append(row)
            found_li += 1

        status = f"{len(contacts)} contact(s)" + (" + LinkedIn" if li_url else "")
        print(f"  [{i}/{len(todo)}] {company[:60]}: {status}")
        if i % 10 == 0:
            events.emit("contacts", f"{i}/{len(todo)} accounts crawled", level="info", count=i)

    merged = leads + new_rows
    save_to_xlsx(merged)
    _sync_to_postgres(merged)
    print(
        f"Contact layer done: {found_people}/{len(todo)} accounts got a named contact, "
        f"{found_emails} with email, {found_li} LinkedIn URLs. "
        f"{len(new_rows)} extra contact rows appended → {len(merged)} total rows."
    )


def _sync_to_postgres(records: list[dict]) -> None:
    from config import DATABASE_URL

    if not DATABASE_URL:
        return
    try:
        from outreach.cockpit_api import sync_records

        res = sync_records(records)
        print(f"  Synced {res.get('accounts', 0)} accounts to Postgres (dashboard live).")
    except Exception as e:  # noqa: BLE001
        print(f"Warning: direct Postgres sync failed (xlsx still written): {str(e)[:160]}")
