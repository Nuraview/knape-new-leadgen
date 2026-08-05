"""Harvest staff emails out of Google's index, one credit at a time.

The long way round to this module is worth recording, because it was a whole
morning: school staff directories refuse a plain fetch (robots, Cloudflare,
403), so the plan was Bright Data's Web Unlocker to fetch the page and parse it.
That needs a separate zone, the zone needs a payment method, and the account is
on free credits.

None of it was necessary. Google has already crawled those directories, and the
SERP API — the zone that already exists — returns the addresses in the result
snippets:

    "athletic director" aps.edu contact
        -> chad.jones@aps.edu, robin.weaks@aps.edu
    austinisd.org athletic director email
        -> amy.ngo@austinisd.org, andres.zamora@austinisd.org

One request, one credit, several real addresses, no page fetch at all. Reading
the index instead of the site is both cheaper and more reliable than fighting
a CDN for a page Google was already given.

Costs one credit per account by default. Everything here is aimed at making
that single credit count: query the domain rather than the school name, keep
only addresses on the organisation's own domain, and reject shared mailboxes.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

#: Titles worth an email. Ordered by how likely the holder is to sign off a
#: bulk planner order, since the first match wins when several appear.
ROLE_TERMS = (
    "athletic director",
    "director of athletics",
    "activities director",
    "principal",
    "superintendent",
    "athletic coordinator",
)

_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")

#: Shared mailboxes. Every one of the fourteen "replies" this system recorded
#: came from one of these: they bounce, they auto-answer, and they never
#: produce a person to sell to.
_ROLE_LOCALS = {
    "info", "contact", "admin", "office", "webmaster", "help", "support",
    "hello", "mail", "email", "noreply", "no-reply", "donotreply", "enquiries",
    "inquiries", "reception", "frontoffice", "front.office", "athletics",
    "registrar", "attendance", "privacy", "media", "press", "jobs", "careers",
    "hr", "it", "helpdesk", "postmaster", "abuse", "sales", "billing",
}

#: A name in a snippet usually sits immediately before the address, as
#: "Jane Smith, Athletic Director jsmith@district.org" or on the line above.
_NAME = re.compile(r"\b([A-Z][a-z]{1,20})\s+([A-Z][a-z'\-]{1,25})\b")


def _domain(website: str) -> str:
    raw = (website or "").strip()
    if not raw:
        return ""
    if not raw.startswith("http"):
        raw = f"https://{raw}"
    host = (urlparse(raw).netloc or "").lower()
    return host[4:] if host.startswith("www.") else host


def _is_role_mailbox(email: str) -> bool:
    local = email.split("@", 1)[0].lower()
    if local in _ROLE_LOCALS:
        return True
    # info.athletics@, office-2@ and similar compounds.
    parts = re.split(r"[._\-]", local)
    return bool(parts) and parts[0] in _ROLE_LOCALS and len(parts) <= 2


def _name_near(text: str, email: str) -> str:
    """Best-effort person name sitting just before the address in a snippet."""
    i = text.find(email)
    if i <= 0:
        return ""
    window = text[max(0, i - 90):i]
    matches = _NAME.findall(window)
    if not matches:
        return ""
    first, last = matches[-1]
    # "Athletic Director" is two capitalised words and is not a person.
    if f"{first} {last}".lower() in {t.title().lower() for t in ROLE_TERMS}:
        return ""
    return f"{first} {last}"


def _title_near(text: str, email: str) -> str:
    low = text.lower()
    i = low.find(email.lower())
    if i < 0:
        return ""
    window = low[max(0, i - 120):i + 40]
    for term in ROLE_TERMS:
        if term in window:
            return term.title()
    return ""


def find_emails(
    website: str, company: str = "", *, max_queries: int = 1, per_query: int = 10
) -> list[dict[str, Any]]:
    """Named contacts for one organisation, read out of Google's index.

    Returns ``[{email, person_name, job_title, source}]``, best first, only for
    addresses on the organisation's OWN domain — a snippet routinely carries a
    vendor's or a neighbouring district's address, and attaching one of those to
    this account is worse than finding nothing.

    ``max_queries`` is the credit budget for this account. One is usually
    enough; the second and third phrasings exist for the accounts that matter
    enough to spend more on.
    """
    domain = _domain(website)
    if not domain:
        return []

    from utils.websearch import web_search

    # Ordered cheapest-yield-first. The domain is in every query because the
    # school NAME returns news articles and the domain returns the directory.
    queries = [
        f'"athletic director" {domain} email',
        f'{domain} "athletic director" OR "director of athletics" contact',
        f'site:{domain} principal OR superintendent email',
    ][:max(1, max_queries)]

    seen: dict[str, dict[str, Any]] = {}
    for q in queries:
        try:
            results, _provider = web_search(q, per_query)
        except Exception:  # noqa: BLE001 — one bad query never kills the account
            continue
        for r in results:
            text = f"{r.get('title') or ''} {r.get('snippet') or ''}"
            for raw in _EMAIL.findall(text):
                email = raw.lower().strip(".,;:")
                # Own domain only. A subdomain of the district (athletics.x.org)
                # is still the district.
                host = email.split("@", 1)[-1]
                if not (host == domain or host.endswith("." + domain)):
                    continue
                if _is_role_mailbox(email) or email in seen:
                    continue
                seen[email] = {
                    "email": email,
                    "person_name": _name_near(text, email),
                    "job_title": _title_near(text, email),
                    "source": "serp_snippet",
                }
        # Enough named people for a sequence — stop paying for more.
        if sum(1 for v in seen.values() if v["person_name"]) >= 3:
            break

    # Named and titled first: a bare address is usable, a named one converts.
    return sorted(
        seen.values(),
        key=lambda c: (bool(c["person_name"]), bool(c["job_title"])),
        reverse=True,
    )
