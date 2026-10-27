"""Contact spine: crawl a company's own website for public team/leadership contacts.

Waterfall per account:
1. Locate a team/leadership/contact page on the org's own site (URL heuristics, then
   Serper ``site:<domain> ...`` when a key is configured).
2. Claude-extract ``[{name, title, email, phone}]`` from the page text, keeping
   Knape buyer roles (engineering, facilities/plant/operations, vessel/fleet
   superintendents, project managers, purchasing, owners/executives).
3. Serper LinkedIn x-ray: ``site:linkedin.com/in "<title>" "<org>"`` → top hit.
4. Email pattern inference from other public emails on the same domain, marked
   ``pattern_guess`` (verify later; never sent unverified).

Results cache to ``outreach_data/contacts_cache.json`` so re-runs are free.
All data scraped is public team-directory information.
"""

from __future__ import annotations

import json
import re
import time
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

from outreach.claude_llm import claude_enabled, claude_generate_text, parse_json_object
from utils.http import get_text
from utils.serper import serper_enabled, serper_search

_CACHE_PATH = Path(__file__).resolve().parent.parent / "outreach_data" / "contacts_cache.json"

# (hint substring, priority weight) — higher = more likely a real people directory.
_STAFF_PATH_HINTS: tuple[tuple[str, int], ...] = (
    ("leadership", 10),
    ("our-team", 10),
    ("management", 9),
    ("directory", 9),
    ("executive", 8),
    ("our-people", 8),
    ("team", 7),
    ("people", 6),
    ("about-us", 5),
    ("contact-us", 5),
    ("contact", 4),
    ("about", 3),
    ("staff", 2),  # weak: floods with resource pages ("for-staff/*")
)
# Knape Associates' buyers: who specifies, maintains, runs or buys industrial air-movement gear.
_ROLE_KEEP = re.compile(
    r"engineer|naval architect|facilit|plant manager|maintenance|operations|superintendent|"
    r"port captain|project manager|construction manager|purchasing|procurement|buyer|"
    r"supply chain|owner|president|general manager|\bceo\b|\bcoo\b|chief operating|founder",
    re.I,
)

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")

_EXTRACT_SYSTEM = (
    "You extract TEAM CONTACTS from a company's web page text (industrial, marine/offshore, "
    "oil & gas, power, wastewater, manufacturing, contracting, engineering firms). "
    "Return ONLY a JSON object: {\"contacts\": [{\"name\": str, \"title\": str, "
    "\"email\": str, \"phone\": str}]}. Include only people whose role relates to: "
    "engineering (design, project, mechanical, marine, port or HVAC engineer, naval architect, "
    "engineering manager, chief engineer), facilities/plant/maintenance/operations "
    "(facilities, plant, maintenance or operations manager/director/superintendent), vessel "
    "operations (vessel, fleet, technical or marine superintendent, port captain), project "
    "management (project or construction manager), procurement (purchasing, procurement, "
    "buyer, supply chain), or leadership (owner, founder, president, CEO, COO, general manager, "
    "VP of operations). Use empty strings for unknown fields. Never invent emails or names not "
    "present in the text. Max 6 contacts."
)


class _TextExtractor(HTMLParser):
    """HTML → visible text + links (stdlib only, consistent with repo's no-deps style)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.chunks: list[str] = []
        self.links: list[tuple[str, str]] = []  # (href, anchor text)
        self._skip_depth = 0
        self._current_href: str | None = None
        self._anchor_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in ("script", "style", "noscript"):
            self._skip_depth += 1
        elif tag == "a":
            href = dict(attrs).get("href") or ""
            self._current_href = href
            self._anchor_text = []

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript") and self._skip_depth:
            self._skip_depth -= 1
        elif tag == "a" and self._current_href is not None:
            self.links.append((self._current_href, " ".join(self._anchor_text).strip()))
            self._current_href = None

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        s = data.strip()
        if s:
            self.chunks.append(s)
            if self._current_href is not None:
                self._anchor_text.append(s)

    @property
    def text(self) -> str:
        return "\n".join(self.chunks)


def _fetch_page(url: str) -> _TextExtractor | None:
    html = get_text(url, timeout=20.0, silent=True)
    if not html:
        return None
    p = _TextExtractor()
    try:
        p.feed(html)
    except Exception:  # noqa: BLE001 — malformed HTML must not kill the run
        return None
    return p


def _candidate_staff_urls(base_url: str, home: _TextExtractor | None) -> list[str]:
    """Candidate URLs for the team/leadership page, ranked by hint quality."""
    parsed = urlparse(base_url if base_url.startswith("http") else f"http://{base_url}")
    root = f"{parsed.scheme}://{parsed.netloc}"
    scored: dict[str, int] = {}
    if home is not None:
        for href, anchor in home.links:
            blob = f"{href} {anchor}".lower()
            weight = 0
            for hint, w in _STAFF_PATH_HINTS:
                if hint in blob:
                    weight = max(weight, w)
            if weight == 0:
                continue
            absolute = urljoin(base_url, href).split("#")[0]
            netloc = urlparse(absolute).netloc
            same_domain = parsed.netloc.split(".")[-2:] == netloc.split(".")[-2:]
            # Same organization only: a company's people are on its own (sub)domain.
            if netloc != parsed.netloc and not same_domain:
                continue
            # Anchor text that names the page directly is the strongest signal.
            low_anchor = (anchor or "").lower()
            if any(k in low_anchor for k in ("leadership", "our team", "management", "directory")):
                weight += 3
            scored[absolute] = max(scored.get(absolute, 0), weight)
    ordered = [u for u, _ in sorted(scored.items(), key=lambda kv: -kv[1])]
    for path in ("/leadership", "/our-team", "/about/leadership", "/team", "/about-us", "/contact"):
        u = root + path
        if u not in scored:
            ordered.append(u)
    return ordered[:8]


def _serper_staff_page(domain: str, org_name: str) -> list[str]:
    if not serper_enabled():
        return []
    results = serper_search(
        f'site:{domain} leadership OR "our team" OR "management team" OR engineering', num=5
    )
    return [r["link"] for r in results][:3]


def _extract_contacts_llm(page_text: str, org_name: str) -> list[dict]:
    if not claude_enabled() or not page_text.strip():
        return []
    try:
        content = claude_generate_text(
            system_instruction=_EXTRACT_SYSTEM,
            user_text=json.dumps({"organization": org_name, "page_text": page_text[:14000]}),
            max_tokens=2048,
            timeout=90.0,
        )
        parsed = parse_json_object(content)
    except Exception as e:  # noqa: BLE001
        print(f"    Warning: contact extraction failed for {org_name}: {str(e)[:100]}")
        return []
    rows = parsed.get("contacts") if isinstance(parsed, dict) else None
    out: list[dict] = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        name = str(r.get("name") or "").strip()
        title = str(r.get("title") or "").strip()
        if not name or not _ROLE_KEEP.search(title or ""):
            continue
        email = str(r.get("email") or "").strip().lower()
        if email and not _EMAIL_RE.fullmatch(email):
            email = ""
        out.append(
            {
                "name": name,
                "title": title,
                "email": email,
                "phone": str(r.get("phone") or "").strip(),
            }
        )
    return out[:6]


def _infer_email_pattern(domain_emails: list[str], person_name: str) -> str:
    """Guess a person's email from patterns observed in other emails on the domain."""
    parts = [p for p in re.split(r"[\s.-]+", person_name.lower()) if p.isalpha()]
    if len(parts) < 2 or not domain_emails:
        return ""
    first, last = parts[0], parts[-1]
    domain = domain_emails[0].split("@", 1)[1]
    counts: dict[str, int] = {}
    for e in domain_emails:
        local = e.split("@", 1)[0]
        if "." in local:
            counts["first.last"] = counts.get("first.last", 0) + 1
        elif "_" in local:
            counts["first_last"] = counts.get("first_last", 0) + 1
        elif len(local) > 1:
            counts["flast"] = counts.get("flast", 0) + 1
    if not counts:
        return ""
    best = max(counts, key=counts.get)
    local = {
        "first.last": f"{first}.{last}",
        "first_last": f"{first}_{last}",
        "flast": f"{first[0]}{last}",
    }[best]
    return f"{local}@{domain}"


def _linkedin_xray(org_name: str, title_hint: str) -> str:
    if not serper_enabled():
        return ""
    clean_org = org_name.split("—")[0].strip()
    results = serper_search(f'site:linkedin.com/in "{title_hint}" "{clean_org}"', num=5)
    for r in results:
        if "linkedin.com/in/" in r["link"]:
            return r["link"].split("?")[0]
    return ""


def _load_cache() -> dict[str, Any]:
    try:
        return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _save_cache(cache: dict[str, Any]) -> None:
    try:
        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CACHE_PATH.write_text(json.dumps(cache, indent=1), encoding="utf-8")
    except OSError as e:
        print(f"Warning: could not save contacts cache: {e}")


def crawl_account_contacts(company: str, website: str, is_school: bool) -> dict[str, Any]:
    """One account → {"contacts": [...], "linkedin_url": str}. Cached by company."""
    cache = _load_cache()
    key = company.strip().upper()
    if key in cache:
        return cache[key]

    result: dict[str, Any] = {"contacts": [], "linkedin_url": "", "website": ""}
    site = (website or "").strip()

    if not site and serper_enabled():
        clean = company.split("—")[0].strip()
        hits = serper_search(f'"{clean}" official website', num=3)
        for h in hits:
            netloc = urlparse(h["link"]).netloc.lower()
            if not any(b in netloc for b in ("facebook.", "linkedin.", "usaspending", "wikipedia", "instagram.")):
                site = h["link"]
                break

    if site:
        base = site if site.startswith("http") else f"http://{site}"
        home = _fetch_page(base)
        candidates = _candidate_staff_urls(base, home)
        domain = urlparse(base).netloc
        candidates += _serper_staff_page(domain, company)

        page_texts: list[str] = []
        raw_emails: list[str] = []
        for url in candidates[:6]:
            page = _fetch_page(url)
            if page is None:
                continue
            txt = page.text
            raw_emails += _EMAIL_RE.findall(txt)
            if _ROLE_KEEP.search(txt):
                page_texts.append(txt)
            if len(page_texts) >= 2:
                break
        if home is not None and not page_texts and _ROLE_KEEP.search(home.text):
            page_texts.append(home.text)

        if page_texts:
            result["contacts"] = _extract_contacts_llm("\n\n".join(page_texts), company)

        domain_emails = sorted({e.lower() for e in raw_emails if "@" in e})
        for c in result["contacts"]:
            if not c["email"] and domain_emails:
                guess = _infer_email_pattern(domain_emails, c["name"])
                if guess:
                    c["email"] = guess
                    c["email_status"] = "pattern_guess"

    # Institutions buy through facilities; companies through operations/engineering.
    title_hint = "Director of Facilities" if is_school else "Operations Manager"
    best_name = result["contacts"][0]["name"] if result["contacts"] else ""
    result["linkedin_url"] = _linkedin_xray(company, best_name or title_hint)
    # Expose the resolved site so callers can backfill an account that had no website.
    result["website"] = site

    cache[key] = result
    _save_cache(cache)
    time.sleep(0.2)
    return result
