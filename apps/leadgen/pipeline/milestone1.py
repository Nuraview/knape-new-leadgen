from __future__ import annotations

from config import (
    LINKEDIN_LEAD_TARGET,
    MIN_ICP_SCORE,
    MIN_PREVENTION_FUNDING_COUNT,
    NON_LINKEDIN_LEAD_TARGET,
    STRICT_FIFTY_FIFTY,
    TARGET_LEAD_COUNT,
)
from scoring.icp import apply_signal_classification, score_record
from sources.linkedin_people_search import fetch_linkedin_people
from sources.non_linkedin import fetch_non_linkedin_leads
from utils.clean import normalize_record
from utils.dedupe import dedupe_records
from utils.exclusions import dedupe_by_company, filter_excluded_records, summarize_exclusions
from utils.identity import is_linkedin_source, record_identity_key
from utils import pipeline_events as events


def _icp_val(r: dict) -> float:
    try:
        return float(r.get("icp_score", 0))
    except (TypeError, ValueError):
        return 0.0


def _sync_to_postgres(records: list[dict]) -> None:
    """Write records straight into the cockpit's Postgres — the only data store.

    Postgres is the source of truth the dashboard reads; there is no spreadsheet.
    Fails loudly if the DB is unreachable (nothing else persists the run).

    ``PIPELINE_SYNC_MODE=merge`` (set by the dashboard scheduler) merges additively —
    existing accounts keep their ids/contacts/sequences and new companies append.
    Default remains the full rebuild for explicit manual runs.
    """
    import os

    from config import DATABASE_URL

    if not DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL is not set — leads have nowhere to go. Configure Postgres "
            "(the pipeline writes directly to it; there is no xlsx fallback)."
        )
    # Merge unless REPLACE is asked for explicitly.
    #
    # This used to require PIPELINE_SYNC_MODE=merge to be additive, so the safe
    # path was opt-in and the destructive one was what you got by running
    # `python main.py milestone1` by hand. That is not a hypothetical: it
    # replaced the accounts table on 2026-08-04, every account id changed, 669
    # of 670 email sequences were orphaned from their leads, and the contacts
    # table went from 1,779 rows to zero. There were no backups.
    #
    # The scheduler always passed merge, so the only caller that could ever hit
    # the destructive branch was a human at a shell — the one caller least
    # likely to have read this file first. Replacing now takes
    # PIPELINE_SYNC_MODE=replace, said out loud.
    if os.getenv("PIPELINE_SYNC_MODE", "merge").strip().lower() != "replace":
        from outreach.cockpit_api import merge_records

        res = merge_records(records)
        print(
            f"  Merged into Postgres: +{res.get('added', 0)} new, "
            f"{res.get('updated', 0)} refreshed, {res.get('total', 0)} total (dashboard live)."
        )
        return
    from outreach.cockpit_api import sync_records

    print(
        "  PIPELINE_SYNC_MODE=replace — REPLACING the accounts table. "
        "Existing accounts, and the contacts hanging off them, will be dropped."
    )
    res = sync_records(records)
    print(f"  Wrote {res.get('accounts', 0)} accounts to Postgres (dashboard live).")


def select_balanced_milestone1_pool(records: list[dict]) -> list[dict]:
    """Prefer ``LINKEDIN_LEAD_TARGET`` + ``NON_LINKEDIN_LEAD_TARGET``.

    If ``STRICT_FIFTY_FIFTY`` is true, do not pad with extra LinkedIn rows when
    the non-LinkedIn pool has fewer than ``NON_LINKEDIN_LEAD_TARGET`` qualified
    leads (keeps the 50% non-LinkedIn requirement honest).
    """
    li = [r for r in records if is_linkedin_source(r.get("source", ""))]
    nl = [r for r in records if not is_linkedin_source(r.get("source", ""))]
    li.sort(key=lambda r: (-_icp_val(r), r.get("company", "")))
    nl.sort(key=lambda r: (-_icp_val(r), r.get("company", "")))

    if STRICT_FIFTY_FIFTY:
        n_li = min(LINKEDIN_LEAD_TARGET, len(li))
        n_nl = min(NON_LINKEDIN_LEAD_TARGET, len(nl))
        out = li[:n_li] + nl[:n_nl]
        if n_nl < NON_LINKEDIN_LEAD_TARGET:
            print(
                f"Warning: only {n_nl} qualified non-LinkedIn leads (need "
                f"{NON_LINKEDIN_LEAD_TARGET} for full 50/50). Configure ThomasNet "
                "(Apify), ConstructConnect (Dodge API), CIVcast URL, and industry "
                "database URL — see .env.example."
            )
        if len(out) < TARGET_LEAD_COUNT:
            print(
                f"Warning: output will have {len(out)} rows (target {TARGET_LEAD_COUNT}) "
                "until non-LinkedIn APIs return more qualified leads."
            )
        return out[:TARGET_LEAD_COUNT]

    out = li[:LINKEDIN_LEAD_TARGET] + nl[:NON_LINKEDIN_LEAD_TARGET]
    seen = {record_identity_key(r) for r in out}

    tail_dup: set[tuple[str, ...]] = set()
    candidates: list[dict] = []
    for r in li[LINKEDIN_LEAD_TARGET:] + nl[NON_LINKEDIN_LEAD_TARGET:]:
        k = record_identity_key(r)
        if k in seen or k in tail_dup:
            continue
        tail_dup.add(k)
        candidates.append(r)

    candidates.sort(key=lambda r: -_icp_val(r))
    for r in candidates:
        if len(out) >= TARGET_LEAD_COUNT:
            break
        k = record_identity_key(r)
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
    return out[:TARGET_LEAD_COUNT]


def _enforce_signal_minimums(
    selected: list[dict],
    pool: list[dict],
    mins: dict[str, int],
) -> list[dict]:
    out = list(selected)
    selected_keys = {record_identity_key(r) for r in out}
    selected_counts = {
        sig: sum(1 for r in out if r.get("signal_category") == sig) for sig in mins
    }

    for sig, required in mins.items():
        if selected_counts.get(sig, 0) >= required:
            continue
        candidates = [r for r in pool if r.get("signal_category") == sig]
        candidates.sort(key=lambda r: (-_icp_val(r), r.get("company", "")))
        for r in candidates:
            if selected_counts[sig] >= required:
                break
            k = record_identity_key(r)
            if k in selected_keys:
                continue
            selected_keys.add(k)
            out.append(r)
            selected_counts[sig] = selected_counts.get(sig, 0) + 1

    out.sort(key=lambda r: (-_icp_val(r), r.get("company", "")))
    trimmed = out[:TARGET_LEAD_COUNT]
    trimmed_counts = {
        sig: sum(1 for r in trimmed if r.get("signal_category") == sig) for sig in mins
    }
    for sig, required in mins.items():
        if trimmed_counts.get(sig, 0) < required:
            print(
                f"Warning: selected only {trimmed_counts.get(sig, 0)} rows for {sig} "
                f"(target {required}). Add more source data for this signal."
            )
    return trimmed


def run_milestone1() -> None:
    print("Milestone 1: live collection.")
    events.run_started("milestone1")
    try:
        _run_milestone1()
    except Exception as e:  # surface credit/quota problems to the dashboard
        events.note_vendor_error("Apify", e)
        events.run_finished("milestone1", ok=False, error=str(e)[:300])
        raise


def _run_milestone1() -> None:
    events.emit("scrape", "Searching LinkedIn for athletic directors & prevention leads…", level="info")
    li_profiles = fetch_linkedin_people()
    events.emit("scrape", f"LinkedIn profiles: {len(li_profiles)} rows", level="info", source="linkedin_people", count=len(li_profiles))

    events.emit("scrape", "Scraping grant + school directory sources (USAspending, NCES)…", level="info")
    non_li = fetch_non_linkedin_leads()
    events.emit("scrape", f"Grant/school sources: {len(non_li)} rows", level="info", source="non_linkedin", count=len(non_li))

    raw = li_profiles + non_li
    print(f"  Raw rows fetched: {len(raw)}")
    events.emit("scrape", f"Raw rows fetched: {len(raw)}", level="success", count=len(raw))

    cleaned = [normalize_record(dict(r)) for r in raw]
    eligible = filter_excluded_records(cleaned)
    if len(eligible) < len(cleaned):
        dropped = summarize_exclusions(cleaned)
        parts = [f"{k}={v}" for k, v in sorted(dropped.items())]
        detail = f" ({', '.join(parts)})" if parts else ""
        print(f"  Excluded {len(cleaned) - len(eligible)} off-ICP rows{detail}.")
        events.emit("filter", f"Excluded {len(cleaned) - len(eligible)} off-ICP rows", level="info", count=len(cleaned) - len(eligible))
    for r in eligible:
        apply_signal_classification(r)
    scored = [score_record(r) for r in eligible]
    identity_unique = dedupe_records(scored)
    unique_all = dedupe_by_company(identity_unique)
    if len(unique_all) < len(identity_unique):
        print(f"  Collapsed duplicate company rows to {len(unique_all)} unique companies.")
    qualified = [r for r in unique_all if _icp_val(r) >= MIN_ICP_SCORE]
    events.emit("score", f"{len(qualified)} leads qualified (ICP ≥ {MIN_ICP_SCORE}) of {len(unique_all)} unique companies", level="info", count=len(qualified))
    balanced = select_balanced_milestone1_pool(qualified)
    balanced = _enforce_signal_minimums(
        balanced,
        unique_all,
        {"prevention_funding": MIN_PREVENTION_FUNDING_COUNT},
    )

    for r in balanced:
        r["lead_source_bucket"] = (
            "LinkedIn" if is_linkedin_source(r.get("source", "")) else "Non-LinkedIn"
        )

    # Postgres is the one source of truth — write leads straight to the DB the
    # dashboard reads. No spreadsheet, no file transport.
    from utils.merge_leads import today_batch_label

    label = today_batch_label()
    for r in balanced:
        r.setdefault("data_batch", label)
    _sync_to_postgres(balanced)

    li_n = sum(1 for r in balanced if is_linkedin_source(r.get("source", "")))
    print(
        f"Scrape batch: {len(balanced)} leads (LinkedIn {li_n}, other {len(balanced) - li_n}) "
        f"→ Postgres. Qualified ICP>={MIN_ICP_SCORE} unique: {len(qualified)}."
    )
    events.emit(
        "save",
        f"Scraped {len(balanced)} leads → Postgres (dashboard live)",
        level="success",
        count=len(balanced),
        batch=len(balanced),
    )
    events.run_finished("milestone1", ok=True, leads=len(balanced), qualified=len(qualified))
