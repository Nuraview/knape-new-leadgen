"""LinkedIn Jobs via Apify. Per-search volume = ``LINKEDIN_JOBS_LIMIT_*`` in ``config.py``."""

from config import (
    APIFY_TOKEN,
    LINKEDIN_COMPANY_WEBSITE_DELAY_S,
    LINKEDIN_JOBS_LIMIT_DEFAULT,
    LINKEDIN_JOBS_LIMIT_TARGETED,
    LINKEDIN_RESOLVE_COMPANY_WEBSITE,
    TARGET_JOB_TITLES,
)
from utils.apify import apify_client_class
from utils.exclusions import is_excluded_record
from utils.linkedin_company_website import is_linkedin_company_url, resolve_website_for_linkedin_job_row

# Apify Store: https://apify.com/valig/linkedin-jobs-scraper
LINKEDIN_JOBS_ACTOR = "valig/linkedin-jobs-scraper"

_TITLE_SIGNAL_HINTS: tuple[tuple[str, str], ...] = (
    ("Facility Expansion Manager", "facility_expansion"),
    ("Plant Expansion Project Manager", "facility_expansion"),
    ("Product Development Engineer", "new_product_development"),
    ("R&D Engineer", "new_product_development"),
)

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


def _extract_job_poster_name(item: dict) -> str:
    """Best-effort contact name from LinkedIn job JSON (field names vary by actor)."""
    key_candidates = (
        "posterName",
        "jobPosterName",
        "postedByName",
        "hiringManagerName",
        "recruiterName",
        "recruiterFullName",
        "recruiter",
        "contactName",
        "authorName",
        "employerContactName",
    )
    for k in key_candidates:
        v = item.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    jp_raw = item.get("jobPoster")
    if isinstance(jp_raw, str) and jp_raw.strip():
        return jp_raw.strip()
    nested_keys = (
        "poster",
        "jobPoster",
        "hiringManager",
        "recruiter",
        "postedBy",
        "author",
        "employer",
    )
    for nk in nested_keys:
        sub = item.get(nk)
        if isinstance(sub, dict):
            name = sub.get("name") or sub.get("fullName")
            if isinstance(name, str) and name.strip():
                return name.strip()
            first = sub.get("firstName")
            last = sub.get("lastName")
            if isinstance(first, str) and first.strip():
                return f"{first.strip()} {last.strip()}".strip() if isinstance(last, str) else first.strip()
    return ""


def _extract_job_poster_role(item: dict) -> str:
    """Professional title of the job poster / recruiter (not the vacancy's listing title)."""
    key_candidates = (
        "recruiterTitle",
        "posterTitle",
        "jobPosterTitle",
        "hiringManagerTitle",
        "postedByTitle",
        "contactTitle",
        "employerContactTitle",
        "jobPosterHeadline",
        "recruiterHeadline",
    )
    for k in key_candidates:
        v = item.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    nested_keys = (
        "poster",
        "jobPoster",
        "hiringManager",
        "recruiter",
        "postedBy",
        "author",
        "employer",
    )
    for nk in nested_keys:
        sub = item.get(nk)
        if not isinstance(sub, dict):
            continue
        for rk in (
            "title",
            "jobTitle",
            "headline",
            "occupation",
            "position",
            "role",
        ):
            rv = sub.get(rk)
            if isinstance(rv, str) and rv.strip():
                return rv.strip()
    return ""


def fetch_linkedin_jobs() -> list[dict]:
    if not APIFY_TOKEN:
        print("Warning: APIFY_TOKEN not set. Skipping LinkedIn Jobs.")
        return []

    ApifyClient = apify_client_class()
    if ApifyClient is None:
        print(
            "Warning: apify-client not installed. Skipping LinkedIn Jobs. "
            "Install: python3 -m pip install apify-client"
        )
        return []

    client = ApifyClient(APIFY_TOKEN)

    # Run broad engineering searches + targeted expansion/product searches.
    title_signal_pairs: list[tuple[str, str, int]] = [
        (t, "", LINKEDIN_JOBS_LIMIT_DEFAULT) for t in TARGET_JOB_TITLES
    ]
    title_signal_pairs.extend(
        (title, signal, LINKEDIN_JOBS_LIMIT_TARGETED) for title, signal in _TITLE_SIGNAL_HINTS
    )

    try:
        all_items: list[dict] = []
        seen: set[object] = set()
        for title, signal_hint, limit in title_signal_pairs:
            run_input = {
                "title": title,
                "location": "United States",
                "limit": limit,
            }
            run = client.actor(LINKEDIN_JOBS_ACTOR).call(run_input=run_input)
            for item in client.dataset(run["defaultDatasetId"]).iterate_items():
                jid = item.get("id") or item.get("url") or (
                    item.get("title"),
                    item.get("companyName"),
                )
                if jid in seen:
                    continue
                seen.add(jid)
                if signal_hint and not item.get("signal_category"):
                    item["signal_category"] = signal_hint
                all_items.append(item)
    except Exception as e:
        error_msg = str(e)
        if _is_apify_billing_limit_error(error_msg):
            print(
                "Warning: LinkedIn Jobs scraper billing/usage limit reached. "
                "Skipping LinkedIn Jobs."
            )
            return []
        raise

    results: list[dict] = []
    company_page_cache: dict[str, str] = {}
    for item in all_items:
        desc = (
            item.get("description")
            or item.get("jobDescription")
            or item.get("descriptionText")
            or ""
        )
        title = item.get("title") or ""
        desc_snip = str(desc)[:800] if desc else ""
        evidence = title if not desc_snip else f"{title} | {desc_snip}"
        poster = _extract_job_poster_name(item)
        poster_role = _extract_job_poster_role(item)
        website = resolve_website_for_linkedin_job_row(
            item,
            cache=company_page_cache,
            fetch_enabled=LINKEDIN_RESOLVE_COMPANY_WEBSITE,
            delay_s=LINKEDIN_COMPANY_WEBSITE_DELAY_S,
        )
        record = {
            "company": item.get("companyName") or "",
            "website": website,
            "post_url": str(item.get("url") or item.get("jobUrl") or item.get("link") or "").strip(),
            "source": "LinkedIn Job Postings",
            "signal_category": str(item.get("signal_category") or "").strip(),
            "signal_evidence": evidence,
            "person_name": poster,
            "job_title": poster_role,
        }
        if is_excluded_record(record):
            continue
        results.append(record)

    if LINKEDIN_RESOLVE_COMPANY_WEBSITE and company_page_cache:
        resolved = sum(
            1 for v in company_page_cache.values() if v and not is_linkedin_company_url(v)
        )
        if resolved:
            print(
                f"  LinkedIn Jobs: resolved corporate website for {resolved} / {len(company_page_cache)} "
                "distinct company pages (HTTP)."
            )

    return results
