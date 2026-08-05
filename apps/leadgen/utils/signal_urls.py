"""Resolve listing / signal URLs for leads (ThomasNet, job boards, etc.)."""

from __future__ import annotations

import re
from typing import Any

_THOMASNET_HOST = "thomasnet.com"

_LISTING_HOST_MARKERS: tuple[str, ...] = (
    "thomasnet.com/company",
    "thomasnet.com/supplier",
    "thomasnet.com/profile",
    "thomasnet.com/suppliers",
    "linkedin.com/jobs",
    "indeed.com",
    "glassdoor.com",
    "ziprecruiter.com",
    "monster.com",
    "simplyhired.",
    "dice.com",
    "construction.com",
    "constructconnect",
    "civcast",
)

_THOMASNET_URL_RE = re.compile(
    r"https?://(?:www\.)?thomasnet\.com/(?:company/[^\s\"'<>]+|supplier[^\s\"'<>]*)",
    re.I,
)


def url_identity(u: str) -> str:
    s = (u or "").strip().rstrip("/").lower()
    if s.startswith("http://"):
        s = "https://" + s[7:]
    for prefix in ("https://www.", "http://www.", "https://", "http://"):
        if s.startswith(prefix):
            s = s[len(prefix) :]
            break
    return s.rstrip("/")


def urls_same(a: str, b: str) -> bool:
    ia = url_identity(a)
    ib = url_identity(b)
    return bool(ia) and ia == ib


def is_thomasnet_listing_url(url: str) -> bool:
    u = (url or "").lower()
    if _THOMASNET_HOST not in u:
        return False
    if "cdn.thomasnet.com" in u and "/company/" not in u:
        return False
    return "/company/" in u or "/profile" in u or "/supplier" in u


def is_listing_signal_url(url: str) -> bool:
    low = (url or "").lower()
    if not low.startswith("http"):
        return False
    return any(marker in low for marker in _LISTING_HOST_MARKERS)


def extract_thomasnet_urls(text: str) -> list[str]:
    if not text:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for match in _THOMASNET_URL_RE.finditer(text):
        u = match.group(0).rstrip(".,);]")
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def slugify_company_segment(name: str) -> str:
    s = (name or "").lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return (s[:120] if s else "") or "supplier"


def canonical_thomasnet_profile_url(tgrams_id: str, company: str) -> str:
    tid = str(tgrams_id or "").strip()
    if not tid or not tid.isdigit():
        return ""
    slug = slugify_company_segment(company)
    return f"https://www.thomasnet.com/company/{slug}-{tid}/profile"


def is_thomasnet_source(record: dict[str, Any]) -> bool:
    return "thomasnet" in str(record.get("source") or "").lower()


def group_has_thomasnet_source(leads: list[dict[str, Any]], best: dict[str, Any]) -> bool:
    for row in (best, *leads):
        if is_thomasnet_source(row):
            return True
    return False


def repair_lead_post_url(record: dict[str, Any]) -> dict[str, Any]:
    """Fix legacy rows where ``post_url`` duplicates ``website`` instead of ThomasNet listing."""
    out = dict(record)
    if not is_thomasnet_source(out):
        return out

    post = str(out.get("post_url") or "").strip()
    website = str(out.get("website") or "").strip()

    if post and is_thomasnet_listing_url(post):
        out["post_url"] = post
        return out

    for field in ("post_url", "signal_evidence", "company_profile"):
        for candidate in extract_thomasnet_urls(str(out.get(field) or "")):
            if is_thomasnet_listing_url(candidate):
                out["post_url"] = candidate
                return out

    if post and website and urls_same(post, website):
        out["post_url"] = ""
    elif post and not is_thomasnet_listing_url(post):
        out["post_url"] = ""
    return out


def collect_signal_url_candidates(
    leads: list[dict[str, Any]],
    best: dict[str, Any],
) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()

    def add(u: str) -> None:
        s = (u or "").strip()
        if not s or s in seen:
            return
        seen.add(s)
        ordered.append(s)

    for row in leads:
        add(str(row.get("post_url") or ""))
        for field in ("signal_evidence", "company_profile"):
            for u in extract_thomasnet_urls(str(row.get(field) or "")):
                add(u)
    add(str(best.get("post_url") or ""))
    for field in ("signal_evidence", "company_profile"):
        for u in extract_thomasnet_urls(str(best.get(field) or "")):
            add(u)
    return ordered


def pick_signal_url_for_account(
    leads: list[dict[str, Any]],
    best: dict[str, Any],
    account_website: str,
) -> str:
    """Pick the best external listing URL; never use the corporate homepage as the source link."""
    site_id = url_identity(account_website) if account_website else ""
    candidates = collect_signal_url_candidates(leads, best)

    for u in candidates:
        if is_listing_signal_url(u):
            return u

    for u in candidates:
        if not u.lower().startswith("http"):
            continue
        if site_id and urls_same(u, account_website):
            continue
        return u

    return ""
