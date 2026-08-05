"""Apollo.io organization enrichment — the free plan's ONE working endpoint.

Verified live: ``people/match`` and ``people/search`` both 403 ("not included in your
Free plan... even with a master key" — needs a paid upgrade). ``organizations/enrich``
returns 200 on the same key and gives real phone + LinkedIn data straight from Apollo's
own database — official, not scraped — so it's tried FIRST, ahead of the Serper Places
/ search-based fallbacks in ``pipeline.org_contact`` / ``pipeline.org_linkedin``.

Keyed by domain, so for a school on a shared district site (most of them), the phone and
LinkedIn page returned are the DISTRICT's — same honest labeling as the rest of the org
LinkedIn feature. No email field exists on this endpoint; org email still comes from the
site-scan / snippet-search fallback.
"""

from __future__ import annotations

from typing import Any


def _domain_of(website: str) -> str:
    from urllib.parse import urlparse

    if not (website or "").strip():
        return ""
    h = urlparse(website if website.startswith("http") else f"https://{website}").netloc.lower()
    return h[4:] if h.startswith("www.") else h


def _https(url: str) -> str:
    url = (url or "").strip()
    if url.startswith("http://"):
        url = "https://" + url[len("http://") :]
    return url


def _classify_kind(apollo_org_name: str, company: str, is_school: bool) -> str:
    """'own' vs 'district' — 'district' specifically means "this school's parent
    district", so it only makes sense for schools. A school's website is usually the
    whole district's domain (Houston ISD, Fulton County Schools…), so a school with a
    name mismatch defaults to 'district'. A coalition/nonprofit's OWN domain enriching
    to a slightly different registered name (tax filing name vs. public name) is still
    almost certainly the same org, so it defaults to 'own' instead."""
    from pipeline.org_linkedin import _DISTRICT_WORDS, _toks, org_name

    low = (apollo_org_name or "").lower()
    if is_school and any(w in low for w in _DISTRICT_WORDS):
        return "district"
    ot, at = _toks(org_name(company)), _toks(apollo_org_name)
    if ot and at and ot == at:
        return "own"
    return "district" if is_school else "own"


def enrich_org(website: str, company: str = "", is_school: bool = True) -> dict[str, Any]:
    """Return {'phone', 'linkedin_url', 'linkedin_kind'} from Apollo's org database, or
    {} when Apollo has nothing for this domain, the key is missing, or the call fails."""
    import json
    import urllib.error
    import urllib.request

    from pipeline.org_contact import _norm_phone
    from utils.websearch import get_key, report_ok, report_quota

    domain = _domain_of(website)
    if not domain:
        return {}
    key = get_key("apollo")
    if not key:
        return {}

    req = urllib.request.Request(
        "https://api.apollo.io/api/v1/organizations/enrich",
        data=json.dumps({"domain": domain}).encode(),
        method="POST",
        headers={"Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": key},
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            payload = json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        report_quota("apollo", f"HTTP {e.code}: {body[:250]}")
        return {}
    except Exception as e:  # noqa: BLE001 — one bad lookup must not break the account
        report_quota("apollo", str(e)[:200])
        return {}

    report_ok("apollo")
    org = payload.get("organization") or {}
    if not org:
        return {}

    out: dict[str, Any] = {}
    raw_phone = str(org.get("phone") or (org.get("primary_phone") or {}).get("number") or "")
    phone = _norm_phone(raw_phone)
    if phone:
        out["phone"] = phone
    li = _https(str(org.get("linkedin_url") or ""))
    if li and "linkedin.com/company/" in li.lower():
        out["linkedin_url"] = li
        out["linkedin_kind"] = _classify_kind(str(org.get("name") or ""), company, is_school)
    return out
