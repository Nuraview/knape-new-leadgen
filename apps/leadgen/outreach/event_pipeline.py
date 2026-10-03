"""Scoped lead pipeline for one trade-show event pool.

Ties event-specific collection to the existing enrichment engine, but scoped to a
single event batch so it never runs enrichment, or spends search budget, over the
main discovery pipeline (the ~6k Knape accounts).

Flow for an event, e.g. WEFTEC 2026:
  1. collect  — exhibitor roster (``sources.*_exhibitors``) plus an optional
                booth-scan file (``sources.booth_scan_import``), merged into the
                event pool via ``cockpit_api.merge_records`` with event tags.
  2. websites — resolve a website for each event account that has none
                (``pipeline.enrich_websites.resolve_account``).
  3. contacts — find decision-maker contacts for each event account that still
                has none (``pipeline.full_enrich.enrich_one_account``).

Email verification and sending stay with the existing outreach stack: once the
pool is built and enriched, the normal campaign flow (filtered to the event's
``data_batch`` / ``lead_source_bucket``) sends to it, verifying each address at
send time through ``outreach.reacher_verify.send_gate``.

Run a full WEFTEC pass (collect + enrich), capped:
    python -m outreach.event_pipeline --event weftec-2026 --show "WEFTEC 2026" \
        --website-limit 200 --contact-limit 200
Collect only (no enrichment), or preview with --dry-run:
    python -m outreach.event_pipeline --event weftec-2026 --show "WEFTEC 2026" \
        --collect-only --dry-run
Include the client's own booth scans:
    python -m outreach.event_pipeline --event weftec-2026 --show "WEFTEC 2026" \
        --booth-file ~/scans/weftec_booth.csv
"""

from __future__ import annotations

import argparse
from typing import Any, Callable

# Events whose exhibitor roster has a public directory collector. WorkBoat is
# absent on purpose: its directory is login-gated, so its people come only from a
# booth-scan file (--booth-file), never a scrape.
_EXHIBITOR_FETCHERS: dict[str, Callable[[int | None], list[dict]]] = {}


def _register_fetchers() -> None:
    if _EXHIBITOR_FETCHERS:
        return
    try:
        from sources.weftec_exhibitors import fetch_weftec_exhibitors

        _EXHIBITOR_FETCHERS["weftec-2026"] = fetch_weftec_exhibitors
    except Exception as e:  # noqa: BLE001
        print(f"Note: WEFTEC collector unavailable: {e}")


def _bucket_for(event_slug: str) -> str:
    return f"event:{event_slug}"


def collect(
    event_slug: str,
    show_name: str,
    *,
    booth_file: str | None = None,
    exhibitor_limit: int | None = None,
    write: bool = True,
) -> dict[str, Any]:
    """Fetch exhibitor + booth-scan rows for one event and merge them (if write)."""
    _register_fetchers()
    rows: list[dict] = []

    fetch = _EXHIBITOR_FETCHERS.get(event_slug)
    if fetch is not None:
        rows.extend(fetch(exhibitor_limit))
    elif not booth_file:
        print(
            f"Note: no public exhibitor collector for {event_slug!r} and no "
            f"--booth-file given; nothing to collect."
        )

    if booth_file:
        from sources.booth_scan_import import load_booth_scans

        rows.extend(
            load_booth_scans(file_path=booth_file, event_slug=event_slug, show_name=show_name)
        )

    if not write:
        return {"collected": len(rows), "written": False, "rows": rows}

    from outreach.cockpit_api import merge_records

    res = merge_records(
        rows,
        data_batch_override=event_slug,
        source_bucket_override=_bucket_for(event_slug),
    )
    res["collected"] = len(rows)
    return res


def _event_accounts(bucket: str, *, needing: str, limit: int) -> list[dict[str, Any]]:
    """Return event accounts needing enrichment. ``needing`` ∈ {website, contacts}."""
    from outreach.db import connect

    if needing == "website":
        cond = "COALESCE(a.website,'') = ''"
    elif needing == "contacts":
        cond = "NOT EXISTS (SELECT 1 FROM contacts c WHERE c.account_id = a.id)"
    else:
        raise ValueError(needing)

    conn = connect()
    try:
        return [
            dict(r)
            for r in conn.execute(
                f"""
                SELECT a.id, a.company, a.website, a.industry, a.location
                FROM accounts a
                WHERE lower(COALESCE(a.lead_source_bucket,'')) = lower(?) AND {cond}
                ORDER BY a.id
                LIMIT ?
                """,
                (bucket, limit),
            ).fetchall()
        ]
    finally:
        conn.close()


def _write_website(account_id: int, url: str) -> None:
    """Set a resolved website, only when the account has none (never clobbers)."""
    from outreach.db import connect

    conn = connect()
    try:
        conn.execute(
            "UPDATE accounts SET website = ? WHERE id = ? AND COALESCE(website,'') = ''",
            (url, account_id),
        )
        conn.commit()
    finally:
        conn.close()


def resolve_websites(bucket: str, *, limit: int, write: bool = True) -> dict[str, Any]:
    """Resolve websites for event accounts that have none."""
    from pipeline.enrich_websites import resolve_account

    accts = _event_accounts(bucket, needing="website", limit=limit)
    resolved = 0
    for acct in accts:
        d = resolve_account(acct)
        ok = d.get("status") == "accepted" and bool(d.get("chosen_url"))
        print(f"  website: {acct['company'][:45]:45} -> {d.get('status'):12} {d.get('chosen_host') or '-'}")
        if ok and write:
            _write_website(int(acct["id"]), str(d["chosen_url"]))
            resolved += 1
    return {"website_candidates": len(accts), "websites_resolved": resolved}


def find_contacts(bucket: str, *, limit: int, max_contacts: int = 3) -> dict[str, Any]:
    """Find decision-maker contacts for event accounts that have none."""
    from pipeline.full_enrich import enrich_one_account

    accts = _event_accounts(bucket, needing="contacts", limit=limit)
    people = 0
    for acct in accts:
        try:
            out = enrich_one_account(int(acct["id"]), max_contacts=max_contacts)
            people += int(out.get("people") or 0)
            print(f"  contacts: {acct['company'][:45]:45} -> {out.get('people', 0)} person(s)")
        except Exception as e:  # noqa: BLE001 — one bad account never stops the batch
            print(f"  contacts: {acct['company'][:45]:45} -> {type(e).__name__}")
    return {"contact_candidates": len(accts), "people_found": people}


def run_event(
    event_slug: str,
    show_name: str,
    *,
    booth_file: str | None = None,
    exhibitor_limit: int | None = None,
    website_limit: int = 500,
    contact_limit: int = 500,
    collect_only: bool = False,
    write: bool = True,
) -> dict[str, Any]:
    bucket = _bucket_for(event_slug)
    print(f"== {show_name} ({event_slug}) ==")
    summary: dict[str, Any] = {"event": event_slug}

    summary["collect"] = collect(
        event_slug, show_name, booth_file=booth_file, exhibitor_limit=exhibitor_limit, write=write
    )
    if collect_only or not write:
        return summary

    print("-- resolving websites --")
    summary["websites"] = resolve_websites(bucket, limit=website_limit, write=write)
    print("-- finding contacts --")
    summary["contacts"] = find_contacts(bucket, limit=contact_limit)
    return summary


def _cli() -> None:
    p = argparse.ArgumentParser(description="Run the scoped lead pipeline for one event pool.")
    p.add_argument("--event", required=True, help="event slug, e.g. weftec-2026")
    p.add_argument("--show", required=True, help='show name, e.g. "WEFTEC 2026"')
    p.add_argument("--booth-file", default=None, help="client's own booth-scan export (CSV/XLSX)")
    p.add_argument("--exhibitor-limit", type=int, default=None)
    p.add_argument("--website-limit", type=int, default=500)
    p.add_argument("--contact-limit", type=int, default=500)
    p.add_argument("--collect-only", action="store_true", help="collect + merge, skip enrichment")
    p.add_argument("--dry-run", action="store_true", help="collect preview only, write nothing")
    args = p.parse_args()

    summary = run_event(
        args.event,
        args.show,
        booth_file=args.booth_file,
        exhibitor_limit=args.exhibitor_limit,
        website_limit=args.website_limit,
        contact_limit=args.contact_limit,
        collect_only=args.collect_only,
        write=not args.dry_run,
    )
    if args.dry_run:
        rows = summary.get("collect", {}).get("rows", [])
        for r in rows[:15]:
            who = r.get("person_name") or r.get("company")
            print(f"  - {who} | {r.get('company')} | {r.get('email') or r.get('booth') or ''}")
        print(f"[dry-run] collected {summary.get('collect', {}).get('collected', 0)} rows; nothing written.")
    else:
        print(f"Done: {summary}")


if __name__ == "__main__":
    _cli()
