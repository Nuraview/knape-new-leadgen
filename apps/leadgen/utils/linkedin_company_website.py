"""Resolve a real corporate website from LinkedIn company URLs / job payload fields.

LinkedIn job scrapers often set ``companyUrl`` to ``linkedin.com/company/…`` while the
external site lives on the company page HTML or in optional JSON fields.
"""

from __future__ import annotations

import re
import threading
import time
from typing import Any
from urllib.parse import urlparse

from config import (
    APIFY_LINKEDIN_COMPANY_WEBSITE_ACTOR,
    APIFY_TOKEN,
    LINKEDIN_COMPANY_WEBSITE_DELAY_S,
    LINKEDIN_RESOLVE_COMPANY_WEBSITE,
)
from utils.apify import apify_client_class
from utils.http import get_text

_LINKEDIN_HOST = "linkedin.com"
_DOMAIN_ONLY = re.compile(r"^(?:[\w-]+\.)+[a-z]{2,}$", re.I)

_GLOBAL_LI_LOCK = threading.Lock()
_GLOBAL_LI_WEBSITE_CACHE: dict[str, str] = {}


def _norm_url(u: str) -> str:
    s = (u or "").strip()
    if not s:
        return ""
    if s.startswith("//"):
        s = "https:" + s
    if not s.startswith("http"):
        s = "https://" + s.lstrip("/")
    return s.split("#")[0].strip()


def is_linkedin_company_url(url: str) -> bool:
    u = _norm_url(url).lower()
    return _LINKEDIN_HOST in u and "/company/" in u


def _host(url: str) -> str:
    try:
        return urlparse(_norm_url(url)).hostname or ""
    except Exception:
        return ""


def is_external_corporate_website(url: str) -> bool:
    """True for https URLs that are not LinkedIn / obvious social hosts."""
    u = _norm_url(url)
    if not u.lower().startswith("http"):
        return False
    h = _host(u).lower()
    if not h or _LINKEDIN_HOST in h or h.endswith(".linkedin.com"):
        return False
    blocked_exact = {
        "facebook.com",
        "fb.com",
        "twitter.com",
        "x.com",
        "instagram.com",
        "youtube.com",
        "youtu.be",
        "tiktok.com",
        "wikipedia.org",
        "linktr.ee",
        "maps.google.com",
        "bing.com",
        "pinterest.com",
        "google.com",
        "www.google.com",
    }
    if h in blocked_exact or any(h.endswith("." + b) for b in ("facebook.com", "twitter.com")):
        return False
    return True


def normalize_candidate_website(raw: object) -> str:
    """Turn ``company.com`` or ``https://company.com/path`` into a normalized https URL."""
    if not isinstance(raw, str):
        return ""
    s = raw.strip()
    if not s:
        return ""
    if s.lower().startswith(("http://", "https://")):
        return _norm_url(s)
    host = s.split("/")[0].strip().lower()
    if _DOMAIN_ONLY.match(host):
        return _norm_url(f"https://{host}")
    return ""


def _unescape_json_string_fragment(s: str) -> str:
    return (
        s.replace("\\/", "/")
        .replace("\\\\/", "/")
        .replace("\\u002f", "/")
        .replace("\\u002F", "/")
        .replace("&amp;", "&")
        .strip()
    )


def pick_external_website_from_job_item(item: dict[str, Any]) -> str:
    """Use any scraper-provided external site before HTTP-fetching LinkedIn."""
    flat_keys = (
        "companyWebsite",
        "companyDomain",
        "companyWebsiteUrl",
        "companyWebsiteDomain",
        "externalWebsite",
        "websiteUrl",
        "companyPublicWebsite",
        "employerWebsite",
        "employerCompanyWebsite",
        "externalUrl",
        "domain",
    )
    for k in flat_keys:
        v = normalize_candidate_website(item.get(k))
        if v and is_external_corporate_website(v):
            return v
    comp = item.get("company")
    if isinstance(comp, dict):
        for k in ("website", "websiteUrl", "externalUrl", "companyWebsite", "domain", "url"):
            v = normalize_candidate_website(comp.get(k))
            if v and is_external_corporate_website(v):
                return v
    emp = item.get("employer")
    if isinstance(emp, dict):
        for k in ("website", "websiteUrl", "companyWebsite", "domain"):
            v = normalize_candidate_website(emp.get(k))
            if v and is_external_corporate_website(v):
                return v
    return ""


def pick_linkedin_company_url_from_job_item(item: dict[str, Any]) -> str:
    for k in (
        "companyUrl",
        "companyLinkedInUrl",
        "companyLinkedinUrl",
        "employerLinkedinUrl",
        "linkedinCompanyUrl",
        "companyLinkedin",
    ):
        v = item.get(k)
        if isinstance(v, str) and is_linkedin_company_url(v):
            return _norm_url(v)
    comp = item.get("company")
    if isinstance(comp, dict):
        for k in ("url", "companyUrl", "linkedinUrl", "linkedinCompanyUrl"):
            v = comp.get(k)
            if isinstance(v, str) and is_linkedin_company_url(v):
                return _norm_url(v)
    emp = item.get("employer")
    if isinstance(emp, dict):
        for k in ("url", "companyUrl", "linkedinUrl"):
            v = emp.get(k)
            if isinstance(v, str) and is_linkedin_company_url(v):
                return _norm_url(v)
    for cid_key in ("companyId", "companyID", "company_id", "linkedinCompanyId"):
        cid = item.get(cid_key)
        if cid is None and isinstance(comp, dict):
            cid = comp.get(cid_key)
        if cid is None:
            continue
        s = str(cid).strip()
        if s.isdigit():
            return _norm_url(f"https://www.linkedin.com/company/{s}/")
    return ""


def extract_website_from_linkedin_company_html(html: str) -> str | None:
    """Best-effort parse of LinkedIn company HTML (Overview / About) for the public Website URL."""
    if not html or len(html) < 200:
        return None

    # LinkedIn embeds company fields in JSON (often with escaped slashes: https:\/\/host\/).
    json_value_keys = (
        "websiteUrl",
        "companyWebsite",
        "website",
        "externalUrl",
        "callToActionUrl",
        "companyWebsiteUrl",
        "formattedWebsiteUrl",
        "memberWebsiteUrl",
        "primaryWebsiteUrl",
        "companyExternalUrl",
        "externalPageUrl",
    )
    key_alt = "|".join(json_value_keys)
    for m in re.finditer(
        rf'"(?:{key_alt})"\s*:\s*"((?:[^"\\]|\\.)*?)"',
        html,
        re.I,
    ):
        raw = _unescape_json_string_fragment(m.group(1))
        u = normalize_candidate_website(raw) or _norm_url(raw)
        if is_external_corporate_website(u):
            return u
    for m in re.finditer(
        rf'"(?:{key_alt})"\s*:\s*\\"((?:[^"\\]|\\.)*?)\\"',
        html,
        re.I,
    ):
        raw = _unescape_json_string_fragment(m.group(1))
        u = normalize_candidate_website(raw) or _norm_url(raw)
        if is_external_corporate_website(u):
            return u

    # JSON-LD (Organization.url is often the corporate site)
    for m in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>([^<]{20,20000})</script>',
        html,
        re.I | re.DOTALL,
    ):
        chunk = m.group(1)
        for m2 in re.finditer(
            r'"@type"\s*:\s*"Organization"[^}]*?"url"\s*:\s*"(https?://[^"]+)"',
            chunk,
            re.I | re.DOTALL,
        ):
            u = normalize_candidate_website(m2.group(1)) or _norm_url(_unescape_json_string_fragment(m2.group(1)))
            if is_external_corporate_website(u):
                return u

    # callToAction WEBSITE (company page CTA)
    for m in re.finditer(
        r'"type"\s*:\s*"WEBSITE"[^}]{0,400}?"url"\s*:\s*"((?:[^"\\]|\\.)*?)"',
        html,
        re.I | re.DOTALL,
    ):
        raw = _unescape_json_string_fragment(m.group(1))
        u = normalize_candidate_website(raw) or _norm_url(raw)
        if is_external_corporate_website(u):
            return u

    # Overview "About us" row: "Website" label then external link (e.g. http://www.yamaha-motor.com).
    dom_patterns = (
        r'<dt[^>]*>\s*Website\s*</dt>[\s\S]{0,900}?<a[^>]+href="(https?://[^"]+)"',
        r'(?:>|\b)Website\s*</(?:span|dt|th|div|p|strong|b|h\d)[^>]{0,12}>[\s\S]{0,1400}?<a[^>]+href="(https?://[^"]+)"',
        r'data-tracking-control-name="[^"]*about_website[^"]*"[\s\S]{0,900}?href="(https?://[^"]+)"',
        r'href="(https?://[^"]+)"[^>]{0,160}?data-tracking-control-name="[^"]*about_website',
        r'aria-label="Website"[^>]{0,300}?href="(https?://[^"]+)"',
        r'href="(https?://[^"]+)"[^>]{0,200}?aria-label="Website"',
    )
    for pat in dom_patterns:
        for m in re.finditer(pat, html, re.I):
            u = _norm_url(_unescape_json_string_fragment(m.group(1)))
            if is_external_corporate_website(u):
                return u

    # Visible "Website" button href (locale-dependent; conservative match)
    for m in re.finditer(
        r'href="(https?://[^"]+)"[^>]{0,120}?(?:data-tracking-control-name="[^"]*about_website|>Website<)',
        html,
        re.I,
    ):
        u = _norm_url(m.group(1))
        if is_external_corporate_website(u):
            return u

    return None


def _linkedin_company_website_apify(li_url: str) -> str:
    """Run optional Apify LinkedIn company actor; returns corporate URL or ``""``."""
    actor = (APIFY_LINKEDIN_COMPANY_WEBSITE_ACTOR or "").strip()
    if not actor or not (APIFY_TOKEN or "").strip():
        return ""
    ApifyClient = apify_client_class()
    if ApifyClient is None:
        return ""
    uin = (li_url or "").split("?")[0].rstrip("/")
    if not uin:
        return ""
    client = ApifyClient(APIFY_TOKEN)
    try:
        run = client.actor(actor).call(run_input={"urls": [uin]})
        for item in client.dataset(run["defaultDatasetId"]).iterate_items():
            if not isinstance(item, dict):
                continue
            for key in ("website", "companyWebsite", "websiteUrl", "formattedWebsiteUrl", "domain"):
                raw = item.get(key)
                if key == "domain":
                    cand = normalize_candidate_website(raw)
                elif isinstance(raw, str):
                    cand = normalize_candidate_website(raw) or _norm_url(raw.strip())
                else:
                    cand = ""
                if cand and is_external_corporate_website(cand):
                    return cand
    except Exception as e:
        print(f"Warning: Apify company website actor {actor!r} failed for {uin[:56]}…: {e}")
    return ""


def _resolve_linkedin_company_to_corporate_website(
    li_co: str,
    local_cache: dict[str, str],
    fetch_http: bool,
    delay_s: float,
) -> str:
    """Resolve ``linkedin.com/company/…`` → corporate ``https?://…`` (HTTP, then optional Apify)."""
    li_co = _norm_url((li_co or "").strip())
    if not li_co:
        return ""
    if not is_linkedin_company_url(li_co):
        local_cache[li_co] = li_co
        return li_co

    if li_co in local_cache:
        return local_cache[li_co]
    with _GLOBAL_LI_LOCK:
        if li_co in _GLOBAL_LI_WEBSITE_CACHE:
            v = _GLOBAL_LI_WEBSITE_CACHE[li_co]
            local_cache[li_co] = v
            return v

    corporate = ""
    if fetch_http:
        if delay_s > 0:
            time.sleep(delay_s)
        url = li_co.split("?")[0].rstrip("/")
        url_about = (url + "/about/") if "/about" not in url.lower() else url
        html_main = get_text(url, timeout=22.0, silent=True)
        html_about = get_text(url_about, timeout=22.0, silent=True) if url_about != url else None
        found = extract_website_from_linkedin_company_html(html_main or "") if html_main else None
        if not found and html_about:
            found = extract_website_from_linkedin_company_html(html_about)
        w = (found or "").strip()
        if w and is_external_corporate_website(w):
            corporate = w

    if not corporate and (APIFY_LINKEDIN_COMPANY_WEBSITE_ACTOR or "").strip():
        corporate = _linkedin_company_website_apify(li_co) or ""

    final = corporate if corporate and is_external_corporate_website(corporate) else li_co
    with _GLOBAL_LI_LOCK:
        _GLOBAL_LI_WEBSITE_CACHE[li_co] = final
    local_cache[li_co] = final
    return final


def ensure_corporate_website_for_hunter(website: str) -> str:
    """If ``website`` is a LinkedIn company URL, resolve to a corporate site for Hunter ``website_to_domain``."""
    w = (website or "").strip()
    if not w or not is_linkedin_company_url(w):
        return w
    return _resolve_linkedin_company_to_corporate_website(
        w,
        {},
        LINKEDIN_RESOLVE_COMPANY_WEBSITE,
        LINKEDIN_COMPANY_WEBSITE_DELAY_S,
    )


def resolve_website_for_linkedin_job_row(
    item: dict[str, Any],
    *,
    cache: dict[str, str],
    fetch_enabled: bool,
    delay_s: float,
) -> str:
    """
    Return corporate ``https?://…`` for one job scraper row (Hunter-ready when possible).

    Uses job JSON fields, then HTTP parse of the company page, then optional Apify actor
    ``APIFY_LINKEDIN_COMPANY_WEBSITE_ACTOR``. Falls back to the LinkedIn company URL if needed.
    """
    direct = pick_external_website_from_job_item(item)
    if direct:
        return direct

    li_co = pick_linkedin_company_url_from_job_item(item)
    if not li_co:
        return ""

    return _resolve_linkedin_company_to_corporate_website(li_co, cache, fetch_enabled, delay_s)


def resolve_website_for_profile_row(
    item: dict[str, Any],
    *,
    cache: dict[str, str],
    fetch_enabled: bool,
    delay_s: float,
) -> str:
    """Profile scraper: keep external ``website``; resolve LinkedIn company URLs like job rows."""
    w = str(item.get("website") or "").strip()
    if w and is_external_corporate_website(w):
        return _norm_url(w)
    li_co = ""
    for k in ("companyUrl", "currentCompanyUrl", "organizationUrl", "companyLinkedinUrl"):
        v = item.get(k)
        if isinstance(v, str) and is_linkedin_company_url(v):
            li_co = _norm_url(v)
            break
    if not li_co and isinstance(item.get("company"), dict):
        v = item["company"].get("url")
        if isinstance(v, str) and is_linkedin_company_url(v):
            li_co = _norm_url(v)
    if not li_co and is_linkedin_company_url(w):
        li_co = _norm_url(w)
    comp = item.get("company")
    if not li_co:
        for cid_key in ("companyId", "companyID", "company_id", "linkedinCompanyId"):
            cid = item.get(cid_key)
            if cid is None and isinstance(comp, dict):
                cid = comp.get(cid_key)
            if cid is None:
                continue
            s = str(cid).strip()
            if s.isdigit():
                li_co = _norm_url(f"https://www.linkedin.com/company/{s}/")
                break
    if not li_co:
        return _norm_url(w) if is_external_corporate_website(w) else ""

    return _resolve_linkedin_company_to_corporate_website(li_co, cache, fetch_enabled, delay_s)
