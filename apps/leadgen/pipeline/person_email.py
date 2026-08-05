"""Find the work email for the top contact at each account, from their name + org.

Apollo's People API is paywalled on the free plan, so this uses what we already have —
Serper web search plus pattern inference from the school's known mail domain — to fill
``contacts.email`` for the single best-ranked person per account that has a LinkedIn
profile but no email yet. One person per account, dashboard order (ICP desc).

Sources per person, cheapest-first, stop on the first verified hit:
  1. web search ``"Name" "Org" email`` → an email whose local part matches the name, on a
     plausible school/district domain → ``verified_web`` (highest confidence).
  2. if a mail domain is known (the account's org email, or a sibling contact's email),
     pattern-infer first.last@ / flast@ from that domain → ``pattern_inferred``.
  3. one more search ``"Name" <domain>`` when a domain is known but step 1 missed.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

_STATE = Path(__file__).resolve().parent.parent / "outreach_data" / "person_email_state.json"
_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")

# Domains that are never a school's staff-mail domain (aggregators / social / directories).
_BAD_DOMAINS = (
    "facebook.", "linkedin.", "twitter.", "instagram.", "niche.com", "greatschools.",
    "maxpreps.", "hudl.", "rankone", "schooldigger", "publicschoolreview", "usnews.",
    "wikipedia.", "indeed.", "ziprecruiter", "example.", "sentry.", "wix", "squarespace",
    "godaddy", "cloudflare", "google.com", "gstatic", "schoolspring",
)
_FREEMAIL = ("gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com")


def _name_parts(name: str) -> tuple[str, str] | None:
    parts = [p for p in re.split(r"[\s.\-']+", name.lower()) if p.isalpha() and len(p) > 1]
    if len(parts) < 2:
        return None
    return parts[0], parts[-1]


def _email_matches_name(email: str, name: str) -> bool:
    np = _name_parts(name)
    if not np:
        return False
    first, last = np
    local = email.split("@", 1)[0].lower()
    return (
        last in local
        or (last[:5] in local and len(last) >= 5)
        or f"{first[0]}{last}" in local
        or (first in local and last[:3] in local)
    )


def _domain_ok(email: str) -> bool:
    dom = email.rsplit("@", 1)[-1].lower()
    if any(b in dom for b in _BAD_DOMAINS):
        return False
    # A gmail/yahoo hit for a school staffer is a personal-email leak, not the work
    # address we want — reject freemail (we're after the org mailbox).
    if dom in _FREEMAIL:
        return False
    return True


def _mail_domain(acct: dict, sibling_email: str) -> str:
    """Best-known staff-mail domain for the account, or ''."""
    for src in (acct.get("email") or "", sibling_email or ""):
        if "@" in src:
            d = src.rsplit("@", 1)[-1].lower()
            if d and not any(b in d for b in _BAD_DOMAINS) and d not in _FREEMAIL:
                return d
    return ""


def _infer(name: str, domain: str, pattern_hint: str) -> str:
    np = _name_parts(name)
    if not np or not domain:
        return ""
    first, last = np
    local = {
        "first.last": f"{first}.{last}",
        "flast": f"{first[0]}{last}",
        "firstlast": f"{first}{last}",
        "lastf": f"{last}{first[0]}",
    }.get(pattern_hint or "first.last", f"{first}.{last}")
    return f"{local}@{domain}"


def _pattern_hint(sibling_email: str, org_email: str) -> str:
    """Guess the domain's local-part convention from any known address on it."""
    for e in (sibling_email, org_email):
        if not e or "@" not in e:
            continue
        local = e.split("@", 1)[0].lower()
        if "." in local and not local[0].isdigit():
            return "first.last"
        if len(local) >= 2 and local[0].isalpha():
            return "flast"
    return "first.last"


def find_person_email(acct: dict, person: dict) -> tuple[str, str]:
    """Return ``(email, status)`` — status ``verified_web`` / ``pattern_inferred`` / ``""``."""
    from utils.websearch import web_search

    name = person["person_name"]
    if not _name_parts(name):
        return "", ""
    org = re.split(r"\s+[—–]\s+", acct["company"])[0].strip()

    # 1) published email in search snippets
    results, _p = web_search(f'"{name}" "{org}" email', num=6)
    blob = " ".join(f"{r.get('title','')} {r.get('snippet','')}" for r in results)
    for e in dict.fromkeys(x.lower() for x in _EMAIL.findall(blob)):
        if _email_matches_name(e, name) and _domain_ok(e):
            return e, "verified_web"

    domain = _mail_domain(acct, person.get("_sibling_email", ""))

    # 2) another snippet email on the known domain that matches the name
    if domain:
        for e in dict.fromkeys(x.lower() for x in _EMAIL.findall(blob)):
            if e.endswith("@" + domain) and _email_matches_name(e, name):
                return e, "verified_web"

    # 3) targeted domain search
    if domain:
        results2, _p2 = web_search(f'"{name}" {domain}', num=5)
        blob2 = " ".join(f"{r.get('title','')} {r.get('snippet','')}" for r in results2)
        for e in dict.fromkeys(x.lower() for x in _EMAIL.findall(blob2)):
            if e.endswith("@" + domain) and _email_matches_name(e, name):
                return e, "verified_web"

    # 4) pattern inference from the known domain
    if domain:
        hint = _pattern_hint(person.get("_sibling_email", ""), acct.get("email", ""))
        guess = _infer(name, domain, hint)
        if guess:
            return guess, "pattern_inferred"
    return "", ""


# ---------------------------------------------------------------------------
def _load_state() -> dict[str, Any]:
    try:
        s = json.loads(_STATE.read_text())
    except (OSError, json.JSONDecodeError):
        s = {}
    s.setdefault("processed", [])
    return s


def _save_state(s: dict[str, Any]) -> None:
    _STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = _STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(s, indent=1))
    tmp.replace(_STATE)


def _worklist(limit: int = 0) -> list[dict]:
    """Top-ranked contact per account that has a LinkedIn profile but no email."""
    from outreach.db import connect

    conn = connect()
    try:
        rows = [
            dict(r)
            for r in conn.execute(
                """
                SELECT DISTINCT ON (a.id)
                  c.id AS contact_id, c.person_name, c.job_title, c.linkedin_url,
                  a.id AS account_id, a.company, a.website, a.email,
                  (SELECT c2.email FROM contacts c2
                   WHERE c2.account_id = a.id AND COALESCE(c2.email,'') <> ''
                   ORDER BY c2.role_rank DESC LIMIT 1) AS sibling_email
                FROM contacts c
                JOIN accounts a ON a.id = c.account_id
                WHERE COALESCE(c.linkedin_url,'') <> '' AND COALESCE(c.email,'') = ''
                ORDER BY a.id, c.role_rank DESC, c.confidence DESC
                """
            ).fetchall()
        ]
        # dashboard order: highest ICP first
        order = {
            int(r["id"]): i
            for i, r in enumerate(
                conn.execute(
                    "SELECT id FROM accounts ORDER BY COALESCE(icp_enhanced_score, icp_score) DESC NULLS LAST, id"
                ).fetchall()
            )
        }
    finally:
        conn.close()
    rows.sort(key=lambda r: order.get(int(r["account_id"]), 1 << 30))
    if limit:
        rows = rows[:limit]
    return rows


def run(sample: int = 0, *, write: bool = False, resume: bool = True, workers: int = 4) -> dict[str, Any]:
    import threading
    from collections import Counter
    from concurrent.futures import ThreadPoolExecutor

    from outreach.db import connect

    state = _load_state() if resume else {"processed": []}
    done = set(state["processed"])
    rows = [r for r in _worklist(limit=sample) if r["contact_id"] not in done]

    stats: Counter = Counter()
    lock = threading.Lock()
    dump: list[dict] = []
    t0 = time.time()

    def _one(r: dict) -> None:
        person = {
            "person_name": r["person_name"],
            "_sibling_email": r.get("sibling_email") or "",
        }
        try:
            email, status = find_person_email(r, person)
        except Exception as e:  # noqa: BLE001
            with lock:
                stats[f"crash_{type(e).__name__}"] += 1
            return
        if write and email:
            # Match the contacts table's convention (source_kind + confidence), same as
            # the people crawl. Verified web email ~ Website .8; an inferred one ~ Pattern .55.
            src, conf = ("Website", 0.8) if status == "verified_web" else ("Pattern", 0.55)
            conn = connect()
            try:
                conn.execute(
                    "UPDATE contacts SET email = ?, source_kind = ?, confidence = ? "
                    "WHERE id = ? AND COALESCE(email,'') = ''",
                    (email, src, conf, r["contact_id"]),
                )
                conn.commit()
            finally:
                conn.close()
        with lock:
            stats["processed"] += 1
            i = stats["processed"]
            if email:
                stats[status] += 1
            if write:
                state["processed"].append(r["contact_id"])
                if i % 15 == 0:
                    _save_state(state)
            print(
                f"  [{i}/{len(rows)}] {r['person_name'][:22]:22} {r['company'][:30]:30} "
                f"{email or '—':34} {status}",
                flush=True,
            )
            if not write:
                dump.append({"name": r["person_name"], "company": r["company"], "email": email, "status": status})

    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        list(ex.map(_one, rows))
    if write:
        _save_state(state)

    return {
        "processed": stats["processed"],
        "verified_web": stats["verified_web"],
        "pattern_inferred": stats["pattern_inferred"],
        "not_found": stats["processed"] - stats["verified_web"] - stats["pattern_inferred"],
        "elapsed_sec": round(time.time() - t0, 1),
        "sample": dump,
    }
