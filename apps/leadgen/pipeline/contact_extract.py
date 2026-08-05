"""Phase 2 runner: crawl each account's website for named contacts, write via upsert.

Reads accounts that have a website but no contacts yet, crawls each site with our own
HTTP + parsing (``sources/site_crawl.py``), and writes the extracted people through
``enrich_account_contacts`` (in place — never ``sync_records``). Resumable: a checkpoint
file records processed account ids + a blocked-domains list, so a re-run continues.

``python -m`` friendly; callable as ``run(sample=15, write=False)`` for the sample.
"""

from __future__ import annotations

import json
import threading
import time
from collections import Counter
from pathlib import Path
from typing import Any

_STATE = Path(__file__).resolve().parent.parent / "outreach_data" / "phase2_state.json"


def _load_state() -> dict[str, Any]:
    try:
        s = json.loads(_STATE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        s = {}
    s.setdefault("processed", [])
    s.setdefault("blocked", {})
    return s


def _save_state(state: dict[str, Any]) -> None:
    _STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = _STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=1), encoding="utf-8")
    tmp.replace(_STATE)


def _is_school(industry: str) -> bool:
    b = (industry or "").lower()
    return "school" in b or "charter" in b


def _worklist(limit: int = 0, ids: list[int] | None = None) -> list[dict]:
    from outreach.db import connect

    conn = connect()
    try:
        # Every account with no contacts yet — site crawl when it has a website,
        # LinkedIn x-ray discovery either way.
        sql = (
            "SELECT a.id, a.company, a.website, a.industry FROM accounts a "
            "WHERE NOT EXISTS (SELECT 1 FROM contacts c WHERE c.account_id = a.id) "
            "ORDER BY COALESCE(a.icp_enhanced_score, a.icp_score) DESC NULLS LAST, a.id"
        )
        rows = [dict(r) for r in conn.execute(sql).fetchall()]
    finally:
        conn.close()
    if ids:
        rows = [r for r in rows if r["id"] in set(ids)]
    if limit and limit > 0:
        rows = rows[:limit]
    return rows


def run(
    sample: int = 0, *, write: bool = False, resume: bool = True, workers: int = 4
) -> dict[str, Any]:
    from concurrent.futures import ThreadPoolExecutor

    from outreach.cockpit_api import _title_role_rank, enrich_account_contacts
    from sources.linkedin_xray import confirm_profile, discover_contacts, org_short
    from sources.site_crawl import crawl_site
    from utils.websearch import counts

    state = _load_state() if resume else {"processed": [], "blocked": {}}
    done = set(state["processed"])
    rows = _worklist(limit=sample)
    rows = [r for r in rows if r["id"] not in done]

    stats = Counter()
    blocked_reasons: Counter = Counter()
    contacts_by_kind: Counter = Counter()
    sample_dump: list[dict] = []
    lock = threading.Lock()
    t0 = time.time()

    def _one(acct: dict) -> None:
        is_school = _is_school(acct["industry"])
        try:
            if (acct["website"] or "").strip():
                res = crawl_site(acct["website"], is_school, org_name=acct["company"])
            else:
                res = {"contacts": [], "pages_crawled": 0, "blocked_reason": "no_website", "tier": ""}
            contacts = res["contacts"]
            reason = res["blocked_reason"]

            # LinkedIn x-ray (SERP only): confirm the primary crawled contact, or
            # discover role-holders when the crawl came up empty.
            org = org_short(acct["company"])
            li_confirmed = li_discovered = 0
            if contacts:
                top = max(contacts, key=lambda c: _title_role_rank(str(c.get("title") or "")))
                li = confirm_profile(str(top.get("name") or ""), org)
                if li:
                    top["linkedin_url"] = li
                    li_confirmed = 1
            else:
                found = discover_contacts(org, is_school)
                if found:
                    contacts = found
                    li_discovered = 1
        except Exception as e:  # noqa: BLE001 — one bad site must not kill the run
            res = {"tier": ""}
            contacts, reason = [], f"crash:{type(e).__name__}"
            li_confirmed = li_discovered = 0

        if write and not reason.startswith("crash:"):
            enrich_account_contacts(acct["id"], contacts)

        emails = sum(1 for c in contacts if c.get("email"))
        with lock:
            stats["processed"] += 1
            i = stats["processed"]
            stats[f"tier_{res.get('tier') or 'none'}"] += 1
            stats["linkedin_confirmed"] += li_confirmed
            stats["linkedin_discovered_accounts"] += li_discovered
            if li_discovered:
                contacts_by_kind["linkedin_people"] += len(contacts)
            if reason and reason not in ("", "no_website"):
                blocked_reasons[reason] += 1
                state["blocked"][acct["website"]] = reason
            if contacts:
                stats["accounts_with_contacts"] += 1
                contacts_by_kind["people"] += len(contacts)
                contacts_by_kind["with_email"] += emails
                contacts_by_kind["site_email"] += sum(
                    1 for c in contacts if c.get("email_status") == "site_published"
                )
                contacts_by_kind["inferred_email"] += sum(
                    1 for c in contacts if c.get("email_status") == "pattern_inferred"
                )
            if write and not reason.startswith("crash:"):
                state["processed"].append(acct["id"])
                if i % 10 == 0:
                    _save_state(state)
            print(
                f"  [{i}/{len(rows)}] {acct['company'][:42]:42} "
                f"{len(contacts)} contact(s), {emails} email  "
                f"({res.get('tier','')}) {'['+reason+']' if reason else ''}",
                flush=True,
            )
            if not write:  # sample: keep detail to show
                sample_dump.append({
                    "company": acct["company"], "website": acct["website"],
                    "is_school": is_school, "blocked": reason,
                    "contacts": contacts,
                })

    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        list(ex.map(_one, rows))

    if write:
        _save_state(state)

    return {
        "processed": stats["processed"],
        "via_http": stats["tier_http"],
        "via_camofox": stats["tier_camofox"],
        "accounts_with_contacts": stats["accounts_with_contacts"],
        "people_found": contacts_by_kind["people"],
        "with_email": contacts_by_kind["with_email"],
        "site_published_emails": contacts_by_kind["site_email"],
        "pattern_inferred_emails": contacts_by_kind["inferred_email"],
        "linkedin_confirmed": stats["linkedin_confirmed"],
        "linkedin_discovered_accounts": stats["linkedin_discovered_accounts"],
        "linkedin_only_people": contacts_by_kind["linkedin_people"],
        "search_credits": counts(),
        "blocked": dict(blocked_reasons),
        "elapsed_sec": round(time.time() - t0, 1),
        "sample": sample_dump,
    }


def run_contact_extract() -> None:
    """Full Phase 2 run (writes contacts). Used by main.py / the runner script."""
    print("Phase 2: crawling org sites for named contacts (own HTTP, no paid tools).")
    summary = run(sample=0, write=True, resume=True)
    summary.pop("sample", None)
    print("\n===== PHASE 2 COMPLETE =====")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    run_contact_extract()
