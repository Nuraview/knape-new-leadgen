"""The organisation's own LinkedIn company page (``accounts.linkedin_url``).

SERP data only — we never fetch or scrape a linkedin.com page.

Reality this module is built around (measured, not assumed): individual US high schools
almost never have a company page. Searching one returns *other* orgs that merely mention
the school — the city police department, a local orthodontist, student clubs (DECA,
robotics). Two guards keep that out:

  * the result's own **title must be the org**, not merely contain its name;
  * for schools the **state must match**, since "Albany High School" resolves to a
    California school when the account is in New York.

What does exist for a school is its **district** page (Fulton County Schools), so when
no own page passes we accept a district page from the same result set — stored with
``linkedin_kind='district'`` so it is never mistaken for the school's own.
Coalitions (nonprofits) do have their own pages — those come back ``kind='own'``.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

_STATE_FILE = Path(__file__).resolve().parent.parent / "outreach_data" / "org_linkedin_state.json"

_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee",
    "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}

# Words that carry no identity — ignored when comparing a title to an org name.
_NOISE = {
    "the", "and", "for", "inc", "llc", "ltd", "co", "org", "usa", "senior", "sr",
    "school", "schools", "high", "hs", "academy", "public", "district",
}
_DISTRICT_WORDS = ("school district", "public schools", "county schools", "unified", "isd",
                   "school corporation", "board of education", "city schools", "community schools",
                   "school board", "county school", "board of ed", "area schools", "township high")
# A club, booster or fundraising arm is not the institution. Matched on word boundaries —
# "Berkeley Public Schools Fund" is a charity, not Berkeley's district.
_SUBGROUP = ("deca", "robo", "robotics", "band", "choir", "alumni", "booster", "boosters",
             "ptsa", "pta", "ptso", "foundation", "fund", "endowment", "trust", "charity",
             "club", "team", "society", "student", "students", "newspaper", "yearbook",
             "honor", "athletics", "friends", "partners", "partnership", "parent", "parents",
             "council", "committee", "association", "volunteers", "auxiliary")
_SUBGROUP_RE = re.compile(r"\b(" + "|".join(_SUBGROUP) + r")\b", re.I)


def _toks(s: str) -> set[str]:
    return {t for t in re.findall(r"[a-z]+", (s or "").lower()) if len(t) > 2 and t not in _NOISE}


def org_name(company: str) -> str:
    return re.split(r"\s+[—–]\s+", company)[0].strip()


def _clean_title(t: str) -> str:
    t = re.sub(r"\|.*$", "", t or "")          # "Foo | LinkedIn", "Foo | 领英"
    t = re.sub(r"\(.*?\)", " ", t)              # "Foo (Denver, CO)"
    return " ".join(t.split())


def _state_of(location: str, company: str) -> str:
    m = re.search(r",\s*([A-Z]{2})\b", location or "") or re.search(r",\s*([A-Z]{2})\b", company or "")
    return m.group(1) if m and m.group(1) in _STATES else ""


def _state_ok(blob: str, st: str) -> bool:
    if not st:
        return True
    return bool(re.search(rf"\b{st}\b", blob)) or _STATES[st].lower() in blob.lower()


def _is_www_company(link: str) -> bool:
    return (link or "").startswith("https://www.linkedin.com/company/")


def classify(result: dict, company: str, location: str, website: str, is_school: bool) -> tuple[str, str]:
    """Return ``(kind, url)`` — kind is 'own', 'district', or '' (reject)."""
    link = result.get("link", "")
    if not _is_www_company(link):
        return "", ""
    title = _clean_title(result.get("title", ""))
    low = title.lower()
    blob = f"{result.get('title','')} {result.get('snippet','')}"
    org = org_name(company)
    ot, tt = _toks(org), _toks(title)
    st = _state_of(location, company)

    # "Eastlake High School DECA" (club) / "Berkeley Public Schools Fund" (charity) are not
    # the institution. Only applies to schools — a coalition may legitimately be named
    # "... Partnership" or "... Council".
    if is_school and _SUBGROUP_RE.search(low):
        return "", ""

    # --- the org's own page ---
    # The title may be SHORTER than the account name ("Tri-Town Council" is the page for
    # "Tri-Town Council On Youth & Family Services"), but it must never introduce a word
    # the org doesn't have: that one extra word is what makes "Bentonville Public Library"
    # and "City of Dacula" different institutions from the school.
    if ot and tt and tt.issubset(ot) and (len(tt) >= 2 or tt == ot):
        # Same name, different state (Albany NY vs Albany CA) → not our org.
        if is_school and not _state_ok(blob, st):
            return "", ""
        return "own", link

    # --- a school's district page: identifiable and tied to this school ---
    if is_school and any(w in low for w in _DISTRICT_WORDS):
        # Tie the district to THIS school: its name must appear in the *district* part of
        # the school's domain (alpharettahs.**fultonschools.org** ↔ "Fulton County Schools").
        # Matching the whole host instead let "Sewanhaka **Central** HS District" (NY) attach
        # to Omaha's Central High on **central**.ops.org — the school's own subdomain.
        dom = district_domain(website or "")
        city_toks = {t for t in re.findall(r"[a-z]+", (location or "").split(",")[0].lower()) if len(t) > 3}
        domain_hit = any(t in dom for t in tt if len(t) > 3) if dom else False
        # The school's site living on the district's domain (alpharettahs.fultonschools.org)
        # is conclusive on its own — district snippets often omit the state.
        if domain_hit:
            return "district", link
        # Otherwise only the school's own city identifies its district. Matching on the
        # school's name instead put "Mountain View HS, GA" under a California district —
        # generic names ("east", "mountain view") are shared across the country.
        if (city_toks & tt) and _state_ok(blob, st):
            return "district", link
    return "", ""


def district_domain(website: str) -> str:
    """The domain a district's schools share: alpharettahs.fultonschools.org →
    fultonschools.org; a.b.k12.ny.us → b.k12.ny.us."""
    host = re.sub(r"^www\.", "", re.sub(r"^https?://", "", website or "").split("/")[0]).lower()
    parts = [p for p in host.split(".") if p]
    if len(parts) < 2:
        return ""
    if len(parts) >= 4 and parts[-2] == "us" or "k12" in parts:
        return ".".join(parts[-4:]) if len(parts) >= 4 else host
    return ".".join(parts[-2:])


def find_org_linkedin(acct: dict) -> tuple[str, str]:
    """One search per account. Returns ``(kind, url)``; ``("", "")`` when nothing passes."""
    from utils.websearch import web_search

    company = acct["company"]
    is_school = "school" in (acct.get("industry") or "").lower() or "charter" in (acct.get("industry") or "").lower()
    results, _prov = web_search(f'site:linkedin.com/company "{org_name(company)}"', num=8)
    district: tuple[str, str] | None = None
    for r in results:
        kind, url = classify(r, company, acct.get("location") or "", acct.get("website") or "", is_school)
        if kind == "own":
            return kind, url  # always prefer the org's own page
        if kind == "district" and district is None:
            district = (kind, url)
    return district or ("", "")


def _district_is_domain_backed(acct: dict, url: str) -> bool:
    """Only a district found via the school's own domain is safe to reuse for that
    domain's other schools — a weaker match would propagate its error to all of them."""
    dom = district_domain(acct.get("website") or "")
    slug = url.rsplit("/", 1)[-1].lower()
    return bool(dom) and any(t in dom for t in re.findall(r"[a-z]+", slug) if len(t) > 3)


# ---------------------------------------------------------------------------
def _load_state() -> dict[str, Any]:
    try:
        s = json.loads(_STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        s = {}
    s.setdefault("processed", [])
    return s


def _save_state(s: dict[str, Any]) -> None:
    _STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = _STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(s, indent=1), encoding="utf-8")
    tmp.replace(_STATE_FILE)


def run(sample: int = 0, *, write: bool = False, resume: bool = True, workers: int = 3) -> dict[str, Any]:
    import threading
    from collections import Counter
    from concurrent.futures import ThreadPoolExecutor

    from outreach.cockpit_api import set_account_linkedin
    from outreach.db import connect

    state = _load_state() if resume else {"processed": []}
    done = set(state["processed"])
    conn = connect()
    rows = [
        dict(r)
        for r in conn.execute(
            "SELECT id, company, website, industry, location FROM accounts "
            "WHERE COALESCE(linkedin_url,'') = '' "
            "ORDER BY COALESCE(icp_enhanced_score, icp_score) DESC NULLS LAST, id"
        ).fetchall()
    ]
    conn.close()
    rows = [r for r in rows if r["id"] not in done]
    if sample:
        rows = rows[:sample]

    stats: Counter = Counter()
    lock = threading.Lock()
    dump: list[dict] = []
    t0 = time.time()
    # One district page serves every school on its domain — found once, reused free.
    district_cache: dict[str, str] = {}

    def _one(acct: dict) -> None:
        dd = district_domain(acct.get("website") or "")
        with lock:
            cached = district_cache.get(dd) if dd else None
        if cached:
            kind, url = "district", cached
            with lock:
                stats["district_from_cache"] += 1
        else:
            try:
                kind, url = find_org_linkedin(acct)
            except Exception as e:  # noqa: BLE001
                with lock:
                    stats[f"crash_{type(e).__name__}"] += 1
                return
            if kind == "district" and dd and _district_is_domain_backed(acct, url):
                with lock:
                    district_cache.setdefault(dd, url)
        if write:
            state_ok = True
            if url:
                set_account_linkedin(acct["id"], url, kind)
        with lock:
            stats["processed"] += 1
            i = stats["processed"]
            if kind:
                stats[kind] += 1
            if write:
                state["processed"].append(acct["id"])
                if i % 20 == 0:
                    _save_state(state)
            print(f"  [{i}/{len(rows)}] {acct['company'][:42]:42} {kind or '—':9} {url}", flush=True)
            if not write:
                dump.append({"company": acct["company"], "kind": kind, "url": url})

    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        list(ex.map(_one, rows))
    if write:
        _save_state(state)

    return {
        "processed": stats["processed"],
        "own_page": stats["own"],
        "district_page": stats["district"],
        "district_reused_from_cache": stats["district_from_cache"],
        "not_found": stats["processed"] - stats["own"] - stats["district"],
        "elapsed_sec": round(time.time() - t0, 1),
        "sample": dump,
    }
