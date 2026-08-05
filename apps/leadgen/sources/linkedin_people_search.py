"""LinkedIn people search via Apify ``harvestapi/linkedin-profile-search``.

Personas: school Athletic Directors + county prevention coordinators. Each result
is a named contact with a LinkedIn URL (the thesis deliverable — no email needed).
"""

from __future__ import annotations

import json
import os

from config import APIFY_TOKEN
from utils.apify import apify_client_class
from utils.exclusions import is_excluded_record

LINKEDIN_PEOPLE_ACTOR = os.getenv(
    "APIFY_LINKEDIN_PEOPLE_ACTOR", "harvestapi/linkedin-profile-search"
)

# JSON list of {"title": ..., "location": ...}; env-overridable.
_DEFAULT_SEARCHES: list[dict] = [
    {"title": "Athletic Director", "location": "Washington, United States"},
    {"title": "Athletic Director", "location": "Pennsylvania, United States"},
    {"title": "Athletic Director", "location": "Ohio, United States"},
    {"title": "High School Athletic Director", "location": "United States"},
    {"title": "Prevention Coordinator", "location": "Washington, United States"},
    {"title": "Prevention Program Manager", "location": "Pennsylvania, United States"},
    {"title": "Substance Abuse Prevention Coordinator", "location": "United States"},
]

LI_MAX_PER_SEARCH = int(os.getenv("LI_MAX_PER_SEARCH", "60"))


def _searches() -> list[dict]:
    raw = (os.getenv("LI_SEARCHES") or "").strip()
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list) and parsed:
                return [x for x in parsed if isinstance(x, dict) and x.get("title")]
        except json.JSONDecodeError:
            print("Warning: LI_SEARCHES is not valid JSON; using defaults.")
    return _DEFAULT_SEARCHES


def _is_apify_billing_limit_error(message: str) -> bool:
    m = (message or "").lower()
    return (
        "payment-signature" in m
        or "monthly usage hard limit exceeded" in m
        or "usage hard limit exceeded" in m
        or "hard limit exceeded" in m
        or "insufficient credits" in m
        or "payment required" in m
        or "402" in m
    )


def _first_str(item: dict, *keys: str) -> str:
    for k in keys:
        v = item.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
        if isinstance(v, dict):
            name = v.get("name") or v.get("text")
            if isinstance(name, str) and name.strip():
                return name.strip()
    return ""


def _profile_location(item: dict) -> str:
    loc = item.get("location")
    if isinstance(loc, dict):
        return str(loc.get("linkedinText") or loc.get("text") or "").strip()
    if isinstance(loc, str):
        return loc.strip()
    return ""


def _current_company(item: dict) -> str:
    for key in ("currentPosition", "currentCompany", "company", "experience"):
        v = item.get(key)
        if isinstance(v, list) and v:
            v = v[0]
        if isinstance(v, dict):
            name = v.get("companyName") or v.get("company") or v.get("name")
            if isinstance(name, str) and name.strip():
                return name.strip()
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _map_item(item: dict, search: dict) -> dict | None:
    name = _first_str(item, "name", "fullName", "firstNameLastName")
    if not name:
        first = _first_str(item, "firstName")
        last = _first_str(item, "lastName")
        name = f"{first} {last}".strip()
    url = _first_str(item, "linkedinUrl", "url", "profileUrl", "publicProfileUrl")
    if not name or not url:
        return None
    headline = _first_str(item, "headline", "title", "jobTitle", "position")
    company = _current_company(item) or _first_str(item, "companyName")
    loc = _profile_location(item)
    label = company or "School / organization TBD"
    display_company = f"{label} — {loc}" if loc and loc.lower() not in label.lower() else label
    return {
        "company": display_company,
        "website": "",
        "post_url": url,
        "source": "LinkedIn Profiles (people search)",
        "signal_category": "",  # classifier decides from headline text
        "signal_evidence": (
            f"LinkedIn profile match for '{search.get('title', '')}' in {search.get('location', 'US')}: "
            f"{headline or 'title match'}."
        ),
        "person_name": name,
        "job_title": headline or search.get("title", ""),
        "location": loc,
        "enrollment": "",
    }


def fetch_linkedin_people() -> list[dict]:
    client_cls = apify_client_class()
    if client_cls is None or not APIFY_TOKEN:
        print("Warning: Apify not configured; skipping LinkedIn people search.")
        return []
    client = client_cls(APIFY_TOKEN)
    out: list[dict] = []
    seen_urls: set[str] = set()
    for search in _searches():
        run_input = {
            "currentJobTitles": [search["title"]],
            "locations": [search.get("location", "United States")],
            "maxItems": LI_MAX_PER_SEARCH,
            "profileScraperMode": "Full",
        }
        try:
            run = client.actor(LINKEDIN_PEOPLE_ACTOR).call(run_input=run_input, timeout_secs=900)
            items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
        except Exception as e:  # noqa: BLE001 — Apify client raises many types
            msg = str(e)
            if _is_apify_billing_limit_error(msg):
                print("Warning: Apify billing/usage limit hit — stopping LinkedIn search.")
                break
            print(f"Warning: LinkedIn people search failed ({search}): {msg[:200]}")
            continue
        added = 0
        for item in items:
            if not isinstance(item, dict):
                continue
            rec = _map_item(item, search)
            if rec is None or rec["post_url"] in seen_urls:
                continue
            if is_excluded_record(rec):
                continue
            seen_urls.add(rec["post_url"])
            out.append(rec)
            added += 1
        print(f"  LinkedIn people '{search['title']}' @ {search.get('location', '')}: {added} profiles.")
    print(f"  LinkedIn people search total: {len(out)}.")
    return out
