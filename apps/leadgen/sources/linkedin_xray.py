"""Phase 3 LinkedIn x-ray — SERP APIs only, never fetches or scrapes linkedin.com.

Two modes, both storing only what the search engine returned (title/snippet/URL):

- ``confirm_profile(name, org)``: given a person we extracted from the org's own site,
  find their linkedin.com/in profile URL to attach to the contact.
- ``discover_contacts(org, is_school)``: for accounts where crawling produced nobody,
  x-ray for the target roles and build contacts from the SERP result titles
  ("Jane Doe - Athletic Director - Foo High School | LinkedIn").
"""

from __future__ import annotations

import re

from utils.websearch import web_search

_PROFILE_RE = re.compile(r"linkedin\.com/in/[A-Za-z0-9\-_%]+", re.I)
_NAME_RE = re.compile(r"^([A-Z][a-z]+(?:\s+(?:[A-Z]\.|[A-Z][A-Za-z'’\-]*[a-z])){1,2})$")

_SCHOOL_XRAY_ROLES = '"athletic director" OR "activities director" OR "principal"'
_COALITION_XRAY_ROLES = '"executive director" OR "program coordinator" OR "prevention"'

_ROLE_IN_TITLE = re.compile(
    r"\b(athletic director|director of athletics|activities director|assistant principal|"
    r"vice principal|principal|executive director|deputy director|program director|"
    r"program coordinator|prevention coordinator|prevention specialist|program manager|"
    r"coalition coordinator|coalition director)\b",
    re.I,
)

# Generic org-name words that don't identify THIS org in a SERP title.
_GENERIC = {
    "school", "high", "middle", "elementary", "academy", "charter", "public", "county",
    "community", "coalition", "prevention", "council", "partnership", "district", "the",
    "for", "and", "of", "drug", "free", "alliance", "youth", "city",
}


def org_short(company: str) -> str:
    """'ALBANY HIGH SCHOOL — Albany, NY' → 'Albany High School'."""
    base = re.split(r"\s+[—–]\s+", company)[0].strip()
    return " ".join(w if (w.isupper() and len(w) <= 3) else w.capitalize() for w in base.split())


def _org_tokens(org: str) -> set[str]:
    return {t for t in re.findall(r"[a-z]+", org.lower()) if len(t) > 3 and t not in _GENERIC}


def _profile_url(link: str) -> str:
    m = _PROFILE_RE.search(link or "")
    return f"https://www.{m.group(0)}" if m else ""


def confirm_profile(name: str, org: str) -> str:
    """Return the person's linkedin.com/in URL, or "" when no confident match."""
    name = (name or "").strip()
    if len(name.split()) < 2:
        return ""
    results, provider = web_search(f'site:linkedin.com/in "{name}" {org}', num=5)
    if not results:
        return ""
    toks = [t for t in name.lower().split() if len(t) > 1]
    for r in results:
        url = _profile_url(r.get("link", ""))
        if not url:
            continue
        blob = f"{r.get('title', '')} {r.get('snippet', '')}".lower()
        # Confident match: the person's name in the result AND something tying it to the org.
        if all(t in blob for t in toks) and (
            _org_tokens(org) & set(re.findall(r"[a-z]+", blob)) or not _org_tokens(org)
        ):
            return url
    return ""


def discover_contacts(org: str, is_school: bool, *, max_contacts: int = 2) -> list[dict]:
    """X-ray for role-holders at ``org``; build contacts from SERP titles only."""
    roles = _SCHOOL_XRAY_ROLES if is_school else _COALITION_XRAY_ROLES
    results, provider = web_search(f'site:linkedin.com/in ({roles}) "{org}"', num=8)
    need = _org_tokens(org)

    def _tier(r: dict) -> int:
        """0 = org named in the result TITLE (current position on LinkedIn),
        1 = org only in the snippet (may be a past school — weaker)."""
        if not need:
            return 0
        if need & set(re.findall(r"[a-z]+", r.get("title", "").lower())):
            return 0
        return 1

    results = sorted(results, key=_tier)
    out: list[dict] = []
    seen: set[str] = set()
    for r in results:
        url = _profile_url(r.get("link", ""))
        if not url or url.lower() in seen:
            continue
        title_line = r.get("title", "")
        blob = f"{title_line} {r.get('snippet', '')}".lower()
        # The org must actually appear — otherwise it's someone else's AD.
        if need and not (need & set(re.findall(r"[a-z]+", blob))):
            continue
        # If we already have a title-confirmed person, don't pad with snippet-only ones.
        if out and _tier(r) == 1:
            break
        parts = re.split(r"\s+[-–|]\s+", title_line)
        if not parts:
            continue
        name = parts[0].strip()
        if not _NAME_RE.match(name):
            continue
        rm = _ROLE_IN_TITLE.search(" ".join(parts[1:]) or blob)
        if not rm:  # no target role in the result — could be a student/alum; skip
            continue
        job = rm.group(1).title()
        seen.add(url.lower())
        out.append({
            "name": name,
            "title": job,
            "email": "",
            "email_status": "",
            "phone": "",
            "linkedin_url": url,
        })
        if len(out) >= max_contacts:
            break
    return out
