"""Milestone 2 — AI research on leads (`milestone2-research`) and outreach drafts / Instantly (`milestone2`)."""

from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from config import (
    INSTANTLY_API_KEY,
    INSTANTLY_VERIFY_LEADS_ON_IMPORT,
    MILESTONE2_CLIENT_APPROVED,
    MILESTONE2_HUNTER_DOMAIN_SEARCH,
    MILESTONE2_HUNTER_DOMAIN_SEARCH_LIMIT,
    MILESTONE2_DASHBOARD_BIND,
    MILESTONE2_DASHBOARD_PORT,
    MILESTONE2_DRAFTS_DIR,
    MILESTONE2_HUNTER_CONCURRENCY,
    MILESTONE2_HUNTER_GAP_SEC,
    MILESTONE2_HUNTER_MAX_ROWS,
    MILESTONE2_HUNTER_MIN_DELIVERABILITY,
    MILESTONE2_INSTANTLY_CAMPAIGN_ID,
    MILESTONE2_MAX_LEADS,
    MILESTONE2_MIN_LEADS,
    MILESTONE2_RESEARCH_BEFORE_OUTREACH,
    MILESTONE2_RESEARCH_CONCURRENCY,
    MILESTONE2_RESEARCH_FORCE,
    MILESTONE2_RESEARCH_GAP_SEC,
    MILESTONE2_RESEARCH_MAX_API_CALLS,
    MILESTONE2_RESEARCH_SHARE_BY_COMPANY,
    MILESTONE2_SEND,
    MILESTONE2_SEND_REQUIRES_CLIENT_APPROVAL,
    MILESTONE2_SEND_REQUIRES_HUNTER_OK,
    MILESTONE2_VERIFICATION_REPORT_PATH,
    GEMINI_MODEL,
    get_llm_api_key,
    llm_uses_openrouter,
    get_hunter_api_key,
    resolved_leads_xlsx_path,
    resolved_milestone2_db_path,
)
from outreach import campaign_store
from outreach.company_research import (
    RESEARCH_OUTPUT_FIELDS,
    research_lead,
    research_non_gemini_reason,
)
from outreach.instantly import build_instantly_lead_row, bulk_add_leads
from outreach.personalize import generate_sequence
from storage.xlsx_output import load_leads_from_xlsx, save_to_xlsx
from utils.identity import is_linkedin_source, record_identity_key
from utils import pipeline_events as events

_M2_SQLITE = str(resolved_milestone2_db_path())


def _leads_xlsx_path() -> Path:
    return resolved_leads_xlsx_path()


def _resolve_email(lead: dict) -> str:
    return (lead.get("email") or "").strip()


def _ensure_lead_source_bucket(lead: dict) -> None:
    if (lead.get("lead_source_bucket") or "").strip():
        return
    lead["lead_source_bucket"] = (
        "LinkedIn" if is_linkedin_source(lead.get("source", "")) else "Non-LinkedIn"
    )


def _lead_passes_hunter_for_send(lead: dict) -> bool:
    st = (lead.get("email_verification_status") or "").strip().lower()
    if st != "deliverable":
        return False
    raw = lead.get("email_deliverability_score")
    try:
        return float(str(raw).strip()) >= float(MILESTONE2_HUNTER_MIN_DELIVERABILITY)
    except (TypeError, ValueError):
        return False


def _apply_research_result(leads: list[dict], indices: list[int], r: dict) -> None:
    for j in indices:
        for k in RESEARCH_OUTPUT_FIELDS:
            if k not in r:
                continue
            val = r.get(k)
            leads[j][k] = "" if val is None else str(val)


def _split_person_name(person_name: str) -> tuple[str, str]:
    parts = (person_name or "").strip().split()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def _hunter_needs_person_for_finder(lead: dict) -> bool:
    """Email Verifier-only path when ``email`` set; otherwise Finder + Domain Search need ``person_name``."""
    return not bool(_resolve_email(lead))


def _hunter_enrich_row(lead: dict, api_key: str) -> None:
    from outreach.hunter_io import (
        hunter_domain_search,
        hunter_email_finder,
        hunter_email_verifier,
        parse_finder_email,
        parse_verification,
        pick_email_from_domain_search,
    )
    from utils.domain import website_domain_usable_for_corporate_email, website_to_domain
    from utils.linkedin_company_website import ensure_corporate_website_for_hunter

    w0 = str(lead.get("website") or "").strip()
    w_resolved = ensure_corporate_website_for_hunter(w0)
    if w_resolved and w_resolved != w0:
        lead["website"] = w_resolved

    domain = website_to_domain(str(lead.get("website") or ""))
    person = str(lead.get("person_name") or "").strip()
    first, last = _split_person_name(person)
    email = _resolve_email(lead)

    def _verify_found(em: str) -> None:
        vraw = hunter_email_verifier(email=em, api_key=api_key)
        if vraw:
            result, score, _err = parse_verification(vraw)
            lead["email_verification_status"] = result
            lead["email_deliverability_score"] = "" if score is None else str(score)
        else:
            lead["email_verification_status"] = "verify_request_failed"
            lead["email_deliverability_score"] = ""

    if email:
        _verify_found(email)
        return

    if not domain:
        lead["email_verification_status"] = "no_company_domain"
        lead["email_deliverability_score"] = ""
        return

    if not website_domain_usable_for_corporate_email(domain):
        lead["email_verification_status"] = "website_not_mail_domain"
        lead["email_deliverability_score"] = ""
        return

    if not person:
        lead["email_verification_status"] = "missing_person_name"
        lead["email_deliverability_score"] = ""
        return

    raw = hunter_email_finder(
        domain=domain,
        api_key=api_key,
        first_name=first,
        last_name=last,
        full_name="",
    )
    if raw:
        found, _v = parse_finder_email(raw)
        if found:
            email = found
            lead["email"] = email
            _verify_found(email)
            return

    raw_full = hunter_email_finder(
        domain=domain,
        api_key=api_key,
        first_name="",
        last_name="",
        full_name=person,
    )
    if raw_full:
        found, _v = parse_finder_email(raw_full)
        if found:
            email = found
            lead["email"] = email
            _verify_found(email)
            return

    if MILESTONE2_HUNTER_DOMAIN_SEARCH:
        ds = hunter_domain_search(
            domain=domain,
            api_key=api_key,
            limit=MILESTONE2_HUNTER_DOMAIN_SEARCH_LIMIT,
        )
        if ds:
            picked = pick_email_from_domain_search(
                first_name=first,
                last_name=last,
                full_name=person,
                data=ds,
            )
            if picked:
                lead["email"] = picked
                _verify_found(picked)
                return

    lead["email_verification_status"] = "no_email"
    lead["email_deliverability_score"] = ""


def _write_email_verification_report(leads: list[dict]) -> None:
    path = Path(MILESTONE2_VERIFICATION_REPORT_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    with_email = [(L, _resolve_email(L)) for L in leads if _resolve_email(L)]
    n = len(with_email)
    if n == 0:
        risky_pct = None
        undel_pct = None
    else:
        risky = sum(
            1
            for L, _ in with_email
            if (L.get("email_verification_status") or "").lower() == "risky"
        )
        bad = sum(
            1
            for L, _ in with_email
            if (L.get("email_verification_status") or "").lower()
            in ("undeliverable", "invalid")
        )
        unknown = sum(
            1
            for L, _ in with_email
            if (L.get("email_verification_status") or "").lower()
            in ("unknown", "", "verify_request_failed")
        )
        undel_pct = round(100.0 * bad / n, 2)
        risky_pct = round(100.0 * (bad + risky + 0.5 * unknown) / n, 2)

    body = {
        "generated_unix": time.time(),
        "rows_total": len(leads),
        "rows_with_email": n,
        "missing_person_name_count": sum(
            1
            for L in leads
            if (L.get("email_verification_status") or "").lower() == "missing_person_name"
        ),
        "deliverable_count": sum(
            1 for L in leads if (L.get("email_verification_status") or "").lower() == "deliverable"
        ),
        "estimated_high_bounce_risk_pct_heuristic": risky_pct,
        "estimated_hard_bounce_risk_pct": undel_pct,
        "notes": (
            "Email Finder needs `person_name` + corporate `website` domain when `email` is empty. "
            "`missing_person_name` rows need a contact name in the sheet. "
            "Hunter `risky`/unknown/skipped verifier rows are heuristic risk; chase <2% bounce via "
            "list hygiene + INSTANTLY_VERIFY_LEADS_ON_IMPORT."
        ),
    }
    path.write_text(json.dumps(body, indent=2), encoding="utf-8")
    print(f"Milestone 2 enrich: verification summary → {path}")


def _build_research_fetch_jobs(
    leads: list[dict],
    *,
    share_by_company: bool,
    research_force: bool,
) -> list[tuple[str, int, list[int]]]:
    """Return jobs as (job_key, representative_row_index, row_indices_to_fill)."""
    if share_by_company:
        group_indices: dict[str, list[int]] = {}
        for i, lead in enumerate(leads):
            k = _row_group_key(lead, i)
            group_indices.setdefault(k, []).append(i)
        fetch_jobs: list[tuple[str, int, list[int]]] = []
        for key, indices in group_indices.items():
            if not indices:
                continue
            group_needs = research_force or any(_needs_research(leads[j]) for j in indices)
            if not group_needs:
                continue
            fetch_jobs.append((key, indices[0], indices))
        return fetch_jobs
    jobs: list[tuple[str, int, list[int]]] = []
    for i, lead in enumerate(leads):
        if research_force or _needs_research(lead):
            jobs.append((f"__row_{i}", i, [i]))
    return jobs


def _cap_research_jobs(
    fetch_jobs: list[tuple[str, int, list[int]]],
) -> list[tuple[str, int, list[int]]]:
    if (
        bool(get_llm_api_key())
        and MILESTONE2_RESEARCH_MAX_API_CALLS > 0
        and len(fetch_jobs) > MILESTONE2_RESEARCH_MAX_API_CALLS
    ):
        print(
            f"Milestone 2 research: limiting to first {MILESTONE2_RESEARCH_MAX_API_CALLS} "
            f"job(s) (of {len(fetch_jobs)})."
        )
        return fetch_jobs[: MILESTONE2_RESEARCH_MAX_API_CALLS]
    return fetch_jobs


def _finalize_research_job_output(
    leads: list[dict],
    indices: list[int],
    r: dict | None,
    err: Exception | None,
) -> tuple[int, int, int, int]:
    """Apply one research result or record failure. Returns (failed, tmpl_no_key_rows, api_err_rows, rows_updated)."""
    if err is not None or r is None:
        return (1, 0, 0, 0)
    nk = ae = 0
    reason = research_non_gemini_reason(r)
    if reason == "no_key":
        nk = len(indices)
    elif reason == "api_error":
        ae = len(indices)
    for j in indices:
        _apply_research_result(leads, [j], r)
    return (0, nk, ae, len(indices))


def _research_live_tag(r: dict | None, err: Exception | None) -> str:
    if err is not None or r is None:
        return "failed"
    reason = research_non_gemini_reason(r)
    if reason is None:
        return "gemini"
    return reason


def _execute_research_jobs(
    leads: list[dict],
    fetch_jobs: list[tuple[str, int, list[int]]],
) -> tuple[int, int, int, int, int]:
    """Run Gemini research jobs; mutate ``leads``.

    Prints **as each job finishes** so long HTTPS calls never look hung.

    Returns ``(updated_rows, failed_jobs, total_jobs, template_no_key_rows, template_api_err_rows)``.
    """
    n_jobs = len(fetch_jobs)
    if not n_jobs:
        return (0, 0, 0, 0, 0)
    workers = min(MILESTONE2_RESEARCH_CONCURRENCY, n_jobs)

    def _one(job: tuple[str, int, list[int]]) -> tuple[str, list[int], dict | None, Exception | None]:
        _key, rep_idx, indices = job
        if MILESTONE2_RESEARCH_GAP_SEC > 0:
            time.sleep(MILESTONE2_RESEARCH_GAP_SEC)
        try:
            r = research_lead(leads[rep_idx])
            return (_key, indices, r, None)
        except Exception as e:
            return (_key, indices, None, e)

    def _one_timed(
        job: tuple[str, int, list[int]],
    ) -> tuple[str, list[int], dict | None, Exception | None, float]:
        t0 = time.perf_counter()
        _key, indices, r, err = _one(job)
        return (_key, indices, r, err, time.perf_counter() - t0)

    updated = 0
    failed = 0
    template_no_key = 0
    template_api_err = 0
    done = 0
    t_batch = time.perf_counter()

    print(
        f"  Live progress — {n_jobs} research job(s), {workers} worker(s). "
        f"Lines appear each time a job finishes (Gemini HTTPS can take 30–120s each).",
        flush=True,
    )

    def _emit_line(indices: list[int], r: dict | None, err: Exception | None, dt_job: float) -> None:
        nonlocal done
        done += 1
        rep = leads[indices[0]]
        co_raw = str(rep.get("company") or "").strip() or "(no company)"
        co = co_raw[:54] + ("…" if len(co_raw) > 54 else "")
        n_rows = len(indices)
        row_note = f" →{n_rows} rows" if n_rows > 1 else ""
        elapsed = time.perf_counter() - t_batch
        pct = 100.0 * done / n_jobs
        eta_s = ((n_jobs - done) * (elapsed / done)) if done > 0 else 0.0
        eta_m = eta_s / 60.0
        tag = _research_live_tag(r, err)
        err_tail = ""
        if err is not None:
            err_tail = "  ⚠ " + str(err).replace("\n", " ")[:100]
        elif tag == "api_error" and r:
            cp = str(r.get("company_profile") or "")
            marker = "AI research failed (Gemini error). "
            if marker in cp:
                err_tail = "  ⚠ " + cp.split(marker, 1)[-1][:100]
        print(
            f"  [{done}/{n_jobs}] {pct:4.1f}%  job {dt_job:5.1f}s  run {elapsed:6.0f}s  "
            f"ETA ~{eta_m:5.1f}m  [{tag}]{row_note}  {co}{err_tail}",
            flush=True,
        )

    if workers <= 1:
        for job in fetch_jobs:
            _, indices_o, r, err, dt = _one_timed(job)
            f, nk, ae, upd = _finalize_research_job_output(leads, indices_o, r, err)
            failed += f
            template_no_key += nk
            template_api_err += ae
            updated += upd
            _emit_line(indices_o, r, err, dt)
    else:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = {ex.submit(_one_timed, j): j for j in fetch_jobs}
            for fut in as_completed(futs):
                _, indices_o, r, err, dt = fut.result()
                f, nk, ae, upd = _finalize_research_job_output(leads, indices_o, r, err)
                failed += f
                template_no_key += nk
                template_api_err += ae
                updated += upd
                _emit_line(indices_o, r, err, dt)

    return (updated, failed, n_jobs, template_no_key, template_api_err)


def _maybe_save_researched_sheet(xlsx_path: Path, leads: list[dict], label: str) -> None:
    save_to_xlsx(leads, xlsx_path)
    print(f"{label}: saved {len(leads)} rows to {xlsx_path}.")


def run_milestone2() -> None:
    xlsx_path = _leads_xlsx_path()
    if not xlsx_path.is_file():
        print(
            f"Milestone 2: no leads file at {xlsx_path}. Run milestone 1 first or set MILESTONE2_LEADS_XLSX."
        )
        return

    leads = load_leads_from_xlsx(xlsx_path)
    if not leads:
        print("Milestone 2: spreadsheet has no data rows.")
        return

    cap = MILESTONE2_MAX_LEADS if MILESTONE2_MAX_LEADS > 0 else len(leads)
    leads = leads[:cap]

    for L in leads:
        _ensure_lead_source_bucket(L)

    if MILESTONE2_RESEARCH_BEFORE_OUTREACH and get_llm_api_key():
        fetch_jobs = _build_research_fetch_jobs(
            leads,
            share_by_company=MILESTONE2_RESEARCH_SHARE_BY_COMPANY,
            research_force=MILESTONE2_RESEARCH_FORCE,
        )
        if fetch_jobs:
            fetch_jobs = _cap_research_jobs(fetch_jobs)
            n_jobs = len(fetch_jobs)
            mode = (
                "company-grouped"
                if MILESTONE2_RESEARCH_SHARE_BY_COMPANY
                else "per-row"
            )
            print(
                f"Milestone 2: AI research before outreach ({n_jobs} Gemini job(s), {mode}), "
                f"concurrency={min(MILESTONE2_RESEARCH_CONCURRENCY, n_jobs)}."
            )
            t0 = time.perf_counter()
            updated, failed, _, no_key_t, api_err_t = _execute_research_jobs(leads, fetch_jobs)
            elapsed = time.perf_counter() - t0
            _maybe_save_researched_sheet(
                xlsx_path,
                leads,
                f"Milestone 2 (after outreach-prep research: {updated} row(s), {elapsed:.1f}s)",
            )
            if failed:
                print(f"  {failed} research job(s) failed (those rows unchanged).")
            if no_key_t or api_err_t:
                print(
                    f"  Research template rows (not live Gemini): no_api_key={no_key_t}, "
                    f"gemini_api_error={api_err_t}. See `company_profile` text and GEMINI_MODEL."
                )
    elif MILESTONE2_RESEARCH_BEFORE_OUTREACH and not get_llm_api_key():
        need = any(_needs_research(r) for r in leads)
        if need:
            print(
                "Milestone 2: research columns empty — set GEMINI_API_KEY (or run "
                "`python main.py milestone2-research` after adding a key) for AI company profile / "
                "projects / equipment text."
            )

    prepared: list[tuple[dict, str, tuple[str, ...]]] = []
    seen_email: set[str] = set()
    for lead in leads:
        email = _resolve_email(lead)
        if not email:
            continue
        el = email.lower()
        if el in seen_email:
            continue
        seen_email.add(el)
        row = dict(lead)
        row["email"] = email
        prepared.append((row, email, record_identity_key(row)))

    if len(prepared) < MILESTONE2_MIN_LEADS:
        print(
            f"Milestone 2: only {len(prepared)} leads with an email column (need >= {MILESTONE2_MIN_LEADS} "
            f"for the test band). Run `python main.py milestone2-enrich` after setting HUNTER_API_KEY "
            f"and ensure each row has a corporate `website` domain and `person_name` (required for "
            f"Hunter when `email` is empty)."
        )

    prepared = prepared[: MILESTONE2_MAX_LEADS]
    run_id = campaign_store.new_run_id()
    campaign_store.init_db(_M2_SQLITE)
    campaign_store.insert_run(_M2_SQLITE, run_id, note=f"source={xlsx_path.name}")

    drafts_path = Path(MILESTONE2_DRAFTS_DIR)
    drafts_path.mkdir(parents=True, exist_ok=True)
    jsonl_path = drafts_path / f"{run_id}_drafts.jsonl"

    if prepared:
        if get_llm_api_key():
            provider = "OpenRouter (Gemini)" if llm_uses_openrouter() else "Gemini"
            print(
                f"Milestone 2: drafting email sequences for {len(prepared)} lead(s) via {provider} "
                f"(no line until each call returns — often 10–60s per lead).",
                flush=True,
            )
        else:
            print(
                f"Milestone 2: drafting {len(prepared)} template sequence(s) (no LLM key — fast).",
                flush=True,
            )

    instantly_rows: list[dict] = []
    with jsonl_path.open("w", encoding="utf-8") as jf:
        for i, (lead, email, lkey) in enumerate(prepared):
            label = str(lead.get("company") or email or "—")[:56]
            print(f"  [{i + 1}/{len(prepared)}] sequence … {label}", flush=True)
            steps = generate_sequence(lead)
            campaign_store.insert_lead_with_steps(
                _M2_SQLITE,
                run_id,
                "|".join(lkey),
                email,
                lead,
                steps,
            )
            instantly_rows.append(build_instantly_lead_row(email, lead, steps))
            jf.write(
                json.dumps(
                    {
                        "lead_key": "|".join(lkey),
                        "email": email,
                        "company": lead.get("company"),
                        "steps": steps,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )

    print(f"Milestone 2: wrote {len(prepared)} draft sequences to {jsonl_path}")
    print(
        "  Client approval (required before live upload): review JSONL / DB / Instantly previews, "
        "then set MILESTONE2_CLIENT_APPROVED=1 with MILESTONE2_SEND=1."
    )

    if not MILESTONE2_SEND:
        print(
            "Milestone 2: dry run (no Instantly push). Set MILESTONE2_SEND=1 and "
            "INSTANTLY_API_KEY + MILESTONE2_INSTANTLY_CAMPAIGN_ID to upload leads."
        )
        _print_tail(run_id)
        return

    if MILESTONE2_SEND_REQUIRES_CLIENT_APPROVAL and not MILESTONE2_CLIENT_APPROVED:
        print(
            "Milestone 2: Instantly upload blocked — acceptance criteria require explicit client approval. "
            "After Peter reviews copy, set MILESTONE2_CLIENT_APPROVED=1 (optionally unset "
            "MILESTONE2_SEND_REQUIRES_CLIENT_APPROVAL=0 only for internal tests)."
        )
        _print_tail(run_id)
        return

    if INSTANTLY_API_KEY and MILESTONE2_INSTANTLY_CAMPAIGN_ID:
        push_rows = list(instantly_rows)
        if MILESTONE2_SEND_REQUIRES_HUNTER_OK:
            push_rows = []
            skipped_h = 0
            for (lead, _email, _key), row in zip(prepared, instantly_rows):
                if _lead_passes_hunter_for_send(lead):
                    push_rows.append(row)
                else:
                    skipped_h += 1
            if skipped_h:
                print(
                    f"  Hunter gate: skipping {skipped_h} lead(s) (need status=deliverable and "
                    f"email_deliverability_score≥{MILESTONE2_HUNTER_MIN_DELIVERABILITY}). "
                    "Run `python main.py milestone2-enrich` and review the verification report."
                )
            if not push_rows:
                print(
                    "Milestone 2: Hunter gate left zero uploadable contacts — skipping Instantly batches."
                )
        chunk = 100
        for offset in range(0, len(push_rows), chunk):
            batch = push_rows[offset : offset + chunk]
            try:
                summary = bulk_add_leads(
                    MILESTONE2_INSTANTLY_CAMPAIGN_ID,
                    batch,
                    verify_on_import=INSTANTLY_VERIFY_LEADS_ON_IMPORT,
                )
                campaign_store.record_event(
                    _M2_SQLITE,
                    "instantly_pushed",
                    {"offset": offset, "batch_size": len(batch), "response": summary},
                    run_id=run_id,
                )
                print(f"  Instantly bulk add offset {offset}: {summary}")
            except Exception as e:
                print(f"  Instantly API error at offset {offset}: {e}")
                campaign_store.record_event(
                    _M2_SQLITE,
                    "instantly_push_failed",
                    {"offset": offset, "error": str(e)},
                    run_id=run_id,
                )
    elif INSTANTLY_API_KEY and not MILESTONE2_INSTANTLY_CAMPAIGN_ID:
        print("Milestone 2: set MILESTONE2_INSTANTLY_CAMPAIGN_ID to push leads to Instantly.")

    _print_tail(run_id)


def run_milestone2_enrich() -> None:
    """Hunter.io email finder + verifier; writes spreadsheet + verification JSON summary."""
    xlsx_path = _leads_xlsx_path()
    if not xlsx_path.is_file():
        print(
            f"Milestone 2 enrich: missing {xlsx_path}. Run milestone1 first or set MILESTONE2_LEADS_XLSX."
        )
        return

    leads = load_leads_from_xlsx(xlsx_path)
    if not leads:
        print("Milestone 2 enrich: spreadsheet empty.")
        return

    cap = MILESTONE2_MAX_LEADS if MILESTONE2_MAX_LEADS > 0 else len(leads)
    leads = leads[:cap]

    for L in leads:
        _ensure_lead_source_bucket(L)

    api_key = get_hunter_api_key()
    if not api_key:
        print(
            "Milestone 2 enrich: set HUNTER_API_KEY in `.env` (see https://hunter.io ). "
            "Without it, finder/verification cannot run."
        )
        return

    n_cap = len(leads)
    if MILESTONE2_HUNTER_MAX_ROWS > 0:
        n_cap = min(n_cap, MILESTONE2_HUNTER_MAX_ROWS)

    # Spend a small (e.g. free-tier 50-credit) Hunter quota on the BEST-FIT
    # companies: rank by ICP and enrich the top ``MILESTONE2_HUNTER_MAX_ROWS``,
    # not whatever happens to sit at the top of the sheet. All rows are still
    # saved; only the enrichment work is capped.
    def _icp_of(idx: int) -> float:
        L = leads[idx]
        for k in ("icp_enhanced_score", "icp_score"):
            try:
                v = float(str(L.get(k) or "").strip())
                if v:
                    return v
            except (TypeError, ValueError):
                pass
        return 0.0

    indices = sorted(range(len(leads)), key=_icp_of, reverse=True)[:n_cap]
    workers = min(MILESTONE2_HUNTER_CONCURRENCY, len(indices) or 1)
    n_total = len(indices)
    cap_note = (
        f" (top {n_total} by ICP of {len(leads)} — MILESTONE2_HUNTER_MAX_ROWS cap)"
        if MILESTONE2_HUNTER_MAX_ROWS > 0 and len(leads) > n_total
        else ""
    )
    print(
        f"Milestone 2 enrich: Hunter on {n_total} row(s){cap_note}, concurrency={workers}, "
        f"gap={MILESTONE2_HUNTER_GAP_SEC}s (Hunter returns 403 when rate-limited — avoid burst traffic).",
        flush=True,
    )
    print(
        "  There is no log line until each HTTPS call returns — the first row can take 10–60s if "
        "Hunter or your network is slow. Watch the [n/total] lines below.",
        flush=True,
    )
    n_need_name = sum(
        1
        for i in indices
        if _hunter_needs_person_for_finder(leads[i])
        and not (str(leads[i].get("person_name") or "").strip())
    )
    if n_need_name:
        print(
            f"  {n_need_name} row(s) have empty `person_name` and no `email` — Hunter Email Finder "
            f"cannot run; `email_verification_status` will be `missing_person_name`. Fill names in the sheet.",
            flush=True,
        )

    events.run_started("milestone2-enrich")
    events.emit("enrich", f"Hunter email finder on {n_total} lead(s)…", level="info", count=n_total)

    def _job(pos: int, i: int) -> None:
        co = (leads[i].get("company") or "—")[:56]
        print(f"  [{pos + 1}/{n_total}] {co} …", flush=True)
        if MILESTONE2_HUNTER_GAP_SEC > 0:
            time.sleep(MILESTONE2_HUNTER_GAP_SEC)
        _hunter_enrich_row(leads[i], api_key)
        em = str(leads[i].get("email") or "").strip()
        st = str(leads[i].get("email_verification_status") or "").strip()
        events.emit(
            "enrich",
            f"[{pos + 1}/{n_total}] {co}: {st or ('email found' if em else 'no email')}",
            level="info",
        )

    t0 = time.perf_counter()
    try:
        if workers <= 1:
            for pos, i in enumerate(indices):
                _job(pos, i)
        else:
            with ThreadPoolExecutor(max_workers=workers) as ex:
                futs = [ex.submit(_job, pos, i) for pos, i in enumerate(indices)]
                for fut in as_completed(futs):
                    fut.result()

        elapsed = time.perf_counter() - t0
        save_to_xlsx(leads, xlsx_path)
        _write_email_verification_report(leads)
        n_emails = sum(1 for L in leads if str(L.get("email") or "").strip())
        print(f"Milestone 2 enrich: saved {len(leads)} rows in {elapsed:.1f}s.", flush=True)
        events.emit("enrich", f"Enrich done: {n_emails} email(s) found across {n_total} lead(s) ({elapsed:.0f}s)", level="success", count=n_emails)
        events.run_finished("milestone2-enrich", ok=True, emails=n_emails, rows=n_total)
    except KeyboardInterrupt:
        print("\nMilestone 2 enrich: interrupted — saving partial progress…", flush=True)
        save_to_xlsx(leads, xlsx_path)
        _write_email_verification_report(leads)
        print(f"  Wrote partial sheet + report ({xlsx_path.name}).", flush=True)
        raise


def _print_tail(run_id: str) -> None:
    stats = campaign_store.aggregate_stats(_M2_SQLITE, run_id)
    print(
        f"  Metrics snapshot (run {run_id[:8]}…): leads={stats['leads_total']}, "
        f"open_rate={stats['open_rate_pct']}, reply_rate={stats['reply_rate_pct']}, "
        f"bounce_rate={stats['bounce_rate_pct']}"
    )
    print(
        f"  Dashboard: python main.py milestone2-dashboard "
        f"(http://{MILESTONE2_DASHBOARD_BIND}:{MILESTONE2_DASHBOARD_PORT}/?run_id={run_id})"
    )


# --- Research step (`python main.py milestone2-research`) ---


def _row_group_key(lead: dict, row_index: int) -> str:
    c = (lead.get("company") or "").strip().lower()
    w = (lead.get("website") or "").strip().lower()
    return f"{c}|{w}" if c else f"__row_{row_index}"


def _needs_research(lead: dict) -> bool:
    return not bool(
        (lead.get("company_profile") or "").strip()
        or (lead.get("active_projects") or "").strip()
        or (lead.get("equipment_needs") or "").strip()
    )


def run_milestone2_research() -> None:
    xlsx_path = _leads_xlsx_path()
    if not xlsx_path.is_file():
        print(
            f"Milestone 2 research: no leads file at {xlsx_path}. "
            "Run milestone1 or set MILESTONE2_LEADS_XLSX."
        )
        return

    leads = load_leads_from_xlsx(xlsx_path)
    if not leads:
        print("Milestone 2 research: spreadsheet has no data rows.")
        return

    cap = MILESTONE2_MAX_LEADS if MILESTONE2_MAX_LEADS > 0 else len(leads)
    leads = leads[:cap]

    for L in leads:
        _ensure_lead_source_bucket(L)

    fetch_jobs = _build_research_fetch_jobs(
        leads,
        share_by_company=MILESTONE2_RESEARCH_SHARE_BY_COMPANY,
        research_force=MILESTONE2_RESEARCH_FORCE,
    )

    if not fetch_jobs:
        print(
            "Milestone 2 research: nothing to do (all rows already have research). "
            "Use MILESTONE2_RESEARCH_FORCE=1 to refresh."
        )
        return

    fetch_jobs = _cap_research_jobs(fetch_jobs)
    n_jobs = len(fetch_jobs)
    workers = min(MILESTONE2_RESEARCH_CONCURRENCY, n_jobs)
    mode = "company-grouped" if MILESTONE2_RESEARCH_SHARE_BY_COMPANY else "per-row"
    print(
        f"Milestone 2 research: {n_jobs} job(s) ({mode}), {len(leads)} rows, "
        f"concurrency={workers} (tune MILESTONE2_RESEARCH_CONCURRENCY vs rate limits)."
    )
    lk = get_llm_api_key()
    if lk:
        tail = lk[-4:] if len(lk) >= 4 else lk
        provider = "OpenRouter (Gemini)" if llm_uses_openrouter() else "Gemini"
        print(
            f"Milestone 2 research: {provider} API key present (len={len(lk)}, suffix …{tail}), "
            f"model={GEMINI_MODEL!r}.",
            flush=True,
        )
    else:
        print(
            "Milestone 2 research: WARNING — no LLM API key found. "
            "Set OPENROUTER_API_KEY (https://openrouter.ai/keys) or GEMINI_API_KEY in `.env`. "
            "The sheet will get placeholder text, not AI.",
            flush=True,
        )

    provider = "OpenRouter (Gemini)" if llm_uses_openrouter() else ("Gemini" if lk else "templates")
    events.run_started("milestone2-research")
    events.emit("research", f"AI research: {n_jobs} job(s) over {len(leads)} leads via {provider}", level="info", count=n_jobs)

    t0 = time.perf_counter()
    updated, failed, _, no_key_t, api_err_t = _execute_research_jobs(leads, fetch_jobs)
    elapsed = time.perf_counter() - t0
    save_to_xlsx(leads, xlsx_path)
    print(
        f"Milestone 2 research: saved {len(leads)} rows to {xlsx_path} "
        f"({updated} cell row(s) updated, {n_jobs} job(s)) in {elapsed:.1f}s."
    )
    events.emit("research", f"AI research done: {updated} row(s) enriched, {failed} job(s) failed ({elapsed:.0f}s)", level="success" if not failed else "warn", count=updated)
    events.run_finished("milestone2-research", ok=(failed == 0), updated=updated, failed=failed)
    if failed:
        print(f"Milestone 2 research: {failed} job(s) failed (rows left unchanged for those).")
    if no_key_t:
        print(
            f"Milestone 2 research: {no_key_t} row(s) still use the **no API key** template — "
            f"the process did not see a key at runtime. Fix `.env` variable names and remove blank "
            f"GEMINI_API_KEY= lines that override exports.",
            flush=True,
        )
    if api_err_t:
        print(
            f"Milestone 2 research: {api_err_t} row(s) used the **Gemini API error** template — "
            f"check billing, model name ({GEMINI_MODEL!r}), and network. First line of "
            f"`company_profile` on those rows has the error snippet.",
            flush=True,
        )
