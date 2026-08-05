"""Org-level (school / coalition) switchboard phone + general mailbox.

Distinct from Phase 2/3, which find *people*. This fills ``accounts.phone`` and
``accounts.email`` — the front-office number and a generic inbox (info@, contact@…)
that a rep can call or email when no named contact answers.

Sources, in order:
  phone — Serper Places (title/website must match the account, so we never attach the
          number of a different school with a similar name), else a phone printed on
          the org's own contact page.
  email — a generic mailbox published on the org's own site (own domain only), else a
          generic mailbox seen in search snippets.

Runs standalone (``scripts/run_org_contact.py``) with its own checkpoint, so it never
touches the Phase 2/3 flow. Plain HTTP only — no camofox — so it can't contend with the
people-crawl for the single browser.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

_STATE = Path(__file__).resolve().parent.parent / "outreach_data" / "org_contact_state.json"

_PHONE_RE = re.compile(r"\(?\b\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b")
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")

# Mailboxes that belong to the organisation rather than a person.
_GENERIC_LOCALS = (
    "info", "contact", "contactus", "office", "frontoffice", "mainoffice", "admin",
    "administration", "school", "reception", "inquiries", "enquiries", "hello",
    "webmaster", "principal", "athletics", "athletic", "coalition", "help", "general",
)
# Never store these as the org mailbox.
_BAD_LOCALS = ("noreply", "no-reply", "donotreply", "postmaster", "abuse", "privacy", "unsubscribe")

# Affiliated-but-separate bodies: a PTSA/booster/alumni inbox is not the front office.
_AFFILIATE = ("ptsa", "ptso", "pta", "booster", "alumni", "foundation", "band", "choir", "yearbook")

_GENERIC_ORG_WORDS = {
    "school", "high", "middle", "elementary", "academy", "charter", "public", "county",
    "community", "coalition", "prevention", "council", "partnership", "district", "the",
    "for", "and", "of", "free", "alliance", "youth", "city", "senior", "hs",
}


def _norm_phone(raw: str) -> str:
    d = re.sub(r"\D", "", raw or "")
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    if len(d) != 10 or d[0] in "01" or d[3] in "01":  # invalid US NANP area/exchange
        return ""
    return f"({d[0:3]}) {d[3:6]}-{d[6:10]}"


def _host(url: str) -> str:
    from urllib.parse import urlparse

    h = urlparse(url if url.startswith("http") else f"https://{url}").netloc.lower()
    return h[4:] if h.startswith("www.") else h


def _base_domain(host: str) -> str:
    parts = [p for p in host.split(".") if p]
    return ".".join(parts[-3:]) if len(parts) >= 3 and parts[-2] in ("k12", "co", "com") else ".".join(parts[-2:])


def org_name(company: str) -> str:
    return re.split(r"\s+[—–]\s+", company)[0].strip()


def _org_tokens(company: str) -> set[str]:
    name = org_name(company).lower()
    return {t for t in re.findall(r"[a-z]+", name) if len(t) > 3 and t not in _GENERIC_ORG_WORDS}


def _title_matches(place_title: str, company: str) -> bool:
    """The place must name the same org — 'Lincoln High School' must not match 'Lincoln
    Middle School' or a Lincoln in another state (address is checked separately)."""
    need = _org_tokens(company)
    have = set(re.findall(r"[a-z]+", (place_title or "").lower()))
    if not need:
        return bool(have)
    return need.issubset(have)


def _level_ok(place_title: str, company: str) -> bool:
    """Don't attach a middle/elementary school's number to a high school."""
    t, c = (place_title or "").lower(), company.lower()
    for level in ("high", "middle", "elementary"):
        if level in c and level not in t and any(x in t for x in ("high", "middle", "elementary")):
            return False
    return True


# ---------------------------------------------------------------------------
# Serper Places
# ---------------------------------------------------------------------------
def _serper_places(query: str, key: str) -> list[dict]:
    req = urllib.request.Request(
        "https://google.serper.dev/places",
        data=json.dumps({"q": query, "gl": "us", "hl": "en"}).encode(),
        headers={"X-API-KEY": key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.load(r).get("places") or []
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        raise RuntimeError(f"HTTP {e.code}: {body[:300]}") from e
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(str(e)[:60]) from e


def place_lookup(acct: dict, key: str) -> dict[str, str]:
    """Return {'phone','address','website'} from the best-matching place, or {}.

    Reports success/quota state centrally here (not in a per-caller wrapper), so
    every caller — the batch ``run()`` below, or ``pipeline.full_enrich`` calling
    this directly per account — feeds the same Settings > Keys alert.
    """
    from utils.websearch import report_ok, report_quota

    company, location = acct["company"], (acct.get("location") or "")
    query = f"{org_name(company)} {location}".strip()
    try:
        places = _serper_places(query, key)
    except RuntimeError as e:
        report_quota("serper", str(e)[:200])
        raise
    report_ok("serper")
    site_host = _host(acct["website"]) if (acct.get("website") or "").strip() else ""
    state = ""
    m = re.search(r",\s*([A-Z]{2})\b", location or company)
    if m:
        state = m.group(1)

    for p in places[:5]:
        title = p.get("title", "")
        phone = _norm_phone(p.get("phoneNumber", ""))
        if not phone:
            continue
        p_host = _host(p.get("website", "")) if p.get("website") else ""
        # Strongest signal: the place's website is the account's website.
        site_match = bool(site_host and p_host and _base_domain(p_host) == _base_domain(site_host))
        if not site_match:
            if not (_title_matches(title, company) and _level_ok(title, company)):
                continue
            # No site link → the address must at least be in the right state.
            if state and state not in (p.get("address") or ""):
                continue
        return {"phone": phone, "address": p.get("address", ""), "website": p.get("website", "")}
    return {}


# ---------------------------------------------------------------------------
# Own-site scan (plain HTTP only — never camofox)
# ---------------------------------------------------------------------------
def _org_mailbox_score(local: str, org_toks: set[str], all_toks: set[str]) -> int:
    """How org-owned a mailbox looks. 0 = personal / unusable.

    3 = exactly a generic box (info@, contact@)
    2 = built from the org's own name (antiochhigh@, alpharettahs@)
    1 = contains a generic word (alpharettawebmaster@)
    """
    if any(b in local for b in _BAD_LOCALS):
        return 0
    # "331774@dadeschools.net" is a school ID, not a mailbox. A real box has a word in it.
    if not re.search(r"[a-z]{3}", local):
        return 0
    if local in _GENERIC_LOCALS:
        return 3
    stripped = local
    for t in sorted(all_toks, key=len, reverse=True):
        stripped = stripped.replace(t, "")
    if not stripped.strip("._- 0123456789"):
        return 2
    if any(g in local for g in _GENERIC_LOCALS):
        return 1
    return 0  # first.last / flast → a person, not the front office


def _pick_generic_email(emails: list[str], site_host: str, company: str = "") -> str:
    dom = _base_domain(site_host) if site_host else ""
    org_toks = _org_tokens(company) if company else set()
    all_toks = (
        {t for t in re.findall(r"[a-z]+", org_name(company).lower()) if len(t) > 2}
        if company
        else set()
    )
    all_toks |= {"hs", "highschool", "school", "high"}
    best: tuple[int, str] = (0, "")
    for e in dict.fromkeys(x.lower() for x in emails):
        local, _, edom = e.partition("@")
        if e.endswith((".png", ".jpg", ".gif", ".webp", ".svg")) or not edom:
            continue
        # Must be the org's own mail domain, or a domain naming the org
        # (albanyschools.org site ↔ albany.k12.ny.us mail is one district).
        own_domain = bool(dom and edom.endswith(dom))
        org_domain = bool(org_toks and any(t in edom for t in org_toks))
        if not (own_domain or org_domain):
            continue
        # armwoodhighptsa.org names the school but isn't the school.
        if not own_domain and any(a in edom for a in _AFFILIATE):
            continue
        if any(a in local for a in _AFFILIATE):
            continue
        score = _org_mailbox_score(local, org_toks, all_toks)
        if score > best[0]:
            best = (score, e)
    return best[1]


def snippet_scan(acct: dict) -> dict[str, str]:
    """Ask the SERP for the org's published contact details and mine the snippets.

    Most school sites block plain crawling, but their contact page is indexed — the
    snippet carries the front-office mailbox and often the number.
    """
    from utils.websearch import web_search

    company = acct["company"]
    site = (acct.get("website") or "").strip()
    host = _host(site) if site else ""
    dom = _base_domain(host) if host else ""
    org = org_name(company)
    loc = acct.get("location") or ""

    # Several angles: the office mailbox surfaces under different phrasings, and the
    # site: query reaches pages our crawler is blocked from.
    queries = [f'"{org}" {loc} contact email' + (f' "@{dom}"' if dom else "")]
    if dom:
        queries.append(f'site:{dom} "{org}" contact "@{dom}"')
        queries.append(f'"{org}" ("info@{dom}" OR "contact@{dom}" OR "office@{dom}")')

    out: dict[str, str] = {}
    seen: list[str] = []
    for q in queries:
        results, _prov = web_search(q, num=6)
        if not results:
            continue
        blob = " ".join(f"{r.get('title','')} {r.get('snippet','')}" for r in results)
        seen += _EMAIL_RE.findall(blob)
        em = _pick_generic_email(seen, host, company)
        if em:
            out["email"] = em
            return out
    return out


def site_scan(website: str, company: str = "", *, deep: bool = True) -> dict[str, str]:
    """Read the org's homepage + its contact page; return {'email','phone'}.

    Two-tier like the people crawler (``_fetch_page``): plain HTTP, then the local
    stealth browser when the site blocks us — most school sites do, and their front
    office mailbox lives on exactly those pages.
    """
    from urllib.parse import urljoin

    from sources.site_crawl import _fetch_page

    if not (website or "").strip():
        return {}
    base = website if website.startswith("http") else f"https://{website}"
    host = _host(base)
    out: dict[str, str] = {}

    segs, links, final, err, tier = _fetch_page(base)
    if err:
        return {}
    base = final or base

    emails: list[str] = []
    phones: list[str] = []

    def _harvest(segments: list[dict]) -> None:
        for sg in segments:
            emails.extend(sg.get("emails") or [])
            emails.extend(e.lower() for e in _EMAIL_RE.findall(sg.get("text") or ""))
            phones.extend(_PHONE_RE.findall(sg.get("text") or ""))

    _harvest(segs)

    # The homepage rarely prints the office mailbox — the contact page does.
    if deep and not _pick_generic_email(emails, host, company):
        contact_urls: list[str] = []
        for href, anchor in links:
            blob = f"{href} {anchor}".lower()
            if not href or href.startswith(("mailto:", "tel:", "javascript:", "#")):
                continue
            if any(k in blob for k in ("contact", "about-us", "our-school", "school-info", "staff")):
                u = urljoin(base, href).split("#")[0]
                if _host(u) == host and u not in contact_urls:
                    contact_urls.append(u)
            if len(contact_urls) >= 2:
                break
        for u in contact_urls[:2]:
            csegs, _cl, _cf, cerr, _ct = _fetch_page(u, force_camofox=(tier == "camofox"))
            if cerr:
                continue
            _harvest(csegs)
            if _pick_generic_email(emails, host, company):
                break

    em = _pick_generic_email(emails, host, company)
    if em:
        out["email"] = em
    for p in phones:
        ph = _norm_phone(p)
        if ph:
            out["phone"] = ph
            break
    return out


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------
def _load_state() -> dict[str, Any]:
    try:
        s = json.loads(_STATE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        s = {}
    s.setdefault("processed", [])
    return s


def _save_state(s: dict[str, Any]) -> None:
    _STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = _STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(s, indent=1), encoding="utf-8")
    tmp.replace(_STATE)


def run(sample: int = 0, *, write: bool = False, resume: bool = True, workers: int = 3) -> dict[str, Any]:
    import threading
    from collections import Counter
    from concurrent.futures import ThreadPoolExecutor

    from outreach.cockpit_api import set_account_org_contact
    from outreach.db import connect
    from utils.websearch import get_key

    key = get_key("serper")
    state = _load_state() if resume else {"processed": []}
    done = set(state["processed"])

    conn = connect()
    rows = [
        dict(r)
        for r in conn.execute(
            "SELECT id, company, website, industry, location, phone, email FROM accounts "
            "WHERE COALESCE(phone,'') = '' OR COALESCE(email,'') = '' "
            "ORDER BY COALESCE(icp_enhanced_score, icp_score) DESC NULLS LAST, id"
        ).fetchall()
    ]
    conn.close()
    rows = [r for r in rows if r["id"] not in done]
    if sample:
        rows = rows[:sample]

    stats: Counter = Counter()
    lock = threading.Lock()
    serper_gate = threading.Lock()
    last_call = [0.0]
    dump: list[dict] = []
    t0 = time.time()

    def _places(acct: dict) -> dict[str, str]:
        if not key:
            return {}
        with serper_gate:  # ~1.2 req/s, gentle alongside the people-run's own throttle
            wait = 1.2 - (time.time() - last_call[0])
            if wait > 0:
                time.sleep(wait)
            last_call[0] = time.time()
        try:
            return place_lookup(acct, key)  # reports success/quota to Settings > Keys itself
        except RuntimeError as e:
            with lock:
                stats["places_error"] += 1
                if "402" in str(e) or "429" in str(e) or "403" in str(e):
                    stats["places_quota"] += 1
            return {}

    def _one(acct: dict) -> None:
        phone = (acct.get("phone") or "").strip()
        email = (acct.get("email") or "").strip()
        src_p = src_e = ""
        try:
            if not phone:
                pl = _places(acct)
                if pl.get("phone"):
                    phone, src_p = pl["phone"], "places"
            if not email or not phone:
                sc = site_scan(acct.get("website") or "", acct["company"])
                if not email and sc.get("email"):
                    email, src_e = sc["email"], "site"
                if not phone and sc.get("phone"):
                    phone, src_p = sc["phone"], "site"
            if not email:  # site blocked or silent — mine the indexed contact page
                with serper_gate:
                    wait = 1.2 - (time.time() - last_call[0])
                    if wait > 0:
                        time.sleep(wait)
                    last_call[0] = time.time()
                sn = snippet_scan(acct)
                if sn.get("email"):
                    email, src_e = sn["email"], "snippet"
        except Exception as e:  # noqa: BLE001 — one bad org must not kill the run
            with lock:
                stats[f"crash_{type(e).__name__}"] += 1
            return

        if write and (phone or email):
            set_account_org_contact(acct["id"], phone, email)

        with lock:
            stats["processed"] += 1
            i = stats["processed"]
            if phone:
                stats["with_phone"] += 1
                stats[f"phone_{src_p or 'kept'}"] += 1
            if email:
                stats["with_email"] += 1
                stats[f"email_{src_e or 'kept'}"] += 1
            if write:
                state["processed"].append(acct["id"])
                if i % 20 == 0:
                    _save_state(state)
            print(
                f"  [{i}/{len(rows)}] {acct['company'][:40]:40} "
                f"{phone or '—':16} {email or '—'}",
                flush=True,
            )
            if not write:
                dump.append({"company": acct["company"], "phone": phone, "email": email})

    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        list(ex.map(_one, rows))
    if write:
        _save_state(state)

    return {
        "processed": stats["processed"],
        "with_phone": stats["with_phone"],
        "with_email": stats["with_email"],
        "phone_from_places": stats["phone_places"],
        "phone_from_site": stats["phone_site"],
        "email_from_site": stats["email_site"],
        "email_from_snippet": stats["email_snippet"],
        "places_errors": stats["places_error"],
        "places_quota_errors": stats["places_quota"],
        "elapsed_sec": round(time.time() - t0, 1),
        "sample": dump,
    }
