"""Single-account, full-stack enrichment — the engine behind the dashboard's
"Auto-find contacts for new leads" scheduler (``outreach.scrape_runner``).

Runs everything this project's manual batch passes did, for ONE account:
  1. Site crawl + LinkedIn x-ray -> named contacts (``sources.site_crawl`` /
     ``sources.linkedin_xray``), written via ``enrich_account_contacts``.
  2. Org switchboard phone + front-office email (``pipeline.org_contact``).
  3. Org LinkedIn company/district page (``pipeline.org_linkedin``).
  4. A work email for the top contact, if still missing (``pipeline.person_email``).

Every step only fills what's currently empty, so calling this again on an already
-enriched account is a cheap no-op — safe for the scheduler to call blindly on
whatever the daily worklist gives it. Each step is independently best-effort: one
provider or site failure never stops the others from running.
"""

from __future__ import annotations

from typing import Any


def enrich_one_account(account_id: int, *, max_contacts: int = 3) -> dict[str, Any]:
    from outreach.db import connect

    conn = connect()
    try:
        row = conn.execute(
            "SELECT id, company, website, industry, location, phone, email, linkedin_url "
            "FROM accounts WHERE id = ?",
            (account_id,),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return {"account_id": account_id, "error": "account_not_found"}

    acct = dict(row)
    result: dict[str, Any] = {
        "account_id": account_id, "people": 0,
        "org_phone": False, "org_email": False, "org_linkedin": False, "person_email": False,
    }
    is_school = bool(
        "school" in (acct.get("industry") or "").lower()
        or "charter" in (acct.get("industry") or "").lower()
    )

    # 1) named contacts (crawl the site, then LinkedIn confirm/discover)
    try:
        from outreach.cockpit_api import _title_role_rank, enrich_account_contacts
        from sources.linkedin_xray import confirm_profile, discover_contacts, org_short
        from sources.site_crawl import crawl_site

        contacts: list[dict[str, Any]] = []
        if (acct.get("website") or "").strip():
            res = crawl_site(acct["website"], is_school, org_name=acct["company"])
            contacts = res.get("contacts") or []
        org = org_short(acct["company"])
        if contacts:
            top = max(contacts, key=lambda c: _title_role_rank(str(c.get("title") or "")))
            li = confirm_profile(str(top.get("name") or ""), org)
            if li:
                top["linkedin_url"] = li
        else:
            # Google's index before LinkedIn discovery.
            #
            # School staff directories refuse a plain fetch, so this branch used
            # to go straight to a LinkedIn x-ray, which returns names and titles
            # and NO email address — the account gained a person it still could
            # not write to. Google has already crawled those directories and the
            # SERP API returns the addresses in the snippets, at the same one
            # credit per request, so ask the index for what the site will not
            # hand over.
            from sources.serp_emails import find_emails

            harvested = find_emails(acct["website"], acct["company"], max_queries=1)
            contacts = [
                {
                    "name": h.get("person_name") or "",
                    "title": h.get("job_title") or "",
                    "email": h["email"],
                }
                for h in harvested
                if h.get("email")
            ]
            # Still nothing with an address: fall back to names-only discovery,
            # which at least gives the operator somebody to look up by hand.
            if not contacts:
                contacts = discover_contacts(org, is_school)
        if contacts:
            enrich_account_contacts(account_id, contacts[:max_contacts])
            result["people"] = min(len(contacts), max_contacts)
    except Exception as e:  # noqa: BLE001 — one failed step must not skip the rest
        result["people_error"] = f"{type(e).__name__}: {e}"[:150]

    # 2) org switchboard phone + front-office email — Apollo's org-enrich endpoint
    #    first (official data, works on the free plan), then the search-based fallbacks
    #    for whatever it didn't have. "At any cost" means exhausting every source before
    #    giving up on a field, not stopping at the first miss.
    apollo_org: dict[str, Any] = {}
    try:
        from pipeline.apollo_org import enrich_org as apollo_enrich_org

        if (acct.get("website") or "").strip():
            apollo_org = apollo_enrich_org(acct["website"], acct["company"], is_school)
    except Exception as e:  # noqa: BLE001
        result["apollo_error"] = f"{type(e).__name__}: {e}"[:150]

    try:
        from outreach.cockpit_api import set_account_org_contact
        from pipeline.org_contact import site_scan, snippet_scan
        from utils.websearch import get_key

        phone = (acct.get("phone") or "").strip() or apollo_org.get("phone", "")
        email = (acct.get("email") or "").strip()
        if not phone or not email:
            key = get_key("serper")
            if not phone and key:
                from pipeline.org_contact import place_lookup

                pl = place_lookup(acct, key)
                if pl.get("phone"):
                    phone = pl["phone"]
            if not phone or not email:
                sc = site_scan(acct.get("website") or "", acct["company"])
                if not phone and sc.get("phone"):
                    phone = sc["phone"]
                if not email and sc.get("email"):
                    email = sc["email"]
            if not email:
                sn = snippet_scan(acct)
                if sn.get("email"):
                    email = sn["email"]
            if phone or email:
                set_account_org_contact(account_id, phone, email)
                result["org_phone"] = bool(phone)
                result["org_email"] = bool(email)
                if phone == apollo_org.get("phone"):
                    result["org_phone_source"] = "apollo"
                if email:
                    acct["email"] = email  # feeds step 4's domain-pattern inference
    except Exception as e:  # noqa: BLE001
        result["org_contact_error"] = f"{type(e).__name__}: {e}"[:150]

    # 3) org LinkedIn company/district page — Apollo's result (from step 2's lookup)
    #    first, then the SERP-based search as a fallback.
    try:
        if not (acct.get("linkedin_url") or "").strip():
            from outreach.cockpit_api import set_account_linkedin

            url, kind = apollo_org.get("linkedin_url", ""), apollo_org.get("linkedin_kind", "")
            if not url:
                from pipeline.org_linkedin import find_org_linkedin

                kind, url = find_org_linkedin(acct)
            if url:
                set_account_linkedin(account_id, url, kind)
                result["org_linkedin"] = True
                result["org_linkedin_source"] = "apollo" if apollo_org.get("linkedin_url") else "search"
    except Exception as e:  # noqa: BLE001
        result["org_linkedin_error"] = f"{type(e).__name__}: {e}"[:150]

    # 4) a work email for the top contact, if it still has none
    try:
        from outreach.db import connect as _connect
        from pipeline.person_email import find_person_email

        conn = _connect()
        try:
            top = conn.execute(
                "SELECT id, person_name, email FROM contacts WHERE account_id = ? "
                "AND COALESCE(linkedin_url,'') <> '' ORDER BY role_rank DESC LIMIT 1",
                (account_id,),
            ).fetchone()
            sibling = conn.execute(
                "SELECT email FROM contacts WHERE account_id = ? AND COALESCE(email,'') <> '' "
                "ORDER BY role_rank DESC LIMIT 1",
                (account_id,),
            ).fetchone()
        finally:
            conn.close()
        if top and not (top["email"] or "").strip():
            person = {
                "person_name": top["person_name"],
                "_sibling_email": (sibling["email"] if sibling else "") or "",
            }
            email, status = find_person_email(acct, person)
            if email:
                src, conf = ("Website", 0.8) if status == "verified_web" else ("Pattern", 0.55)
                conn = _connect()
                try:
                    conn.execute(
                        "UPDATE contacts SET email = ?, source_kind = ?, confidence = ? "
                        "WHERE id = ? AND COALESCE(email,'') = ''",
                        (email, src, conf, top["id"]),
                    )
                    conn.commit()
                finally:
                    conn.close()
                result["person_email"] = True
    except Exception as e:  # noqa: BLE001
        result["person_email_error"] = f"{type(e).__name__}: {e}"[:150]

    return result
