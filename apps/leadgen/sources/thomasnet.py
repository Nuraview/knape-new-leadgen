"""ThomasNet.com supplier data via Apify (real-time scraper — not template data)."""

from __future__ import annotations

from config import (
    APIFY_TOKEN,
    APIFY_THOMASNET_ACTOR,
    APIFY_THOMASNET_MAX_PER_QUERY,
    APIFY_THOMASNET_QUERIES,
    THOMASNET_SCRAPE_MODE,
)
from utils.apify import apify_client_class
from utils.exclusions import is_excluded_record
from utils.signal_urls import (
    canonical_thomasnet_profile_url,
    is_thomasnet_listing_url,
    repair_lead_post_url,
)

_DEFAULT_QUERIES = (
    "packaged generator enclosure manufacturer",
    "oil gas skid fabricator",
    "marine HVAC contractor",
    "fire pump house fabricator",
    "modular process equipment manufacturer",
    "industrial HVAC equipment",
    "dust collection systems",
)

_THOMASNET_HOST = "thomasnet.com"


def _first(*vals: object) -> str:
    for v in vals:
        if v is None:
            continue
        s = str(v).strip()
        if s:
            return s
    return ""


def _resolve_thomasnet_post_url(item: dict, company: str, tgrams_id: str) -> str:
    """Prefer the actual ThomasNet listing; never fall back to the company homepage."""
    candidates: list[object] = [
        item.get("profileUrl"),
        item.get("supplierUrl"),
        item.get("listingUrl"),
        item.get("supplierPageUrl"),
        item.get("pageUrl"),
        item.get("url"),
        item.get("link"),
    ]
    for v in candidates:
        s = str(v).strip() if v is not None else ""
        if s and is_thomasnet_listing_url(s):
            return s
    built = canonical_thomasnet_profile_url(tgrams_id, company)
    if built:
        return built
    for v in candidates:
        s = str(v).strip() if v is not None else ""
        if s and _THOMASNET_HOST in s.lower():
            return s
    return ""


def _supplier_to_record(item: dict) -> dict:
    company = _first(item.get("name"), item.get("companyName"))
    tgrams_id = _first(item.get("tgramsId"), item.get("tGramsId"), item.get("tgrams_id"))
    website = _first(item.get("website"), item.get("primaryWebsite"))
    desc = _first(item.get("description"), item.get("shortDescription"))
    products = item.get("products") or []
    product_hint = ""
    if isinstance(products, list) and products:
        p0 = products[0]
        if isinstance(p0, dict):
            product_hint = _first(p0.get("name"), p0.get("title"))
    evidence = desc[:600] if desc else ""
    if not evidence:
        evidence = product_hint or "ThomasNet supplier profile (Apify scrape)."
    pers = item.get("personnel") or item.get("contacts") or item.get("people") or []
    person_name = ""
    job_title = ""
    if isinstance(pers, list) and pers:
        preferred = (
            "engineer",
            "engineering",
            "president",
            "director",
            "vp",
            "vice president",
            "sales",
            "manager",
            "buyer",
            "procurement",
        )
        fallback_name, fallback_title = "", ""
        for p in pers:
            if not isinstance(p, dict):
                continue
            name = _first(p.get("name"), p.get("fullName"))
            tit = _first(p.get("title"), p.get("jobTitle"))
            if not name:
                continue
            if not fallback_name:
                fallback_name, fallback_title = name, tit
            tl = tit.lower()
            if any(k in tl for k in preferred):
                person_name, job_title = name, tit
                break
        if not person_name:
            person_name, job_title = fallback_name, fallback_title
    post_url = _resolve_thomasnet_post_url(item, company, tgrams_id)
    record = {
        "company": company,
        "website": website,
        "post_url": post_url,
        "source": "ThomasNet.com",
        "signal_category": "",
        "signal_evidence": evidence,
        "person_name": person_name,
        "job_title": job_title,
    }
    return repair_lead_post_url(record)


def fetch_thomasnet() -> list[dict]:
    """Run the configured Apify ThomasNet scraper (requires ``APIFY_TOKEN``).

    Environment:
    - ``APIFY_THOMASNET_ACTOR`` (default ``zen-studio/thomasnet-suppliers-scraper``)
    - ``APIFY_THOMASNET_QUERIES`` — comma-separated search strings
    - ``APIFY_THOMASNET_MAX_PER_QUERY`` — max suppliers per query (default 35)
    - ``THOMASNET_SCRAPE_MODE`` — ``all`` or ``name`` (default ``all``)
    """
    if not APIFY_TOKEN:
        print(
            "Warning: ThomasNet.com — skipped (set APIFY_TOKEN and APIFY_THOMASNET_QUERIES)."
        )
        return []

    raw_q = (APIFY_THOMASNET_QUERIES or "").strip()
    queries = [q.strip() for q in raw_q.split(",") if q.strip()] if raw_q else list(_DEFAULT_QUERIES)

    ApifyClient = apify_client_class()
    if ApifyClient is None:
        print(
            "Warning: apify-client not installed. Skipping ThomasNet. "
            "Install: python3 -m pip install apify-client"
        )
        return []

    client = ApifyClient(APIFY_TOKEN)
    actor_id = (APIFY_THOMASNET_ACTOR or "zen-studio/thomasnet-suppliers-scraper").strip()
    mode = (THOMASNET_SCRAPE_MODE or "all").strip()
    max_per = max(1, int(APIFY_THOMASNET_MAX_PER_QUERY))

    seen: set[tuple[str, str]] = set()
    out: list[dict] = []

    for query in queries:
        run_input = {"query": query, "mode": mode, "maxResults": max_per}
        try:
            run = client.actor(actor_id).call(run_input=run_input)
            for item in client.dataset(run["defaultDatasetId"]).iterate_items():
                if not isinstance(item, dict):
                    continue
                rec = _supplier_to_record(item)
                if is_excluded_record(rec):
                    continue
                tid = _first(item.get("tgramsId"), item.get("tGramsId"), item.get("tgrams_id")).lower()
                dedupe_site = rec["website"].lower()
                key = (rec["company"].lower(), tid or dedupe_site or rec["post_url"].lower())
                if not rec["company"] or key in seen:
                    continue
                seen.add(key)
                out.append(rec)
        except Exception as e:
            err = str(e)
            if "402" in err or "PAYMENT" in err.upper():
                print("Warning: ThomasNet Apify actor requires credits. Stopping ThomasNet fetch.")
                break
            print(f"Warning: ThomasNet query {query!r} failed: {e}")

    if out:
        print(f"  ThomasNet.com (Apify): {len(out)} supplier rows.")
    else:
        print(
            "Warning: ThomasNet.com — 0 rows. Check APIFY_TOKEN, actor billing, and queries."
        )
    return out
