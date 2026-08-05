"""Phase 1 — website resolution for accounts that have no website.

For each account: one web search ("<name> <city> <state> official website") via the
Serper→Tavily fallback layer, then validate the results locally (no extra credits):
prefer .k12.<st>.us / .edu / district .org|.us|.gov domains, reject aggregators, and
when the only candidate is a generic domain, fetch the page ourselves and confirm the
org name appears before accepting.

Every search response is cached to ``outreach_data/serper_cache/website/<id>.json`` so
re-runs cost nothing. Writes go through the in-place upsert path
(``enrich_account_contacts(..., discovered_website=...)``) — never ``sync_records``.
"""

from __future__ import annotations

import json
import re
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from utils.http import get_text
from utils.websearch import counts, total_calls, web_search

_CACHE_DIR = Path(__file__).resolve().parent.parent / "outreach_data" / "serper_cache" / "website"

# Hosts that are directories/aggregators/wrong-gov, never the org's own site.
_AGGREGATORS = (
    "facebook.", "niche.com", "greatschools", "usnews.com", "publicschoolreview",
    "yelp.", "mapquest", "linkedin.", "wikipedia.", "instagram.", "twitter.", "x.com",
    "ballotpedia", "schooldigger", "homefacts", "zillow", "maxpreps", "indeed.",
    "glassdoor", "city-data", "neighborhoodscout", "rocketreach", "zoominfo",
    "youtube.", "pinterest.", "tiktok.", "homes.com", "realtor.com", "trulia",
    "ratemyteachers", "collegesimply", "publicschoolsk12", "elementaryschools.org",
    "highschools.com", "sports-reference", "cappex", "publicschoolsreport",
    # donation / report-card / federal directories that mention schools but aren't them
    "donorschoose", "nces.ed.gov", "reportcard", "nationalcenter", "nps.gov",
    "census.gov", "data.gov", "usa.gov", "military.com", "apartments.com",
    "areavibes", "point2homes", "movoto", "redfin", "spokeo", "whitepages",
    "manta.com", "bizapedia", "chamberofcommerce", "schoolquality", "publicschoolsreview",
    # dictionary / reference / Q&A / forum sites whose page titles echo the query terms
    "cambridge.org", "dictionary", "merriam-webster", "vocabulary.com",
    "thefreedictionary", "wordreference", "britannica", "quizlet", "coursehero",
    "chegg", "scribd", "fandom.com", "reddit.", "quora.", "tripadvisor",
    "booking.com", "expedia", "wikimedia", "wiktionary", "pronouncekiwi",
    # generic hosting / athletics / transcript / tourism / encyclopedia platforms
    "sites.google.com", "smore.com", "hudl.com", "needmytranscript", "varsitytutors",
    "grokipedia", "encyclopedia", "usgbc.org", ".mil", "exploregeorgia", "visitindy",
    "rschoolteams", "8to18.com", "rankandfiled", "publicschoolsk12", "booster",
    "nfhsnetwork", "maxpreps", "athletic.net", "prephero", "scorebook",
    # job boards (contain "school"/"jobs" so they slip past school-domain checks)
    "schoolspring", "edjoin", "applitrack", "k12jobspot", "schooljobs",
    "governmentjobs", "ziprecruiter", "handshake", "simplyhired", "monster.com",
    "linkup", "jobcase", "talent.com", "snagajob", "greenhouse.io", "myworkday",
    "parentsquare", "schoolwires", "edlio", "myschoolapp",
    # nonprofit rating / grant / IRS-990 directories (coalitions resolve here wrongly)
    "guidestar", "charitynavigator", "propublica", "foundationcenter", "fconline.",
    "fiscalsponsordirectory", "influencewatch", "ncnonprofits", "schools-info.com",
    "transitionalhousing.org", "cause-iq", "causeiq", "opencorporates", "nonprofitlight",
    "taxexemptworld", "greatnonprofits", "instrumentl", "grantmakers",
    # academic / research hosts a coalition should never resolve to
    "scalar.", "academia.edu", "researchgate", "jstor", "edc.org", "coursera",
    "recovered.org", "rehab.com", "addictioncenter", "recovery.org",
    # donation / volunteer / event portals that echo an org's name
    "festivalnet", "idealist.org", "azgives", "volunteernewyork", "ocnonprofitcentral",
    "justgiving", "gofundme", "eventbrite", "meetup.com",
)

# Page-content signals that a site really is a school / coalition (vs. a page that
# merely mentions the name). Used to gate acceptance on generic .com/.org domains.
_ORG_SIGNAL_SCHOOL = (
    "high school", "school", "academy", "principal", "athletic", "students",
    "enroll", "campus", "class of", "mascot", "home of the", "pta", "faculty",
)
# Prevention-specific for coalitions — generic words ("community", "programs") let
# unrelated local nonprofits and academic pages through, so require a real signal.
_ORG_SIGNAL_COALITION = (
    "coalition", "prevention", "recovery", "substance", "addiction", "opioid",
    "drug", "alcohol", "tobacco", "vaping", "narcan", "sober", "treatment",
    "mental health", "behavioral health", "wellness", "youth services",
)


def _page_has_org_signal(html: str, is_school: bool) -> bool:
    low = html.lower()
    sigs = _ORG_SIGNAL_SCHOOL if is_school else _ORG_SIGNAL_COALITION
    return any(s in low for s in sigs)

# Generic city/county/state gov hosts (not the school's own site) unless they carry a
# clear school marker. e.g. hcfl.gov, alpharetta.ga.us → reject; abc.k12.tx.us → keep.
_GOV_TLDS = (".gov", ".us")


def _looks_like_school_domain(host: str) -> bool:
    if re.search(r"\.k12\.[a-z]{2}\.us$", host):
        return True
    if host.endswith(".edu"):
        return True
    return "school" in host or "k12" in host or "isd" in host or "csd" in host

# Words that don't help identify a specific org in a domain/name match.
_STOP = {
    "high", "school", "schools", "the", "of", "county", "district", "public",
    "charter", "academy", "senior", "junior", "middle", "prevention", "coalition",
    "community", "communities", "center", "council", "coalitions", "and", "for",
    "unified", "independent", "consolidated", "area", "regional", "city", "township",
}


def _cache_path(account_id: int) -> Path:
    return _CACHE_DIR / f"{account_id}.json"


def _load_cache(account_id: int) -> dict[str, Any] | None:
    try:
        return json.loads(_cache_path(account_id).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _save_cache(account_id: int, payload: dict[str, Any]) -> None:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _cache_path(account_id).write_text(json.dumps(payload, indent=1), encoding="utf-8")


def _parse_name_loc(company: str, location: str) -> tuple[str, str, str]:
    """Return (name, city, state) from 'NAME — City, ST' (falling back to location col)."""
    name = company
    city = state = ""
    if "—" in company:
        name, _, loc = company.partition("—")
        location = loc.strip() or location
    name = name.strip()
    loc = (location or "").strip()
    if "," in loc:
        city, _, st = loc.rpartition(",")
        city, state = city.strip(), st.strip()
    elif loc:
        city = loc
    return name, city, state


def _query_for(name: str, city: str, state: str) -> str:
    return " ".join(p for p in (name, city, state, "official website") if p).strip()


def _tokens(name: str) -> list[str]:
    """Significant name tokens (drops generic school/coalition/geo stopwords).

    City words are kept — a school's real domain usually contains its name
    (which may include the city, e.g. 'alpharettahs.fultonschools.org'). The
    city *gov* domain (alpharetta.ga.us) is filtered separately by the gov guard.
    """
    words = re.split(r"[^a-z0-9]+", name.lower())
    return [w for w in words if len(w) >= 4 and w not in _STOP]


def _host(url: str) -> str:
    h = urlparse(url).netloc.lower()
    return h[4:] if h.startswith("www.") else h


def _is_aggregator(host: str) -> bool:
    return any(a in host for a in _AGGREGATORS)


def _tld_score(host: str) -> int:
    if re.search(r"\.k12\.[a-z]{2}\.us$", host):
        return 100
    if host.endswith(".edu"):
        return 80
    if host.endswith(".gov"):
        return 60
    if host.endswith(".us"):
        return 55
    if host.endswith(".org"):
        return 45
    if host.endswith(".net"):
        return 20
    if host.endswith(".com"):
        return 12
    return 5


def _strong_name_in(text: str, toks: list[str]) -> bool:
    """True when ``text`` strongly encodes the org name.

    A single common token ("spring", "valley", "green") is NOT enough — it matches
    random hosts/pages (thespringstore.com, usgbc.org). Require the full name
    contiguously, or every token present, or one long (>=8) distinctive token.
    """
    if not toks:
        return False
    flat = re.sub(r"[^a-z0-9]", "", text.lower())
    joined = "".join(toks)
    if len(joined) >= 5 and joined in flat:
        return True
    if len(toks) >= 2 and all(t in flat for t in toks):
        return True
    return any(len(t) >= 8 and t in flat for t in toks)


def _name_match(host: str, toks: list[str]) -> bool:
    """Name encoded in the HOST only (never the path — aggregators put the school name
    in their URL path, e.g. indyencyclopedia.org/arsenal-technical-high-school)."""
    return _strong_name_in(host, toks)


def _fetch_bounded(url: str, deadline: float = 10.0) -> str:
    """``get_text`` with a hard wall-clock deadline.

    urllib's socket timeout does not stop a server that accepts the connection then
    trickles bytes (slow-loris), which can stall the whole batch. Run the fetch in a
    daemon thread and give up after ``deadline`` — the orphaned thread dies on its own.
    """
    box: dict[str, str] = {}

    def _worker() -> None:
        try:
            box["html"] = get_text(url, timeout=8.0, silent=True) or ""
        except Exception:  # noqa: BLE001 — never let a fetch kill the run
            box["html"] = ""

    t = threading.Thread(target=_worker, daemon=True)
    t.start()
    t.join(deadline)
    return box.get("html", "")


def _page_title_text(html: str) -> str:
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    title = m.group(1) if m else ""
    h1s = " ".join(re.findall(r"<h1[^>]*>(.*?)</h1>", html, re.I | re.S))
    return re.sub(r"<[^>]+>", " ", f"{title} {h1s}").lower()


def _confirm_on_page(url: str, toks: list[str], *, strict: bool = False) -> bool:
    """Fetch the page ourselves (no API credit) and confirm an org token appears.

    ``strict`` restricts the check to the <title>/<h1> so pages that merely *mention*
    the school (donation/directory sites) don't pass as the school's own site.
    """
    if not toks:
        return False
    html = _fetch_bounded(url)
    if not html:
        return False
    area = _page_title_text(html) if strict else html.lower()
    return any(t in area for t in toks)


def _clean_url(url: str) -> str:
    return url.split("#")[0].split("?")[0].rstrip("/")


def resolve_account(acct: dict[str, Any], *, use_cache: bool = True, num: int = 10) -> dict[str, Any]:
    """Resolve one account's website. Returns a decision dict (does not write to DB)."""
    account_id = int(acct["id"])
    company = str(acct.get("company") or "")
    industry = str(acct.get("industry") or "")
    is_school = "school" in industry.lower() or "charter" in industry.lower()
    name, city, state = _parse_name_loc(company, str(acct.get("location") or ""))
    toks = _tokens(name)
    query = _query_for(name, city, state)

    cached = _load_cache(account_id) if use_cache else None
    if cached and "results" in cached:
        results, provider = cached["results"], cached.get("provider", "cache")
    else:
        results, provider = web_search(query, num=num)
        _save_cache(account_id, {"query": query, "provider": provider, "results": results, "ts": time.time()})

    decision: dict[str, Any] = {
        "account_id": account_id, "company": company, "query": query,
        "provider": provider, "chosen_url": "", "chosen_host": "",
        "status": "unresolved", "reason": "", "fetched": False,
        "candidates": [{"host": _host(r["link"]), "link": r["link"]} for r in results[:5]],
    }
    if not results:
        decision["reason"] = "no search results (provider unavailable or empty)"
        return decision

    # Score non-aggregator candidates. Relevance (name-in-domain, school/district
    # domain) dominates the raw TLD so a real district .org beats a county .gov.
    scored: list[tuple[int, bool, bool, dict[str, str]]] = []
    for rank, r in enumerate(results):
        host = _host(r["link"])
        if not host or _is_aggregator(host):
            continue
        nm = _name_match(host, toks)
        school_dom = _looks_like_school_domain(host)
        # Reject generic city/county/state gov: a school's own gov site is always
        # .k12.<st>.us or carries a school marker (school_dom). Bare city/county gov
        # (alpharetta.ga.us, hcfl.gov) never is — even if the name token matches the city.
        if host.endswith(_GOV_TLDS) and not school_dom:
            continue
        score = (200 if nm else 0) + (120 if school_dom else 0) + _tld_score(host) + max(0, 8 - rank)
        scored.append((score, nm, school_dom, r))

    if not scored:
        decision["status"] = "aggregators_only"
        decision["reason"] = "only aggregators / generic gov in results"
        return decision

    scored.sort(key=lambda t: -t[0])
    best_score, best_nm, best_school, best = scored[0]
    host = _host(best["link"])
    url = _clean_url(best["link"])

    if best_nm:
        decision.update(status="accepted", chosen_url=url, chosen_host=host,
                        reason=f"name token in domain (score {best_score})")
    elif best_school:
        # District/school domain without the name in it → confirm the org appears on the page.
        if _confirm_on_page(url, toks):
            decision.update(status="accepted", chosen_url=url, chosen_host=host, fetched=True,
                            reason=f"school/district domain, org name confirmed on page (score {best_score})")
        else:
            decision.update(status="unresolved", chosen_host=host, fetched=True,
                            reason=f"school domain {host} but org name not found on page")
    else:
        # Generic .com/.org: accept only if the org name is in the page TITLE AND the
        # page reads like a real school/coalition site (kills dictionary/reference pages
        # whose titles merely echo the query terms, e.g. dictionary.cambridge.org).
        html = _fetch_bounded(url)
        title = _page_title_text(html)
        name_in_title = _strong_name_in(title, toks)
        if html and name_in_title and _page_has_org_signal(html, is_school):
            decision.update(status="accepted", chosen_url=url, chosen_host=host, fetched=True,
                            reason=f"org name in title + org-signal page on {host} (score {best_score})")
        else:
            why = "no org signal on page" if (html and name_in_title) else "name not in page title"
            decision.update(status="unresolved", chosen_host=host, fetched=True,
                            reason=f"generic domain {host}: {why}")
    return decision


def _cached_ids() -> set[int]:
    if not _CACHE_DIR.is_dir():
        return set()
    out: set[int] = set()
    for p in _CACHE_DIR.glob("*.json"):
        try:
            out.add(int(p.stem))
        except ValueError:
            continue
    return out


def run(sample: int = 0, *, write: bool = False, use_cache: bool = True, throttle: float = 1.0) -> dict[str, Any]:
    """Resolve websites for the Phase-1 target set, writing authoritatively.

    Target set = accounts with no website now UNION any account already searched
    (a cache file exists). The union makes the pass idempotent/correcting: a re-run
    with an improved validator re-decides every target and overwrites the stored
    website (via ``set_account_website``), including clearing it when a prior run
    accepted a bad domain that now resolves to ``unresolved``.

    ``write=False`` = dry run (no DB write). Writes never use ``sync_records``.
    """
    from outreach.cockpit_api import set_account_website
    from outreach.db import connect

    cached = _cached_ids()
    conn = connect()
    try:
        rows = [
            dict(r)
            for r in conn.execute(
                "SELECT id, company, website, industry, location FROM accounts "
                "WHERE COALESCE(website,'') = '' OR id = ANY(%s) "
                "ORDER BY COALESCE(icp_enhanced_score, icp_score) DESC NULLS LAST, id",
                (list(cached),),
            ).fetchall()
        ]
    finally:
        conn.close()
    if sample and sample > 0:
        rows = rows[:sample]

    decisions: list[dict[str, Any]] = []
    accepted = written = 0
    for i, acct in enumerate(rows, 1):
        had_cache = bool(use_cache and _load_cache(acct["id"]))
        d = resolve_account(acct, use_cache=use_cache)
        decisions.append(d)
        ok = d["status"] == "accepted" and bool(d["chosen_url"])
        if ok:
            accepted += 1
        if write:
            # Authoritative: set the chosen URL, or clear ('' ) when not resolved.
            set_account_website(d["account_id"], d["chosen_url"] if ok else "")
            written += 1
        print(f"  [{i}/{len(rows)}] {d['company'][:45]:45} → {d['status']:15} {d['chosen_host'] or '-'}  "
              f"[serper={counts()['serper']} tavily={counts()['tavily']}]")
        if throttle and not had_cache:
            time.sleep(throttle)

    return {
        "processed": len(rows), "accepted": accepted,
        "aggregators_only": sum(1 for d in decisions if d["status"] == "aggregators_only"),
        "unresolved": sum(1 for d in decisions if d["status"] == "unresolved"),
        "serper_calls": counts()["serper"], "tavily_calls": counts()["tavily"],
        "total_search_calls": total_calls(), "written": written,
        "decisions": decisions,
    }
