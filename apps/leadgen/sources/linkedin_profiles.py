"""LinkedIn profile–style leads via Apify (optional)."""

from __future__ import annotations

import json
import os

from config import (
    APIFY_TOKEN,
    LINKEDIN_COMPANY_WEBSITE_DELAY_S,
    LINKEDIN_PROFILES_MAX_URLS,
    LINKEDIN_RESOLVE_COMPANY_WEBSITE,
)
from utils.apify import apify_client_class
from utils.linkedin_company_website import is_linkedin_company_url, resolve_website_for_profile_row


def fetch_linkedin_profiles() -> list[dict]:
    """Run a profile scraper when URLs and actor are configured.

    - ``APIFY_LINKEDIN_PROFILE_URLS``: comma-separated profile URLs
    - ``APIFY_LINKEDIN_PROFILE_ACTOR``: Apify actor ID (required for a live run)
    - ``APIFY_LINKEDIN_PROFILE_RUN_INPUT``: optional JSON object **instead of**
      the default ``{"profileUrls": [...]}`` shape (for actors with different input)
    """
    if not APIFY_TOKEN:
        return []

    actor_id = os.getenv("APIFY_LINKEDIN_PROFILE_ACTOR", "").strip()
    raw_urls = os.getenv("APIFY_LINKEDIN_PROFILE_URLS", "").strip()
    custom_input = os.getenv("APIFY_LINKEDIN_PROFILE_RUN_INPUT", "").strip()

    if custom_input:
        try:
            run_input = json.loads(custom_input)
        except json.JSONDecodeError:
            print("Warning: APIFY_LINKEDIN_PROFILE_RUN_INPUT is not valid JSON. Skipping profiles.")
            return []
        if not actor_id:
            print("Warning: APIFY_LINKEDIN_PROFILE_ACTOR required with custom run input. Skipping profiles.")
            return []
    else:
        if not raw_urls or not actor_id:
            return []
        urls = [u.strip() for u in raw_urls.split(",") if u.strip()]
        if not urls:
            return []
        if LINKEDIN_PROFILES_MAX_URLS > 0:
            urls = urls[:LINKEDIN_PROFILES_MAX_URLS]
        run_input = {"profileUrls": urls}

    ApifyClient = apify_client_class()
    if ApifyClient is None:
        print(
            "Warning: apify-client not installed. Skipping LinkedIn profiles. "
            "Install: python3 -m pip install apify-client"
        )
        return []

    client = ApifyClient(APIFY_TOKEN)
    results: list[dict] = []
    company_page_cache: dict[str, str] = {}

    try:
        run = client.actor(actor_id).call(run_input=run_input)
        for item in client.dataset(run["defaultDatasetId"]).iterate_items():
            name = (
                item.get("fullName")
                or item.get("name")
                or " ".join(
                    filter(
                        None,
                        (item.get("firstName"), item.get("lastName")),
                    )
                )
            )
            title = item.get("headline") or item.get("jobTitle") or ""
            company = item.get("companyName") or item.get("company") or ""
            website = resolve_website_for_profile_row(
                item if isinstance(item, dict) else {},
                cache=company_page_cache,
                fetch_enabled=LINKEDIN_RESOLVE_COMPANY_WEBSITE,
                delay_s=LINKEDIN_COMPANY_WEBSITE_DELAY_S,
            )
            results.append(
                {
                    "company": str(company or "").strip(),
                    "website": website,
                    "post_url": str(item.get("url") or item.get("profileUrl") or "").strip(),
                    "source": "LinkedIn Profiles",
                    "signal_category": "",
                    "signal_evidence": str(title or "LinkedIn profile — technical buyer.").strip(),
                    "person_name": str(name or "").strip(),
                    "job_title": str(title or "").strip(),
                }
            )
    except Exception as e:
        err = str(e)
        if "402" in err or "PAYMENT" in err.upper():
            print("Warning: LinkedIn profile actor requires Apify credits. Skipping profiles.")
            return []
        print(f"Warning: LinkedIn profiles scrape failed: {e}")
        return []

    if LINKEDIN_RESOLVE_COMPANY_WEBSITE and company_page_cache:
        resolved = sum(
            1 for v in company_page_cache.values() if v and not is_linkedin_company_url(v)
        )
        if resolved:
            print(
                f"  LinkedIn Profiles: resolved corporate website for {resolved} / {len(company_page_cache)} "
                "distinct company pages (HTTP)."
            )

    return results
