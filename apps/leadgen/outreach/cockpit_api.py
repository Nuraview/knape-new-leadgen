"""Cockpit API: SQLite-backed triage dashboard data + simple auth."""

from __future__ import annotations

import hashlib
import json
import secrets
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import RedirectResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import (
    COCKPIT_ADMIN_EMAIL,
    COCKPIT_ADMIN_PASSWORD,
    COCKPIT_API_BIND,
    COCKPIT_API_PORT,
    COCKPIT_API_RELOAD,
    COCKPIT_DB_PATH,
    COCKPIT_SESSION_DAYS,
    COCKPIT_ALLOWED_ORIGINS,
    COCKPIT_CORS_ORIGIN_REGEX,
    OUTREACH_FROM_EMAIL,
    resolved_leads_xlsx_path,
    resolved_milestone2_db_path,
)
from outreach import brand, campaign_store, db
from outreach.personalize import cockpit_preview_sequence
from scoring.icp import score_record
from storage.xlsx_output import load_leads_from_xlsx
from utils.exclusions import filter_excluded_records, is_excluded_record, normalize_company_key
from utils.merge_leads import today_batch_label
from utils.signal_urls import pick_signal_url_for_account, repair_lead_post_url


def _lead_stub_for_sequence_preview(account: dict[str, Any], contacts: list[dict[str, Any]]) -> dict[str, Any]:
    top = contacts[0] if contacts else {}
    return {
        "company": (account.get("company") or "").strip(),
        "website": (account.get("website") or "").strip(),
        "person_name": (top.get("person_name") or "").strip(),
        "job_title": (top.get("job_title") or "").strip(),
        "signal_evidence": (account.get("signal_evidence") or "").strip(),
        "icp_score": str(account.get("icp_enhanced_score") or account.get("icp_score") or "").strip(),
        "email": (top.get("email") or "").strip(),
    }


def _outreach_sequence_for_account(account: dict[str, Any], contacts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    db_path = resolved_milestone2_db_path()
    if db_path.is_file():
        emails = [(c.get("email") or "").strip() for c in contacts if (c.get("email") or "").strip()]
        stored = campaign_store.fetch_sequence_steps_for_contact_emails(
            str(db_path),
            emails,
            account_company=(account.get("company") or ""),
            account_website=(account.get("website") or ""),
        )
        if stored:
            return _normalize_sequence_steps(stored)
        company = (account.get("company") or "").strip()
        if company:
            stored = campaign_store.fetch_sequence_steps_for_latest_company_lead(str(db_path), company)
            if stored:
                return _normalize_sequence_steps(stored)
    return _normalize_sequence_steps(cockpit_preview_sequence(_lead_stub_for_sequence_preview(account, contacts)))


def _normalize_sequence_steps(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, st in enumerate(steps):
        out.append(
            {
                "step_index": int(st.get("step_index", i)),
                "subject": str(st.get("subject", "")),
                "body": str(st.get("body", "")),
                "delay_after_prev_days": int(st.get("delay_after_prev_days", 0)),
            }
        )
    return out


def _connect() -> db._Conn:
    return db.connect()


def _hash_password(password: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        b"cockpit-static-salt-change-me",
        120_000,
    ).hex()


def _title_role_rank(title: str) -> int:
    t = (title or "").lower()
    if "athletic director" in t or "activities director" in t or "director of athletics" in t:
        return 10
    if "prevention" in t and any(k in t for k in ("manager", "coordinator", "director", "specialist")):
        return 10
    if any(k in t for k in ("student assistance", "wellness coordinator", "coalition coordinator", "coalition director")):
        return 9
    if any(k in t for k in ("principal", "superintendent")):
        return 8
    if any(k in t for k in ("chief", "president", "vp", "vice president", "director")):
        return 8
    if "coach" in t:
        return 6
    if any(k in t for k in ("head", "manager", "lead", "coordinator")):
        return 6
    if any(k in t for k in ("teacher", "counselor", "physical education")):
        return 5
    return 3


def _url_identity(u: str) -> str:
    s = u.strip().rstrip("/").lower()
    if s.startswith("http://"):
        s = "https://" + s[7:]
    for prefix in ("https://www.", "http://www.", "https://", "http://"):
        if s.startswith(prefix):
            s = s[len(prefix) :]
            break
    return s.rstrip("/")


def _preferred_evidence_post_url(leads: list[dict[str, Any]], best: dict[str, Any], account_website: str) -> str:
    """Pick a signal/listing URL for Cockpit; never use the corporate homepage as the source link."""
    return pick_signal_url_for_account(leads, best, account_website)


def _fallback_spark(best: dict[str, Any], company: str) -> str:
    """Client-clean profile line when no AI research brief exists yet (no jargon).

    Written off the SIGNAL, which is what the pipeline actually establishes about
    an account, rather than off the source. It used to assert that the company
    "sits in a county with active federal substance-prevention grant funding" —
    a specific, checkable claim about a school district, printed on the card of
    every account on every instance. On an industrial pipeline it was simply
    false, and it was the first sentence the client read on a lead.
    """
    cat = str(best.get("signal_category") or "").lower()
    loc = str(best.get("location") or "").strip()
    where = f" in {loc}" if loc else ""

    if cat == "engineering_hires":
        return (
            f"{company}{where} is hiring engineering staff, which usually means design work "
            "in flight and specifications still open."
        )
    if cat == "facility_expansion":
        return (
            f"{company}{where} is expanding capacity or facilities — the window where "
            "equipment selection is genuinely open."
        )
    if cat == "new_product_development":
        return (
            f"{company}{where} has new product or R&D activity, which tends to pull new "
            "process and air-handling requirements with it."
        )
    return f"{company}{where} matches the target buyer profile — worth outreach now."


#: Off-ICP name markers. An account whose name says it is one of these is not a
#: buyer of industrial equipment however well it scores on the other pillars.
_OFF_ICP_MARKERS = (
    "staffing", "recruit", "consultancy", "consulting group", "law firm",
    "insurance", "real estate", "marketing agency", "university", "school district",
)

#: Ordered name/text markers → the bucket shown on the card and the donut.
#: First match wins, so the more specific verticals are listed first.
_INDUSTRY_MARKERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Marine & offshore", ("marine", "offshore", "shipyard", "shipbuild", "vessel", "naval", "drydock", "fpso")),
    ("Oil, gas & chemical", ("oil", "gas", "petro", "refin", "chemical", "lng", "pipeline")),
    ("Utilities & infrastructure", ("utility", "utilities", "power", "energy", "water authority", "transit", "rail")),
    ("EPC & engineering", ("engineering", "epc", "constructors", "contracting", "design build")),
    ("Specialty mechanical", ("mechanical", "hvac", "ventilation", "air handling", "sheet metal")),
    ("Industrial & OEM", ("manufactur", "industrial", "oem", "fabricat", "foundry", "mill", "plant", "works")),
)


def _industry_tag(lead: dict[str, Any]) -> str:
    """Bucket accounts for the UI.

    Name and evidence text only. The previous version split primarily on the
    SOURCE the row came from ("nces" → a school, "usaspending" → a coalition),
    which is not a property of the company at all — it is a property of which
    scraper happened to find it. Those sources no longer exist here, and the
    buckets they produced named a different industry than this pipeline targets.
    """
    company = str(lead.get("company") or "").lower()

    if any(k in company for k in _OFF_ICP_MARKERS):
        return "Off-ICP"

    text = " ".join(
        str(lead.get(k) or "")
        for k in ("company", "industry", "signal_evidence", "company_profile", "job_title")
    ).lower()

    for bucket, markers in _INDUSTRY_MARKERS:
        if any(k in text for k in markers):
            return bucket
    return "Other"


def _cockpit_industry_bucket(best: dict[str, Any], icp_gate: float) -> str:
    """Stored ``accounts.industry`` for filters + donut: fail gate, else vertical."""
    if icp_gate < 5:
        return "Off-ICP"
    return _industry_tag(best)


# UI filter value → DB ``accounts.industry`` labels (legacy + new) so chips work before re-sync.
_INDUSTRY_FILTER_ALIASES: dict[str, tuple[str, ...]] = {}


def _industry_filter_sql_and_args(column: str, filter_value: str) -> tuple[str, list[Any]]:
    raw = filter_value.strip()
    labels = _INDUSTRY_FILTER_ALIASES.get(raw, (raw,))
    uniq: list[str] = []
    for x in labels:
        if x not in uniq:
            uniq.append(x)
    if len(uniq) == 1:
        return f"{column} = ?", [uniq[0]]
    subs = " OR ".join(f"{column} = ?" for _ in uniq)
    return f"({subs})", list(uniq)


def _account_table_where_clauses(
    *,
    q: str,
    min_icp: float,
    contact_filter: str,
    momentum_only: bool,
    industry: str | None,
    has_reminder: bool = False,
    equipment_tag: str | None = None,
    data_batch: str | None = None,
) -> tuple[list[str], list[Any]]:
    """Shared list filters. ``contact_filter``: any | has | none. When ``industry`` is None, industry is not constrained.
    ``data_batch``: all (default) | latest (newest run) | original (pre-scrape leads only)."""
    where = ["1=1"]
    args: list[Any] = []
    db = (data_batch or "all").strip().lower()
    if db == "original":
        where.append("COALESCE(data_batch, '') = 'original'")
    elif db == "latest":
        # The single newest run (ISO date strings sort lexically), not every
        # dated batch — so "Latest run" stays accurate as runs accumulate.
        where.append(
            "COALESCE(data_batch, '') = ("
            "SELECT MAX(data_batch) FROM accounts "
            "WHERE COALESCE(data_batch, '') != '' AND COALESCE(data_batch, '') != 'original')"
        )
    elif db not in ("all", ""):
        # A specific batch label, e.g. a scrape date like "2026-06-24".
        where.append("COALESCE(data_batch, '') = ?")
        args.append((data_batch or "").strip())
    if q.strip():
        where.append("lower(trim(COALESCE(company, ''))) LIKE ?")
        args.append(f"%{q.strip().lower()}%")
    if industry and industry.strip():
        clause, ind_args = _industry_filter_sql_and_args("industry", industry)
        where.append(clause)
        args.extend(ind_args)
    where.append("COALESCE(icp_enhanced_score, icp_score) >= ?")
    args.append(min_icp)
    if has_reminder:
        where.append("has_reminder = 1")
    cf = (contact_filter or "any").strip().lower()
    if cf not in ("any", "has", "none"):
        cf = "any"
    if cf == "has":
        where.append("EXISTS (SELECT 1 FROM contacts c WHERE c.account_id = accounts.id)")
    elif cf == "none":
        where.append("NOT EXISTS (SELECT 1 FROM contacts c WHERE c.account_id = accounts.id)")
    if momentum_only:
        where.append("fresh_signal != 0")
    if equipment_tag and equipment_tag.strip():
        where.append("strpos(lower(COALESCE(equipment_tags, '')), ?) > 0")
        args.append(equipment_tag.strip().lower())
    return where, args


def _account_row_is_visible(row: dict[str, Any]) -> bool:
    """Safety net: hide blocked competitors/partners/reps even if present in SQLite."""
    return not is_excluded_record(
        {
            "company": row.get("company"),
            "website": row.get("website"),
            "signal_evidence": row.get("signal_evidence"),
            "company_profile": row.get("spark_brief") or row.get("company_profile"),
            "post_url": row.get("signal_url"),
            "source": row.get("lead_source_bucket"),
        }
    )


def _visible_deduped_accounts(
    rows: list[dict[str, Any]],
    *,
    q: str = "",
    min_icp: float = 0.0,
    momentum_only: bool = False,
    industry: str | None = None,
    has_reminder: bool = False,
    equipment_tag: str | None = None,
) -> list[dict[str, Any]]:
    """Front-page view: exclude blocked rows and collapse duplicate companies."""
    q_low = q.strip().lower()
    ind = (industry or "").strip()
    tag = (equipment_tag or "").strip().lower()

    ranked = sorted(
        rows,
        key=lambda r: (
            -float(str(r.get("icp_enhanced_score") or r.get("icp_score") or 0) or 0),
            str(r.get("company") or ""),
        ),
    )
    seen_company_keys: set[str] = set()
    visible: list[dict[str, Any]] = []
    for item in ranked:
        if not _account_row_is_visible(item):
            continue
        company_key = normalize_company_key(str(item.get("company") or ""))
        if not company_key or company_key in seen_company_keys:
            continue
        seen_company_keys.add(company_key)

        score = float(str(item.get("icp_enhanced_score") or item.get("icp_score") or 0) or 0)
        if score < min_icp:
            continue
        if q_low and q_low not in str(item.get("company") or "").lower():
            continue
        if ind:
            aliases = _INDUSTRY_FILTER_ALIASES.get(ind, (ind,))
            if str(item.get("industry") or "").strip() not in aliases:
                continue
        if has_reminder and not int(item.get("has_reminder") or 0):
            continue
        if momentum_only and not int(item.get("fresh_signal") or 0):
            continue
        if tag and tag not in str(item.get("equipment_tags") or "").lower():
            continue
        visible.append(item)
    return visible


def _parse_dim_0_10(val: Any) -> int | None:
    """Parse sheet cell to 0–10 int; None if missing/invalid."""
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    try:
        x = float(s)
        if x != x:  # NaN
            return None
        return max(0, min(10, int(round(x))))
    except (TypeError, ValueError):
        return None


def _icp_dimensions_from_leads(_leads: list[dict[str, Any]], best: dict[str, Any]) -> dict[str, int]:
    """
    ICP breakdown: same row as the sync ``best`` lead (highest icp_enhanced_score),
    so cockpit matches ``1.xlsx`` for that contact. Missing cells filled via score_record.
    """
    keys = ("industry_fit", "signal_strength", "role_relevance", "company_fit")
    out: dict[str, int] = {}
    for k in keys:
        n = _parse_dim_0_10(best.get(k))
        if n is not None:
            out[k] = n

    scored = dict(best)
    score_record(scored)
    for k in keys:
        if k not in out:
            out[k] = max(0, min(10, int(scored.get(k) or 0)))

    return out


def _derive_source_bucket(leads: list[dict[str, Any]], best: dict[str, Any]) -> str:
    """Classify an account as 'linkedin' vs 'non_linkedin'.

    The pipeline frequently leaves ``lead_source_bucket`` blank while still
    setting ``source`` (e.g. "LinkedIn Job Postings") and a ``linkedin.com``
    ``post_url``. The dashboard's LinkedIn share counts ``lead_source_bucket
    = 'linkedin'``, so without this inference every LinkedIn-sourced lead was
    miscounted as non-LinkedIn (0% LinkedIn bug).
    """
    explicit = str(best.get("lead_source_bucket") or "").strip().lower().replace("-", "_")
    if explicit in ("linkedin", "non_linkedin"):
        return explicit
    for r in (best, *leads):
        src = str(r.get("source") or "").lower()
        url = str(r.get("post_url") or "").lower()
        if "linkedin" in src or "linkedin.com" in url:
            return "linkedin"
    return "non_linkedin"


def _init_db() -> None:
    conn = _connect()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id BIGSERIAL PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at DOUBLE PRECISION NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at DOUBLE PRECISION NOT NULL,
                created_at DOUBLE PRECISION NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

            CREATE TABLE IF NOT EXISTS accounts (
                id BIGSERIAL PRIMARY KEY,
                company TEXT NOT NULL,
                website TEXT,
                industry TEXT,
                location TEXT,
                headcount TEXT,
                icp_score DOUBLE PRECISION,
                icp_enhanced_score DOUBLE PRECISION,
                spark_brief TEXT,
                signal_category TEXT,
                signal_evidence TEXT,
                budget_band TEXT,
                equipment_tags TEXT,
                equipment_needs TEXT,
                lead_source_bucket TEXT,
                has_reminder INTEGER NOT NULL DEFAULT 0,
                fresh_signal INTEGER NOT NULL DEFAULT 0,
                swot_json TEXT NOT NULL DEFAULT '{}',
                last_sweep_at DOUBLE PRECISION NOT NULL,
                data_batch TEXT DEFAULT ''
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_unique ON accounts(company, website);
            CREATE INDEX IF NOT EXISTS idx_accounts_icp ON accounts(icp_enhanced_score, icp_score);
            CREATE INDEX IF NOT EXISTS idx_accounts_industry ON accounts(industry);

            CREATE TABLE IF NOT EXISTS contacts (
                id BIGSERIAL PRIMARY KEY,
                account_id INTEGER NOT NULL,
                person_name TEXT,
                job_title TEXT,
                email TEXT,
                phone TEXT,
                linkedin_url TEXT,
                source_kind TEXT,
                confidence DOUBLE PRECISION,
                role_rank INTEGER NOT NULL DEFAULT 0,
                raw_json TEXT,
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            );
            CREATE INDEX IF NOT EXISTS idx_contacts_account ON contacts(account_id);
            CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);

            CREATE TABLE IF NOT EXISTS evidence (
                id BIGSERIAL PRIMARY KEY,
                account_id INTEGER NOT NULL,
                label TEXT,
                source TEXT,
                url TEXT,
                snippet TEXT,
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            );
            CREATE INDEX IF NOT EXISTS idx_evidence_account ON evidence(account_id);

            CREATE TABLE IF NOT EXISTS sweeps (
                id BIGSERIAL PRIMARY KEY,
                ran_at DOUBLE PRECISION NOT NULL,
                total_accounts INTEGER NOT NULL,
                icp_passed INTEGER NOT NULL,
                avg_score DOUBLE PRECISION,
                linkedin_count INTEGER NOT NULL,
                non_linkedin_count INTEGER NOT NULL
            );
            """
        )
        # Idempotent column adds for older databases.
        conn.execute("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS equipment_needs TEXT")
        conn.execute("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS data_batch TEXT DEFAULT ''")
        conn.commit()
    finally:
        conn.close()


def _ensure_default_user() -> None:
    _init_db()
    conn = _connect()
    try:
        row = conn.execute("SELECT id FROM users WHERE lower(email)=lower(?)", (COCKPIT_ADMIN_EMAIL,)).fetchone()
        if row:
            return
        conn.execute(
            "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)",
            (COCKPIT_ADMIN_EMAIL, _hash_password(COCKPIT_ADMIN_PASSWORD), time.time()),
        )
        conn.commit()
    finally:
        conn.close()


def _xlsx_path() -> Path:
    return resolved_leads_xlsx_path()


def sync_records(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Upsert lead records (in-memory dicts) into Postgres — the dashboard's data spine.

    The pipeline calls this directly (no spreadsheet round-trip). ``sync_from_xlsx``
    is a thin wrapper that loads ``1.xlsx`` and hands the rows here.
    """
    _init_db()
    rows = [repair_lead_post_url(r) for r in rows]
    rows = filter_excluded_records(rows)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        company = str(r.get("company") or "").strip()
        if not company:
            continue
        company_key = normalize_company_key(company)
        grouped.setdefault(company_key, []).append(r)

    now = time.time()
    conn = _connect()
    try:
        conn.execute("DELETE FROM contacts")
        conn.execute("DELETE FROM evidence")
        conn.execute("DELETE FROM accounts")
        for company_key, leads in grouped.items():
            best = max(
                leads,
                key=lambda r: float(str(r.get("icp_enhanced_score") or r.get("icp_score") or 0) or 0),
            )
            company = str(best.get("company") or "").strip()
            website = str(best.get("website") or "").strip()
            if not website:
                website = next(
                    (str(x.get("website") or "").strip() for x in leads if str(x.get("website") or "").strip()),
                    "",
                )
            signal_text = str(best.get("signal_evidence") or "")
            swot = _icp_dimensions_from_leads(leads, best)
            # Prefer a real company_profile from any row in the grouped account;
            # score-based "best" row can occasionally have thinner enrichment text.
            profile_from_group = next(
                (str(x.get("company_profile") or "").strip() for x in leads if str(x.get("company_profile") or "").strip()),
                "",
            )
            equipment_from_group = next(
                (str(x.get("equipment_needs") or "").strip() for x in leads if str(x.get("equipment_needs") or "").strip()),
                str(best.get("equipment_needs") or "").strip(),
            )
            spark = profile_from_group or _fallback_spark(best, company)
            icp = float(str(best.get("icp_score") or 0) or 0)
            icp2 = float(str(best.get("icp_enhanced_score") or icp) or icp)
            fresh = 1 if any("new" in str(x.get("signal_category") or "").lower() for x in leads) else 0
            source_bucket = _derive_source_bucket(leads, best)
            # Account batch = newest run that touched it; "original" if only old leads.
            _batches = [str(x.get("data_batch") or "").strip() for x in leads]
            _dates = [b for b in _batches if b and b != "original"]
            acct_batch = max(_dates) if _dates else ("original" if any(b == "original" for b in _batches) else "")
            cur = conn.execute(
                """
                INSERT INTO accounts (
                    company, website, industry, location, headcount, icp_score, icp_enhanced_score, spark_brief,
                    signal_category, signal_evidence, budget_band, equipment_tags, equipment_needs, lead_source_bucket, has_reminder,
                    fresh_signal, swot_json, last_sweep_at, data_batch
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
                """,
                (
                    company,
                    website,
                    _cockpit_industry_bucket(best, icp2),
                    str(best.get("location") or ""),
                    str(best.get("enrollment") or ""),
                    icp,
                    icp2,
                    spark,
                    str(best.get("signal_category") or ""),
                    signal_text,
                    str(best.get("budget_band") or ""),
                    str(best.get("equipment_tags") or ""),
                    equipment_from_group,
                    source_bucket,
                    0,
                    fresh,
                    json.dumps(swot),
                    now,
                    acct_batch,
                ),
            )
            account_id = int(cur.fetchone()["id"])
            signal_url = _preferred_evidence_post_url(leads, best, website)
            seen_people: dict[str, dict[str, Any]] = {}
            for lead in sorted(leads, key=lambda r: _title_role_rank(str(r.get("job_title") or "")), reverse=True):
                email = str(lead.get("email") or "").strip()
                person = str(lead.get("person_name") or "").strip()
                lead_url = str(lead.get("post_url") or "").strip()
                is_linkedin_profile = "linkedin.com/in/" in lead_url.lower()
                # A contact is worth storing with an email OR a named person with a
                # LinkedIn profile URL (LinkedIn URL suffices).
                if not email and not (person and is_linkedin_profile):
                    continue
                # Merge rows describing the same person (crawl row + LinkedIn-x-ray row).
                pkey = person.lower() or email.lower()
                if pkey in seen_people:
                    prior = seen_people[pkey]
                    if email and not prior["email"]:
                        prior["email"] = email
                        prior["status"] = str(lead.get("email_verification_status") or "")
                    if is_linkedin_profile and "linkedin.com/in/" not in prior["linkedin_url"].lower():
                        prior["linkedin_url"] = lead_url
                    continue
                status = str(lead.get("email_verification_status") or "").lower()
                if email and status in ("deliverable", "site_published"):
                    source_kind, conf = ("Website" if status == "site_published" else "Hunter"), (
                        0.85 if status == "site_published" else 0.9
                    )
                elif email and status == "pattern_guess":
                    source_kind, conf = "Pattern", 0.55
                elif email and status:
                    source_kind, conf = "Hunter", 0.6
                elif email:
                    source_kind, conf = "Website", 0.8
                elif is_linkedin_profile:
                    source_kind, conf = "LinkedIn", 0.7
                else:
                    source_kind, conf = "LinkedIn", 0.6
                linkedin_url = lead_url if is_linkedin_profile else (
                    pick_signal_url_for_account([lead], lead, website) or signal_url
                )
                seen_people[pkey] = {
                    "person": person, "job_title": str(lead.get("job_title") or ""),
                    "email": email, "linkedin_url": linkedin_url,
                    "source_kind": source_kind, "conf": conf, "status": status, "lead": lead,
                }

            for _pkey, c in seen_people.items():
                lead = c["lead"]
                person, email = c["person"], c["email"]
                source_kind, conf, linkedin_url = c["source_kind"], c["conf"], c["linkedin_url"]
                conn.execute(
                    """
                    INSERT INTO contacts (
                        account_id, person_name, job_title, email, phone, linkedin_url,
                        source_kind, confidence, role_rank, raw_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        account_id,
                        person,
                        str(lead.get("job_title") or ""),
                        email,
                        "",
                        linkedin_url,
                        source_kind,
                        conf,
                        _title_role_rank(str(lead.get("job_title") or "")),
                        json.dumps(lead, default=str),
                    ),
                )
            conn.execute(
                "INSERT INTO evidence (account_id, label, source, url, snippet) VALUES (?, ?, ?, ?, ?)",
                (
                    account_id,
                    str(best.get("signal_category") or "signal"),
                    str(best.get("source") or ""),
                    signal_url,
                    signal_text[:800],
                ),
            )

        total = len(grouped)
        icp_pass = conn.execute("SELECT COUNT(*) c FROM accounts WHERE COALESCE(icp_enhanced_score, icp_score) >= 5").fetchone()[
            "c"
        ]
        avg = conn.execute("SELECT AVG(COALESCE(icp_enhanced_score, icp_score)) a FROM accounts").fetchone()["a"]
        linkedin = conn.execute(
            "SELECT COUNT(*) c FROM accounts WHERE lower(COALESCE(lead_source_bucket,''))='linkedin'"
        ).fetchone()["c"]
        non_linkedin = max(0, int(total) - int(linkedin))
        conn.execute(
            "INSERT INTO sweeps (ran_at, total_accounts, icp_passed, avg_score, linkedin_count, non_linkedin_count) VALUES (?, ?, ?, ?, ?, ?)",
            (now, total, int(icp_pass), float(avg or 0), int(linkedin), non_linkedin),
        )
        conn.commit()
        return {"ok": True, "accounts": total}
    finally:
        conn.close()


def merge_records(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Additively merge scraped rows into Postgres — the scheduler's sync path.

    Unlike ``sync_records`` (full destructive rebuild for explicit re-syncs),
    this NEVER deletes: existing accounts keep their ids, contacts, and email
    sequences (fields refresh in place); unseen companies are inserted with
    today's ``data_batch``. Returns {"ok", "added", "updated", "total"}.
    """
    _init_db()
    rows = [repair_lead_post_url(r) for r in rows]
    rows = filter_excluded_records(rows)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        company = str(r.get("company") or "").strip()
        if not company:
            continue
        grouped.setdefault(normalize_company_key(company), []).append(r)

    now = time.time()
    added = updated = 0
    conn = _connect()
    try:
        existing: dict[str, int] = {}
        for row in conn.execute("SELECT id, company FROM accounts").fetchall():
            existing[normalize_company_key(str(row["company"] or ""))] = int(row["id"])

        for company_key, leads in grouped.items():
            best = max(
                leads,
                key=lambda r: float(str(r.get("icp_enhanced_score") or r.get("icp_score") or 0) or 0),
            )
            company = str(best.get("company") or "").strip()
            website = str(best.get("website") or "").strip() or next(
                (str(x.get("website") or "").strip() for x in leads if str(x.get("website") or "").strip()), ""
            )
            signal_text = str(best.get("signal_evidence") or "")
            swot = _icp_dimensions_from_leads(leads, best)
            profile_from_group = next(
                (str(x.get("company_profile") or "").strip() for x in leads if str(x.get("company_profile") or "").strip()), ""
            )
            equipment_from_group = next(
                (str(x.get("equipment_needs") or "").strip() for x in leads if str(x.get("equipment_needs") or "").strip()),
                str(best.get("equipment_needs") or "").strip(),
            )
            icp = float(str(best.get("icp_score") or 0) or 0)
            icp2 = float(str(best.get("icp_enhanced_score") or icp) or icp)

            if company_key in existing:
                # Refresh signal/score fields in place; keep id/contacts/sequences.
                conn.execute(
                    """
                    UPDATE accounts SET
                        icp_score = ?, icp_enhanced_score = ?,
                        signal_category = COALESCE(NULLIF(?, ''), signal_category),
                        signal_evidence = COALESCE(NULLIF(?, ''), signal_evidence),
                        equipment_needs = COALESCE(NULLIF(?, ''), equipment_needs),
                        spark_brief = COALESCE(NULLIF(?, ''), spark_brief),
                        website = COALESCE(NULLIF(?, ''), website),
                        swot_json = ?, last_sweep_at = ?
                    WHERE id = ?
                    """,
                    (
                        icp, icp2,
                        str(best.get("signal_category") or ""),
                        signal_text,
                        equipment_from_group,
                        profile_from_group,
                        website,
                        json.dumps(swot), now,
                        existing[company_key],
                    ),
                )
                updated += 1
                continue

            spark = profile_from_group or _fallback_spark(best, company)
            fresh = 1 if any("new" in str(x.get("signal_category") or "").lower() for x in leads) else 0
            cur = conn.execute(
                """
                INSERT INTO accounts (
                    company, website, industry, location, headcount, icp_score, icp_enhanced_score, spark_brief,
                    signal_category, signal_evidence, budget_band, equipment_tags, equipment_needs, lead_source_bucket, has_reminder,
                    fresh_signal, swot_json, last_sweep_at, data_batch
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
                """,
                (
                    company, website, _cockpit_industry_bucket(best, icp2),
                    str(best.get("location") or ""), str(best.get("enrollment") or ""),
                    icp, icp2, spark,
                    str(best.get("signal_category") or ""), signal_text,
                    str(best.get("budget_band") or ""), str(best.get("equipment_tags") or ""),
                    equipment_from_group, _derive_source_bucket(leads, best), 0, fresh,
                    json.dumps(swot), now, today_batch_label(),
                ),
            )
            account_id = int(cur.fetchone()["id"])
            added += 1
            signal_url = _preferred_evidence_post_url(leads, best, website)
            for lead in sorted(leads, key=lambda r: _title_role_rank(str(r.get("job_title") or "")), reverse=True):
                email = str(lead.get("email") or "").strip()
                person = str(lead.get("person_name") or "").strip()
                lead_url = str(lead.get("post_url") or "").strip()
                is_li = "linkedin.com/in/" in lead_url.lower()
                if not email and not (person and is_li):
                    continue
                source_kind, conf = _contact_kind_conf(
                    email, str(lead.get("email_verification_status") or ""), is_li
                )
                conn.execute(
                    """
                    INSERT INTO contacts (
                        account_id, person_name, job_title, email, phone, linkedin_url,
                        source_kind, confidence, role_rank, raw_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        account_id, person, str(lead.get("job_title") or ""), email, "",
                        lead_url if is_li else "", source_kind, conf,
                        _title_role_rank(str(lead.get("job_title") or "")),
                        json.dumps(lead, default=str),
                    ),
                )
            conn.execute(
                "INSERT INTO evidence (account_id, label, source, url, snippet) VALUES (?, ?, ?, ?, ?)",
                (account_id, str(best.get("signal_category") or "signal"),
                 str(best.get("source") or ""), signal_url, signal_text[:800]),
            )

        total = int(conn.execute("SELECT COUNT(*) c FROM accounts").fetchone()["c"])
        icp_pass = conn.execute(
            "SELECT COUNT(*) c FROM accounts WHERE COALESCE(icp_enhanced_score, icp_score) >= 5"
        ).fetchone()["c"]
        avg = conn.execute("SELECT AVG(COALESCE(icp_enhanced_score, icp_score)) a FROM accounts").fetchone()["a"]
        linkedin = conn.execute(
            "SELECT COUNT(*) c FROM accounts WHERE lower(COALESCE(lead_source_bucket,''))='linkedin'"
        ).fetchone()["c"]
        conn.execute(
            "INSERT INTO sweeps (ran_at, total_accounts, icp_passed, avg_score, linkedin_count, non_linkedin_count) VALUES (?, ?, ?, ?, ?, ?)",
            (now, total, int(icp_pass), float(avg or 0), int(linkedin), max(0, total - int(linkedin))),
        )
        conn.commit()
        return {"ok": True, "added": added, "updated": updated, "total": total}
    finally:
        conn.close()


def set_account_org_contact(account_id: int, phone: str = "", email: str = "") -> None:
    """Fill one account's switchboard phone / general mailbox, in place.

    Org-level reach data (``pipeline.org_contact``), distinct from the per-person rows in
    ``contacts``. Each field is written only when currently empty, so a re-run never
    clobbers a value a human corrected. Touches only this account; never ``sync_records``.
    """
    conn = _connect()
    try:
        if phone.strip():
            conn.execute(
                "UPDATE accounts SET phone = ? WHERE id = ? AND COALESCE(phone, '') = ''",
                (phone.strip(), account_id),
            )
        if email.strip():
            conn.execute(
                "UPDATE accounts SET email = ? WHERE id = ? AND COALESCE(email, '') = ''",
                (email.strip().lower(), account_id),
            )
        conn.commit()
    finally:
        conn.close()


def set_account_linkedin(account_id: int, url: str, kind: str = "own") -> None:
    """Attach the org's LinkedIn company page, in place. ``kind`` is 'own' or 'district'.
    Written only when empty. Touches only this account; never ``sync_records``."""
    if not url.strip():
        return
    conn = _connect()
    try:
        conn.execute(
            "UPDATE accounts SET linkedin_url = ?, linkedin_kind = ? "
            "WHERE id = ? AND COALESCE(linkedin_url, '') = ''",
            (url.strip(), (kind or "own").strip(), account_id),
        )
        conn.commit()
    finally:
        conn.close()


def _contact_kind_conf(email: str, status: str, is_linkedin_profile: bool) -> tuple[str, float]:
    """Map an email + verification status (or a LinkedIn-only contact) to (source_kind, confidence).
    Mirrors the inline logic in ``sync_records`` so the two write paths never diverge."""
    status = (status or "").lower()
    if email and status in ("deliverable", "site_published"):
        return ("Website", 0.85) if status == "site_published" else ("Hunter", 0.9)
    if email and status in ("pattern_guess", "pattern_inferred"):
        return ("Pattern", 0.55)
    if email and status:
        return ("Hunter", 0.6)
    if email:
        return ("Website", 0.8)
    if is_linkedin_profile:
        return ("LinkedIn", 0.7)
    return ("LinkedIn", 0.6)


def enrich_account_contacts(
    account_id: int,
    contacts: list[dict[str, Any]],
    linkedin_url: str = "",
    discovered_website: str = "",
) -> dict[str, Any]:
    """Attach contacts to ONE existing account, in place — never ``sync_records``.

    Fills a missing website, then rewrites only this account's ``contacts`` rows
    (idempotent re-run). Contacts use the ``sources`` shape ``{name,title,email,
    email_status,phone,linkedin_url}``. A per-contact ``linkedin_url`` wins; the
    account-level x-ray URL attaches to the best-ranked contact only.
    """
    conn = _connect()
    try:
        site = (discovered_website or "").strip()
        if site:
            conn.execute(
                "UPDATE accounts SET website = ? WHERE id = ? AND COALESCE(website, '') = ''",
                (site, account_id),
            )
        conn.execute("DELETE FROM contacts WHERE account_id = ?", (account_id,))
        ordered = sorted(
            (c for c in contacts if str(c.get("name") or "").strip()),
            key=lambda c: _title_role_rank(str(c.get("title") or "")),
            reverse=True,
        )
        li = (linkedin_url or "").strip()
        li_is_profile = "linkedin.com/in/" in li.lower()
        inserted = 0
        seen: set[str] = set()
        for idx, c in enumerate(ordered):
            name = str(c.get("name") or "").strip()
            pkey = name.lower()
            if pkey in seen:
                continue
            seen.add(pkey)
            title = str(c.get("title") or "").strip()
            email = str(c.get("email") or "").strip()
            status = str(c.get("email_status") or ("site_published" if email else "")).lower()
            contact_li = str(c.get("linkedin_url") or "").strip()
            if not contact_li and idx == 0 and li_is_profile:
                contact_li = li
            source_kind, conf = _contact_kind_conf(email, status, bool(contact_li))
            conn.execute(
                """
                INSERT INTO contacts (
                    account_id, person_name, job_title, email, phone, linkedin_url,
                    source_kind, confidence, role_rank, raw_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    account_id,
                    name,
                    title,
                    email,
                    str(c.get("phone") or "").strip(),
                    contact_li,
                    source_kind,
                    conf,
                    _title_role_rank(title),
                    json.dumps(c, default=str),
                ),
            )
            inserted += 1
        conn.commit()
        return {"account_id": account_id, "contacts": inserted}
    finally:
        conn.close()


def sync_from_xlsx() -> dict[str, Any]:
    """Load ``1.xlsx`` and sync into Postgres (export-file path; pipeline uses sync_records)."""
    res = sync_records(load_leads_from_xlsx(_xlsx_path()))
    res["xlsx_path"] = str(_xlsx_path())
    return res


class LoginInput(BaseModel):
    email: str
    password: str


def _auth_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.replace("Bearer ", "", 1).strip()
    conn = _connect()
    try:
        row = conn.execute(
            """
            SELECT u.id, u.email, s.expires_at
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token=?
            """,
            (token,),
        ).fetchone()
        if not row or float(row["expires_at"]) < time.time():
            raise HTTPException(status_code=401, detail="Session expired")
        return {"id": int(row["id"]), "email": str(row["email"])}
    finally:
        conn.close()


# Branded: this title is what /docs and the OpenAPI schema announce themselves as.
app = FastAPI(title=f"{brand.name()} Cockpit API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(COCKPIT_ALLOWED_ORIGINS),
    allow_origin_regex=COCKPIT_CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    # Cannot use ["*"] with allow_credentials=True for allow_headers in all browsers; list explicitly.
    allow_headers=["Authorization", "Content-Type", "Accept", "ngrok-skip-browser-warning"],
)

# Public static assets (email template images). Served from the API's TLS domain
# so branded emails can reference absolute HTTPS image URLs.
_static_dir = Path(__file__).resolve().parent / "static"
if _static_dir.is_dir():
    from fastapi.staticfiles import StaticFiles

    app.mount("/static", StaticFiles(directory=str(_static_dir)), name="static")


@app.on_event("startup")
def _startup() -> None:
    print(f"Cockpit: CORS allow_origins={COCKPIT_ALLOWED_ORIGINS}", flush=True)
    if COCKPIT_CORS_ORIGIN_REGEX:
        print(f"Cockpit: CORS allow_origin_regex={COCKPIT_CORS_ORIGIN_REGEX!r}", flush=True)
    if all("127.0.0.1" in o or "localhost" in o for o in COCKPIT_ALLOWED_ORIGINS) and not COCKPIT_CORS_ORIGIN_REGEX:
        print(
            "Cockpit: CORS is localhost-only — browser preflight from Vercel returns 400. "
            "Set COCKPIT_UI_ORIGIN to include your frontend URL(s), comma-separated.",
            flush=True,
        )
    _ensure_default_user()
    # Postgres is the durable store — only auto-load from the export file on a FRESH
    # DB (empty accounts). On a normal restart the data is already in Postgres, so we
    # skip the sync and boot instantly (no multi-minute block on large datasets).
    try:
        _init_db()
        conn = _connect()
        try:
            have = int(conn.execute("SELECT COUNT(*) c FROM accounts").fetchone()["c"])
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001
        have = 0
        print(f"Cockpit: account-count probe failed: {e}", flush=True)
    xp = _xlsx_path()
    if have == 0 and xp.is_file():
        try:
            n = sync_from_xlsx().get("accounts", 0)
            print(f"Cockpit: fresh DB — loaded {n} accounts from {xp}", flush=True)
        except OSError as e:
            print(f"Cockpit: startup sync skipped ({xp}): {e}", flush=True)
    else:
        print(f"Cockpit: {have} accounts already in Postgres — startup sync skipped.", flush=True)
    # Email outreach: ensure tables exist + start the follow-up scheduler so
    # scheduled steps go out without an external cron.
    try:
        from outreach import email_store, email_runner

        email_store.init_db()
        email_runner.ensure_scheduler(interval_sec=300)
        print("Cockpit: email follow-up scheduler started (every 5 min).", flush=True)

        # Inbox triage, unattended, beside the follow-up scheduler. An
        # out-of-office defers its own follow-ups and a real reply stops them,
        # without anyone having to read the mailbox first.
        from outreach import inbox_agent

        inbox_agent.ensure_scheduler(interval_sec=600)
        print("Cockpit: inbox agent started (every 10 min).", flush=True)

        # Turn outcomes into knowledge. Hourly: the counts move slowly, and
        # anything faster just restates the same conclusion.
        from outreach import agent_learn

        agent_learn.ensure_scheduler(interval_sec=3600)
        print("Cockpit: learning loop started (hourly).", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"Cockpit: email scheduler not started: {e}", flush=True)
    # Outreach module: inbox table + seed the Mailu inboxes.
    try:
        from outreach import outreach_store, campaign_runner

        outreach_store.init_db()
        n = campaign_runner.seed_default_inboxes()
        print(f"Cockpit: outreach module ready ({n} inboxes seeded).", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"Cockpit: outreach module init failed: {e}", flush=True)
    # Inbound lead capture from the marketing site.
    try:
        from outreach import sample_leads

        sample_leads.init_db()
        print("Cockpit: sample-lead capture ready.", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"Cockpit: sample-lead init failed: {e}", flush=True)
    # Scrape scheduler: dashboard-controlled auto-scrape + auto-enrich.
    # Ships disabled — runs only after the client flips it on in the UI.
    try:
        from outreach import scrape_runner

        scrape_runner.ensure_scheduler(interval_sec=60)
        print("Cockpit: scrape scheduler started (off until enabled in Settings).", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"Cockpit: scrape scheduler not started: {e}", flush=True)
    # Project-management kanban tables.
    try:
        from outreach import pm_store

        pm_store.init_db()
        print("Cockpit: project-management module ready.", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"Cockpit: project-management init failed: {e}", flush=True)


@app.get("/api/health")
def health() -> dict[str, Any]:
    """Unauthenticated liveness probe. Frontend polls this to show a service-down
    banner. Cheap on purpose: no DB work, just confirms the process serves HTTP."""
    return {"ok": True, "service": "cockpit-api", "ts": time.time()}


# ---------------------------------------------------------------------------
# Email open/click tracking (PUBLIC — recipients' mail apps/browsers hit these).
# Served at https://<sending-domain>/t/... via the nginx /t/ proxy. No auth.
# ---------------------------------------------------------------------------
# 1x1 transparent GIF.
_TRACK_PIXEL = bytes.fromhex(
    "47494638396101000100800000000000ffffff21f90401000000002c000000000100010000020144003b"
)
_TRACK_NOSTORE = {"Cache-Control": "no-store, no-cache, must-revalidate, private", "Pragma": "no-cache"}


@app.get("/t/o/{token}")
def track_open(token: str, request: Request) -> Response:
    """Open pixel: recording is best-effort and must never block returning the gif."""
    try:
        from outreach import email_store

        email_store.record_open(
            token,
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
    except Exception:  # noqa: BLE001
        pass
    return Response(content=_TRACK_PIXEL, media_type="image/gif", headers=_TRACK_NOSTORE)


@app.get("/t/c/{token}")
def track_click(token: str, request: Request, u: str = Query(default="")) -> Response:
    """Click redirect: log the click, then 302 to the real destination."""
    from urllib.parse import unquote

    dest = unquote(u or "")
    if not dest.startswith(("http://", "https://")):
        from outreach import brand

        dest = brand.site_url()
    try:
        from outreach import email_store

        email_store.record_click(
            token, dest,
            ip=(request.client.host if request.client else ""),
            ua=request.headers.get("user-agent", ""),
        )
    except Exception:  # noqa: BLE001
        pass
    return RedirectResponse(url=dest, status_code=302, headers=_TRACK_NOSTORE)


@app.post("/api/auth/login")
def login(body: LoginInput) -> dict[str, Any]:
    conn = _connect()
    try:
        row = conn.execute("SELECT id, email, password_hash FROM users WHERE lower(email)=lower(?)", (body.email,)).fetchone()
        if not row or row["password_hash"] != _hash_password(body.password):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        token = secrets.token_urlsafe(40)
        exp = time.time() + (COCKPIT_SESSION_DAYS * 24 * 3600)
        conn.execute(
            "INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (token, int(row["id"]), exp, time.time()),
        )
        conn.commit()
        return {"token": token, "expires_at": exp, "email": str(row["email"])}
    finally:
        conn.close()


@app.get("/api/auth/me")
def me(user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    return {"email": user["email"]}


@app.post("/api/sync")
def sync(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    return sync_from_xlsx()


def _avg_swot_pass_for(conn: db._Conn, where_sql: str, args: tuple[Any, ...]) -> float:
    """Mean of the 4 ICP factors across on-ICP accounts matching ``where_sql``.
    ``where_sql='1=1', args=()`` gives the global value."""
    rows = conn.execute(
        f"SELECT swot_json FROM accounts WHERE {where_sql} AND COALESCE(icp_enhanced_score, icp_score) >= 5",
        args,
    ).fetchall()
    keys4 = ("industry_fit", "signal_strength", "role_relevance", "company_fit")
    means: list[float] = []
    for r in rows:
        try:
            d = json.loads(str(r["swot_json"] or "{}"))
        except json.JSONDecodeError:
            continue
        if not isinstance(d, dict):
            continue
        nums: list[float] = []
        for k in keys4:
            x = d.get(k)
            if isinstance(x, (int, float)) and x == x:
                nums.append(float(x))
            elif isinstance(x, str) and str(x).strip():
                try:
                    nums.append(float(str(x).strip()))
                except ValueError:
                    pass
        if nums:
            means.append(sum(nums) / len(nums))
    return round(sum(means) / len(means), 2) if means else 0.0


def _top_incumbent_for(conn: db._Conn, where_sql: str, args: tuple[Any, ...]) -> tuple[str, str, int]:
    """Most-common equipment tag (label, key, account count) over accounts
    matching ``where_sql``. ``where_sql='1=1', args=()`` gives the global value."""
    from collections import Counter

    tag_counter: Counter[str] = Counter()
    for row in conn.execute(f"SELECT equipment_tags FROM accounts WHERE {where_sql}", args):
        raw = str(row["equipment_tags"] or "").strip()
        if not raw:
            continue
        seen_line: set[str] = set()
        for part in raw.replace(";", ",").split(","):
            w = part.strip().lower()
            if len(w) < 2 or w in seen_line:
                continue
            seen_line.add(w)
            tag_counter[w] += 1
    if not tag_counter:
        return ("—", "", 0)
    top_key, _freq = tag_counter.most_common(1)[0]
    top_word = top_key.upper() if top_key.isalpha() and len(top_key) <= 6 else (top_key[:1].upper() + top_key[1:])
    cnt = int(
        conn.execute(
            f"SELECT COUNT(*) c FROM accounts WHERE {where_sql} AND strpos(lower(COALESCE(equipment_tags,'')), ?) > 0",
            (*args, top_key.lower()),
        ).fetchone()["c"]
    )
    return (top_word, str(top_key).lower(), cnt)


@app.get("/api/summary")
def summary(
    _user: dict[str, Any] = Depends(_auth_user),
    q: str = Query(default=""),
    industry: str = Query(default=""),
    min_icp: float = Query(default=0.0),
    contact_filter: str = Query(default="any"),
    momentum_only: bool = Query(default=False),
    equipment_tag: str = Query(default=""),
) -> dict[str, Any]:
    conn = _connect()
    try:
        all_accounts = [dict(r) for r in conn.execute("SELECT * FROM accounts").fetchall()]
        visible_all = _visible_deduped_accounts(all_accounts)
        total = len(visible_all)
        visible_ids = {int(a["id"]) for a in visible_all if a.get("id") is not None}
        if visible_ids:
            placeholders = ",".join("?" for _ in visible_ids)
            total_contacts = int(
                conn.execute(
                    f"SELECT COUNT(*) c FROM contacts WHERE account_id IN ({placeholders})",
                    tuple(visible_ids),
                ).fetchone()["c"]
            )
        else:
            total_contacts = 0
        icp_passed = sum(
            1
            for a in visible_all
            if float(str(a.get("icp_enhanced_score") or a.get("icp_score") or 0) or 0) >= 5
        )
        off_icp = max(0, total - icp_passed)
        icp_pass_pct = round(100.0 * icp_passed / total, 1) if total else 0.0

        scores = [
            float(str(a.get("icp_enhanced_score") or a.get("icp_score") or 0) or 0) for a in visible_all
        ]
        avg = sum(scores) / len(scores) if scores else 0.0

        avg_swot_pass = _avg_swot_pass_for(conn, "1=1", ())

        from collections import Counter

        tag_counter: Counter[str] = Counter()
        for a in visible_all:
            raw = str(a.get("equipment_tags") or "").strip()
            if not raw:
                continue
            seen_line: set[str] = set()
            for part in raw.replace(";", ",").split(","):
                w = part.strip().lower()
                if len(w) < 2 or w in seen_line:
                    continue
                seen_line.add(w)
                tag_counter[w] += 1
        if tag_counter:
            top_key, _freq = tag_counter.most_common(1)[0]
            top_word = top_key.upper() if top_key.isalpha() and len(top_key) <= 6 else (top_key[:1].upper() + top_key[1:])
            top_n = sum(1 for a in visible_all if top_key in str(a.get("equipment_tags") or "").lower())
            top_incumbent_key = str(top_key).lower()
        else:
            top_word, top_incumbent_key, top_n = ("—", "", 0)

        mix_counter: Counter[str] = Counter()
        for a in visible_all:
            mix_counter[str(a.get("industry") or "Other")] += 1
        industry_mix = [{"industry": ind, "count": int(c)} for ind, c in mix_counter.most_common()]

        facet_visible = _visible_deduped_accounts(
            all_accounts,
            q=q,
            min_icp=min_icp,
            momentum_only=momentum_only,
            industry=industry if industry.strip() else None,
            equipment_tag=equipment_tag if equipment_tag.strip() else None,
        )
        facet_total_accounts = len(facet_visible)
        facet_icp_passed = sum(
            1
            for a in facet_visible
            if float(str(a.get("icp_enhanced_score") or a.get("icp_score") or 0) or 0) >= 5
        )
        facet_off_icp = max(0, facet_total_accounts - facet_icp_passed)
        facet_icp_pass_pct = round(100.0 * facet_icp_passed / facet_total_accounts, 1) if facet_total_accounts else 0.0
        facet_scores = [
            float(str(a.get("icp_enhanced_score") or a.get("icp_score") or 0) or 0) for a in facet_visible
        ]
        facet_avg_score = round(sum(facet_scores) / len(facet_scores), 2) if facet_scores else 0.0
        facet_avg_swot_pass = _avg_swot_pass_for(conn, "1=1", ())

        facet_where, facet_args = _account_table_where_clauses(
            q=q,
            min_icp=min_icp,
            contact_filter=contact_filter,
            momentum_only=momentum_only,
            industry=industry if industry.strip() else None,
            equipment_tag=equipment_tag if equipment_tag.strip() else None,
        )
        facet_sql = " AND ".join(facet_where)
        facet_targs = tuple(facet_args)
        facet_top_word, facet_top_key, facet_top_n = _top_incumbent_for(conn, facet_sql, facet_targs)

        facet_mix_counter: Counter[str] = Counter()
        for a in facet_visible:
            facet_mix_counter[str(a.get("industry") or "Other")] += 1
        facet_industry_mix = [{"industry": ind, "count": int(c)} for ind, c in facet_mix_counter.most_common()]

        chip_visible = _visible_deduped_accounts(
            all_accounts,
            q=q,
            min_icp=min_icp,
            momentum_only=momentum_only,
            equipment_tag=equipment_tag if equipment_tag.strip() else None,
        )
        chip_total_accounts = len(chip_visible)
        chip_mix_counter: Counter[str] = Counter()
        for a in chip_visible:
            chip_mix_counter[str(a.get("industry") or "Other")] += 1
        chip_industry_mix = [{"industry": ind, "count": int(c)} for ind, c in chip_mix_counter.most_common()]

        sweep = conn.execute(
            "SELECT ran_at FROM sweeps ORDER BY id DESC LIMIT 1"
        ).fetchone()
        # Accounts where enrichment found ≥1 contact with a LinkedIn
        # profile. (lead_source_bucket is a legacy field from the old fork and stays blank.)
        li_ids = {
            int(r["account_id"])
            for r in conn.execute(
                "SELECT DISTINCT account_id FROM contacts WHERE trim(COALESCE(linkedin_url, '')) <> ''"
            ).fetchall()
        }
        li = sum(1 for a in visible_all if a.get("id") is not None and int(a["id"]) in li_ids)
        nl = max(0, len(visible_all) - li)
        denom = li + nl
        linkedin_pct = round(100.0 * li / denom, 1) if denom else 0.0

        with_company = sum(1 for a in visible_all if str(a.get("company") or "").strip())
        with_website = sum(1 for a in visible_all if str(a.get("website") or "").strip())
        reminders = sum(1 for a in visible_all if int(a.get("has_reminder") or 0))

        newest_vals = [float(a.get("last_sweep_at") or 0) for a in visible_all if a.get("last_sweep_at")]
        newest = max(newest_vals) if newest_vals else None

        pipeline_state = "idle"
        try:
            from utils.pipeline_run_state import clear_stale_lock, read_lock

            clear_stale_lock()
            if read_lock():
                pipeline_state = "running"
        except Exception:
            pass

        return {
            "total_accounts": total,
            "total_contacts": total_contacts,
            "icp_passed": icp_passed,
            "off_icp_count": off_icp,
            "icp_pass_pct": icp_pass_pct,
            "avg_score": round(avg, 2),
            "avg_swot_pass": avg_swot_pass,
            "top_incumbent": top_word or "—",
            "top_incumbent_key": top_incumbent_key,
            "top_incumbent_accounts": int(top_n),
            "industry_mix": industry_mix,
            "facet_total_accounts": facet_total_accounts,
            "facet_industry_mix": facet_industry_mix,
            "chip_total_accounts": chip_total_accounts,
            "chip_industry_mix": chip_industry_mix,
            "facet_icp_passed": facet_icp_passed,
            "facet_off_icp_count": facet_off_icp,
            "facet_icp_pass_pct": facet_icp_pass_pct,
            "facet_avg_score": facet_avg_score,
            "facet_avg_swot_pass": facet_avg_swot_pass,
            "facet_top_incumbent": facet_top_word or "—",
            "facet_top_incumbent_key": facet_top_key,
            "facet_top_incumbent_accounts": int(facet_top_n),
            "source_mix": {"linkedin": li, "non_linkedin": nl},
            "linkedin_pct": linkedin_pct,
            "last_sweep_at": float(sweep["ran_at"]) if sweep else None,
            "with_company": with_company,
            "with_website": with_website,
            "reminders_pending": reminders,
            "newest_lead_at": newest,
            "pipeline_state": pipeline_state,
            "leads_last_15m": 0,
            "leads_last_1h": 0,
        }
    finally:
        conn.close()


@app.get("/api/pipeline/status")
def pipeline_status(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Live pipeline activity for the dashboard: run state, recent events, credit alerts.

    The pipeline CLIs write structured events via ``utils.pipeline_events``; the React
    dashboard polls this every few seconds to show a live feed + out-of-credit banner."""
    from utils import pipeline_events

    running = False
    cmd: str | None = None
    started_at: float | None = None
    try:
        from utils.pipeline_run_state import clear_stale_lock, read_lock

        clear_stale_lock()
        lock = read_lock()
        if lock:
            running = True
            cmd = lock.get("cmd")
            try:
                started_at = float(lock.get("started_at_unix") or 0) or None
            except (TypeError, ValueError):
                started_at = None
    except Exception:
        pass

    evs = pipeline_events.read_recent(80)
    stage = evs[-1].get("stage") if evs else None
    cutoff = time.time() - 6 * 3600  # only surface recent credit problems
    credit = [
        e for e in evs
        if e.get("level") == "credit" and float(e.get("ts") or 0) >= cutoff
    ]
    schedule: dict[str, Any] = {}
    try:
        from outreach import scrape_runner

        schedule = scrape_runner.schedule_summary()
    except Exception:  # noqa: BLE001
        pass

    # What the scraper has actually produced. "Is it running" is answered by the
    # lock and the event feed; "is it WORKING" is only answered by counting the
    # rows that landed, which nothing exposed. accounts.data_batch is stamped
    # with the run date, so today's yield is one group-by — and its absence is
    # how a scraper that had never once run looked the same as a healthy one.
    yield_stats: dict[str, Any] = {}
    try:
        from outreach import db as _db

        c = _db.connect()
        try:
            rows = c.execute(
                """
                SELECT COALESCE(NULLIF(data_batch, ''), 'original') AS batch,
                       COUNT(*) AS n
                FROM accounts GROUP BY 1 ORDER BY 1 DESC LIMIT 8
                """
            ).fetchall()
            batches = [{"batch": r["batch"], "count": int(r["n"])} for r in rows]
            today = datetime.now().strftime("%Y-%m-%d")
            yield_stats = {
                "today": next((b["count"] for b in batches if b["batch"] == today), 0),
                "total": int(
                    c.execute("SELECT COUNT(*) AS n FROM accounts").fetchone()["n"] or 0
                ),
                "contacts": int(
                    c.execute(
                        "SELECT COUNT(*) AS n FROM contacts WHERE email LIKE '%@%'"
                    ).fetchone()["n"]
                    or 0
                ),
                "recent_batches": batches,
            }
        finally:
            c.close()
    except Exception:  # noqa: BLE001 — the feed must render even if this fails
        yield_stats = {}
    return {
        "running": running,
        "cmd": cmd,
        "started_at": started_at,
        "stage": stage,
        "yield": yield_stats,
        "events": evs,
        "credit_alerts": list(reversed(credit))[:5],
        "schedule": schedule,
    }


@app.get("/api/accounts")
def list_accounts(
    _user: dict[str, Any] = Depends(_auth_user),
    q: str = Query(default=""),
    industry: str = Query(default=""),
    min_icp: float = Query(default=0.0),
    contact_filter: str = Query(default="any"),
    has_reminder: bool = Query(default=False),
    momentum_only: bool = Query(default=False),
    equipment_tag: str = Query(default=""),
    data_batch: str = Query(default="all"),
    mode: str = Query(default="accounts"),
    sort: str = Query(default="icp"),
) -> dict[str, Any]:
    conn = _connect()
    try:
        where, args = _account_table_where_clauses(
            q=q,
            min_icp=min_icp,
            contact_filter=contact_filter,
            momentum_only=momentum_only,
            industry=industry if industry.strip() else None,
            has_reminder=has_reminder,
            equipment_tag=equipment_tag if equipment_tag.strip() else None,
            data_batch=data_batch,
        )
        order = "COALESCE(icp_enhanced_score, icp_score) DESC, icp_score DESC, company ASC" if sort == "icp" else "fresh_signal DESC, last_sweep_at DESC"
        rows = conn.execute(
            f"""
            SELECT id, company, website, industry, location, headcount, COALESCE(icp_enhanced_score, icp_score) as score,
                   signal_category, signal_evidence,
                   COALESCE(NULLIF(trim(equipment_needs), ''), '') AS equipment_needs,
                   COALESCE(NULLIF(trim(spark_brief), ''), NULLIF(trim(signal_evidence), ''), '') AS company_profile,
                   lead_source_bucket, fresh_signal,
                   swot_json,
                   COALESCE(data_batch, '') AS data_batch,
                   (SELECT COUNT(*) FROM contacts c WHERE c.account_id = accounts.id) AS contacts_count,
                   (SELECT COUNT(*) FROM contacts c WHERE c.account_id = accounts.id AND trim(COALESCE(c.email,'')) <> '') AS emails_count,
                   (SELECT e.url FROM evidence e WHERE e.account_id = accounts.id AND trim(COALESCE(e.url, '')) != ''
                    ORDER BY e.id DESC LIMIT 1) AS signal_url
            FROM accounts
            WHERE {' AND '.join(where)}
            ORDER BY {order}
            """,
            tuple(args),
        ).fetchall()
        seen_company_keys: set[str] = set()
        items: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            if not _account_row_is_visible(item):
                continue
            company_key = normalize_company_key(str(item.get("company") or ""))
            if company_key in seen_company_keys:
                continue
            seen_company_keys.add(company_key)
            items.append(item)
        if mode == "people":
            where_sql = " AND ".join(where)
            people_sql_where = (
                where_sql.replace("accounts.id", "a.id")
                .replace(
                    "lower(trim(COALESCE(company, '')))",
                    "lower(trim(COALESCE(a.company, '')))",
                )
                .replace("industry = ?", "a.industry = ?")
                .replace(
                    "COALESCE(icp_enhanced_score, icp_score)",
                    "COALESCE(a.icp_enhanced_score, a.icp_score)",
                )
                .replace("has_reminder = 1", "a.has_reminder = 1")
                .replace("strpos(lower(COALESCE(equipment_tags, '')), ?)", "strpos(lower(COALESCE(a.equipment_tags, '')), ?)")
            )
            people = conn.execute(
                f"""
                SELECT c.id, a.id AS account_id,
                       c.person_name, c.job_title, c.email, c.linkedin_url, c.source_kind, c.confidence, a.company, a.industry,
                       COALESCE(a.icp_enhanced_score, a.icp_score) as score,
                       a.website, a.signal_evidence,
                       (SELECT e.url FROM evidence e WHERE e.account_id = a.id AND trim(COALESCE(e.url, '')) != ''
                        ORDER BY e.id DESC LIMIT 1) AS signal_url
                FROM contacts c
                JOIN accounts a ON a.id = c.account_id
                WHERE {people_sql_where}
                ORDER BY c.role_rank DESC, a.company ASC
                """,
                tuple(args),
            ).fetchall()
            return {
                "mode": "people",
                "items": [dict(r) for r in people if _account_row_is_visible(dict(r))],
            }
        return {"mode": "accounts", "items": items}
    finally:
        conn.close()


@app.get("/api/pipeline/batches")
def list_batches(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Distinct ``data_batch`` labels with counts, for the dashboard date filter.

    Returns dated scrape batches (newest first), then the "original" pre-scrape
    set, then any unlabeled rows — each as ``{value, label, count, kind}``."""
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT COALESCE(data_batch, '') AS batch, COUNT(*) AS c FROM accounts GROUP BY batch"
        ).fetchall()
        dated: list[dict[str, Any]] = []
        original_count = 0
        unknown_count = 0
        for r in rows:
            b = str(r["batch"] or "").strip()
            c = int(r["c"])
            if b == "original":
                original_count += c
            elif b == "":
                unknown_count += c
            else:
                dated.append({"value": b, "label": f"Scraped {b}", "count": c, "kind": "date"})
        dated.sort(key=lambda x: x["value"], reverse=True)
        items: list[dict[str, Any]] = list(dated)
        if original_count:
            items.append({"value": "original", "label": "Original list", "count": original_count, "kind": "original"})
        if unknown_count:
            items.append({"value": "", "label": "Unlabeled", "count": unknown_count, "kind": "unknown"})
        return {"items": items}
    finally:
        conn.close()


@app.get("/api/accounts/{account_id}")
def account_detail(account_id: int, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
        if not row or not _account_row_is_visible(dict(row)):
            raise HTTPException(status_code=404, detail="Not found")
        evidence = conn.execute(
            "SELECT id, label, source, url, snippet FROM evidence WHERE account_id = ? ORDER BY id DESC",
            (account_id,),
        ).fetchall()
        contact_rows = conn.execute(
            """
            SELECT person_name, job_title, email, role_rank, confidence
            FROM contacts
            WHERE account_id = ?
            ORDER BY role_rank DESC, confidence DESC, person_name ASC
            LIMIT 100
            """,
            (account_id,),
        ).fetchall()
        contacts_preview = [dict(r) for r in contact_rows]
        out = dict(row)
        out["swot"] = json.loads(str(out.get("swot_json") or "{}"))
        out["evidence"] = [dict(e) for e in evidence]
        out["outreach_sequence"] = _outreach_sequence_for_account(out, contacts_preview)
        return out
    finally:
        conn.close()


@app.get("/api/accounts/{account_id}/contacts")
def account_contacts(account_id: int, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT id, person_name, job_title, email, phone, linkedin_url, source_kind, confidence, role_rank
            FROM contacts
            WHERE account_id = ?
            ORDER BY role_rank DESC, confidence DESC, person_name ASC
            """,
            (account_id,),
        ).fetchall()
        return {"items": [dict(r) for r in rows]}
    finally:
        conn.close()


@app.post("/api/pipeline/enrich")
def pipeline_enrich(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Client-facing trigger: AI-research + Hunter-enrich the existing leads,
    then re-sync the cockpit. Non-destructive (enriches rows in place, no
    re-scrape). Returns immediately; UI polls /api/summary.pipeline_state."""
    from utils.pipeline_run_state import clear_stale_lock, read_lock

    clear_stale_lock()
    if read_lock():
        return {"started": False, "running": True, "detail": "A pipeline run is already in progress."}

    root = Path(__file__).resolve().parent.parent
    py = sys.executable
    chain = (
        f"{py!r} main.py milestone2-research "
        f"&& {py!r} main.py milestone2-enrich "
        f'&& {py!r} -c "from outreach.cockpit_api import sync_from_xlsx; sync_from_xlsx()"'
    )
    subprocess.Popen(  # noqa: S603 — fixed command, no user input
        ["bash", "-lc", chain],
        cwd=str(root),
        start_new_session=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return {"started": True, "running": True}


# ================= Dashboard settings + scrape scheduler API =================


@app.get("/api/settings")
def get_app_settings(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """All client-tunable settings with metadata — the Settings page renders from this."""
    from outreach import app_settings, scrape_runner

    return {
        "items": app_settings.all_settings(),
        "schedule": scrape_runner.schedule_summary(),
        "key_alerts": app_settings.get_key_alerts(),
    }


class SettingsPatchInput(BaseModel):
    values: dict[str, Any] = {}
    reset: list[str] = []


@app.patch("/api/settings")
def patch_app_settings(body: SettingsPatchInput, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    from outreach import app_settings, scrape_runner

    saved = app_settings.set_settings(body.values) if body.values else {}
    for key in body.reset:
        app_settings.reset_setting(key)
    return {
        "ok": True,
        "saved": saved,
        "items": app_settings.all_settings(),
        "schedule": scrape_runner.schedule_summary(),
        "key_alerts": app_settings.get_key_alerts(),
    }


@app.post("/api/pipeline/scrape")
def pipeline_scrape(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Run the lead scraper now (additive merge — nothing existing is deleted)."""
    from outreach import scrape_runner

    return scrape_runner.start_scrape(trigger="manual")


@app.post("/api/pipeline/enrich-contacts")
def pipeline_enrich_contacts(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Find decision-maker contacts for leads that have none (respects the daily cap)."""
    from outreach import scrape_runner

    return scrape_runner.run_contact_enrich(trigger="manual")


# ================== Project management (in-dashboard kanban) ==================


class PmCardCreateInput(BaseModel):
    title: str
    description: str = ""
    column_key: str = "new"


class PmCardUpdateInput(BaseModel):
    title: str | None = None
    description: str | None = None
    column_key: str | None = None
    position: float | None = None
    labels: list[str] | None = None
    due_at: float | None = None  # 0 clears the due date


class PmCommentInput(BaseModel):
    body: str


class PmCheckCreateInput(BaseModel):
    text: str


class PmCheckUpdateInput(BaseModel):
    text: str | None = None
    done: bool | None = None


@app.get("/api/pm/board")
def pm_board(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    from outreach import pm_store

    return {"columns": pm_store.list_board()}


@app.post("/api/pm/cards")
def pm_card_create(body: PmCardCreateInput, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    from outreach import pm_store

    title = (body.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Card title is required")
    return {"ok": True, "card": pm_store.create_card(title, body.description or "", body.column_key or "new")}


@app.get("/api/pm/cards/{card_id}")
def pm_card_get(card_id: int, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    from outreach import pm_store

    card = pm_store.get_card(card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return {
        "card": card,
        "comments": pm_store.list_comments(card_id),
        "checklist": pm_store.list_checklist(card_id),
    }


@app.patch("/api/pm/cards/{card_id}")
def pm_card_update(card_id: int, body: PmCardUpdateInput, user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    from outreach import pm_store

    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    card = pm_store.update_card(card_id, fields, actor=str(user.get("email") or ""))
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return {"ok": True, "card": card}


@app.delete("/api/pm/cards/{card_id}")
def pm_card_delete(card_id: int, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    from outreach import pm_store

    pm_store.delete_card(card_id)
    return {"ok": True}


@app.post("/api/pm/cards/{card_id}/comments")
def pm_card_comment(card_id: int, body: PmCommentInput, user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    from outreach import pm_store

    text = (body.body or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Comment text is required")
    if not pm_store.get_card(card_id):
        raise HTTPException(status_code=404, detail="Card not found")
    return {"ok": True, "comments": pm_store.add_comment(card_id, str(user.get("email") or ""), text)}


@app.post("/api/pm/cards/{card_id}/checklist")
def pm_check_create(card_id: int, body: PmCheckCreateInput, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    from outreach import pm_store

    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Checklist item text is required")
    if not pm_store.get_card(card_id):
        raise HTTPException(status_code=404, detail="Card not found")
    return {"ok": True, "checklist": pm_store.add_check_item(card_id, text)}


@app.patch("/api/pm/checklist/{item_id}")
def pm_check_update(item_id: int, body: PmCheckUpdateInput, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    from outreach import pm_store

    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    card_id = pm_store.update_check_item(item_id, fields)
    if card_id is None:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    return {"ok": True, "checklist": pm_store.list_checklist(card_id), "card": pm_store.get_card(card_id)}


@app.delete("/api/pm/checklist/{item_id}")
def pm_check_delete(item_id: int, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    from outreach import pm_store

    card_id = pm_store.delete_check_item(item_id)
    if card_id is None:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    return {"ok": True, "checklist": pm_store.list_checklist(card_id), "card": pm_store.get_card(card_id)}


# ============================ Email outreach API ============================


class EmailDraftInput(BaseModel):
    to_email: str | None = None
    regenerate: bool = False
    angle: str | None = None  # messaging angle key (else auto-picked per lead)


class EmailApproveInput(BaseModel):
    to_email: str | None = None
    inbox_id: int | None = None  # which Mailu inbox will send (else auto-rotate at batch time)


class SendApprovedInput(BaseModel):
    sequence_ids: list[int] | None = None  # subset of the queue; None/empty = everything approved


class ComposeInput(BaseModel):
    to_email: str
    subject: str
    body: str


# ===================== Outreach module — inbox management =====================


class InboxUpdateInput(BaseModel):
    warmup_status: str | None = None
    enabled: int | None = None
    daily_cap: int | None = None
    from_name: str | None = None


@app.get("/api/outreach/inboxes")
def outreach_inboxes(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    from outreach import outreach_store

    return {"items": outreach_store.list_inboxes(include_secrets=False)}


@app.patch("/api/outreach/inboxes/{inbox_id}")
def outreach_inbox_update(inbox_id: int, body: InboxUpdateInput, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    from outreach import outreach_store

    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    outreach_store.update_inbox(inbox_id, fields)
    return {"ok": True, "inbox": outreach_store.get_inbox(inbox_id, include_secrets=False)}


def _account_lead_context(account_id: int) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """Return (lead_context, best_contact) for drafting, or None if no account."""
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
        if not row:
            return None
        a = dict(row)
        contact = conn.execute(
            """
            SELECT person_name, job_title, email FROM contacts
            WHERE account_id = ? AND trim(COALESCE(email,'')) != ''
            ORDER BY role_rank DESC, confidence DESC LIMIT 1
            """,
            (account_id,),
        ).fetchone()
        if not contact:
            contact = conn.execute(
                "SELECT person_name, job_title, email FROM contacts WHERE account_id = ? "
                "ORDER BY role_rank DESC, confidence DESC LIMIT 1",
                (account_id,),
            ).fetchone()
        c = dict(contact) if contact else {}
        lead = {
            "company": a.get("company"),
            "website": a.get("website"),
            "industry": a.get("industry"),
            "signal_category": a.get("signal_category"),
            "signal_evidence": a.get("signal_evidence"),
            "equipment_needs": a.get("equipment_needs"),
            "company_profile": a.get("spark_brief") or a.get("company_profile"),
            "active_projects": a.get("active_projects"),
            "icp_score": a.get("icp_enhanced_score") or a.get("icp_score"),
            "person_name": c.get("person_name") or "",
            "job_title": c.get("job_title") or "",
            "email": (c.get("email") or "").strip(),
        }
        return lead, c
    finally:
        conn.close()


@app.get("/api/leads/{account_id}/email")
def lead_email_get(account_id: int, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    from outreach import email_store, outreach_store
    from outreach.messaging_angles import list_angles, pick_angle

    seq = email_store.get_sequence_for_account(account_id)
    ctx = _account_lead_context(account_id)
    suggested = ctx[0].get("email") if ctx else ""
    inboxes = outreach_store.list_inboxes(include_secrets=False)
    suggested_inbox = None
    try:
        pick = outreach_store.pick_send_inbox(require_warmed=False)
        suggested_inbox = pick["id"] if pick else (inboxes[0]["id"] if inboxes else None)
    except Exception:  # noqa: BLE001
        suggested_inbox = inboxes[0]["id"] if inboxes else None
    suggested_angle = pick_angle({**(ctx[0] if ctx else {}), "account_id": account_id})
    return {
        "sequence": seq,
        "suggested_email": suggested,
        "inboxes": inboxes,
        "suggested_inbox_id": suggested_inbox,
        "angles": list_angles(),
        "suggested_angle": suggested_angle,
    }


@app.get("/api/leads/{account_id}/activity")
def lead_activity(account_id: int, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Email activity timeline for one lead: each step's send/schedule/reply/bounce."""
    from outreach import email_store

    seq = email_store.get_sequence_for_account(account_id)
    events: list[dict[str, Any]] = []
    if seq:
        for st in seq.get("steps", []):
            label = "First email" if st["step_index"] == 0 else f"Follow-up {st['step_index']}"
            if st.get("bounced"):
                events.append({"type": "bounce", "label": label, "ts": st.get("bounce_at"), "detail": st.get("bounce_info") or "bounced", "subject": st.get("subject")})
            if st.get("status") == "sent":
                events.append({"type": "sent", "label": label, "ts": st.get("sent_at"), "subject": st.get("subject")})
            elif st.get("status") == "pending" and st.get("scheduled_at"):
                events.append({"type": "scheduled", "label": label, "ts": st.get("scheduled_at"), "subject": st.get("subject")})
            elif st.get("status") == "failed":
                events.append({"type": "failed", "label": label, "ts": None, "detail": st.get("error"), "subject": st.get("subject")})
        if seq.get("replied") or seq.get("status") == "replied":
            events.append({"type": "reply", "label": "Prospect replied", "ts": seq.get("updated_at"), "detail": "Follow-ups auto-stopped"})
    events.sort(key=lambda e: e.get("ts") or 0, reverse=True)
    return {"items": events, "status": (seq or {}).get("status")}


@app.post("/api/leads/{account_id}/email/draft")
def lead_email_draft(
    account_id: int, body: EmailDraftInput, _user: dict[str, Any] = Depends(_auth_user)
) -> dict[str, Any]:
    """Generate (OpenAI) and store a draft email sequence for this lead."""
    from outreach import email_store
    from outreach.email_drafting import draft_email_sequence
    from outreach.messaging_angles import pick_angle

    ctx = _account_lead_context(account_id)
    if ctx is None:
        raise HTTPException(status_code=404, detail="Account not found")
    lead, _contact = ctx
    to_email = (body.to_email or lead.get("email") or "").strip()
    existing = email_store.get_sequence_for_account(account_id)
    if existing and existing["status"] not in ("draft", "failed") and not body.regenerate:
        return {"sequence": existing, "provider": existing.get("provider"), "note": "already_sent"}
    angle = body.angle or pick_angle({**lead, "account_id": account_id})
    steps, provider = draft_email_sequence(lead, angle=angle)
    seq = email_store.upsert_draft(
        account_id=account_id,
        company=str(lead.get("company") or ""),
        person_name=str(lead.get("person_name") or ""),
        to_email=to_email,
        from_email=OUTREACH_FROM_EMAIL,
        provider=provider,
        steps=steps,
        angle=angle,
    )
    return {"sequence": seq, "provider": provider, "suggested_email": to_email, "angle": angle}


@app.post("/api/leads/{account_id}/email/approve")
def lead_email_approve(
    account_id: int, body: EmailApproveInput, _user: dict[str, Any] = Depends(_auth_user)
) -> dict[str, Any]:
    """Approve this lead's drafted sequence for sending. Nothing is sent here —
    approved sequences wait in the send queue (Emails → Send queue) until the
    user fires the whole batch with one action."""
    from outreach import email_store, outreach_store

    ctx = _account_lead_context(account_id)
    if ctx is None:
        raise HTTPException(status_code=404, detail="Account not found")
    lead, _contact = ctx
    seq = email_store.get_sequence_for_account(account_id)
    if not seq or not seq.get("steps"):
        raise HTTPException(status_code=400, detail="Draft the email with AI first, review it, then approve.")
    if seq["status"] in ("sending", "sent"):
        return {"approved": False, "sequence": seq, "detail": "Already sent for this lead."}
    if seq["status"] == "stopped":
        raise HTTPException(status_code=400, detail="This sequence was stopped. Re-draft it to start over.")
    to_email = (body.to_email or seq.get("to_email") or lead.get("email") or "").strip()
    if "@" not in to_email:
        raise HTTPException(status_code=400, detail="No recipient email for this lead. Add a contact email first.")
    if body.inbox_id:
        chosen = outreach_store.get_inbox(int(body.inbox_id), include_secrets=False)
        if chosen:
            email_store.set_sequence_inbox(seq["id"], chosen["id"], chosen["email"])
    approved = email_store.approve_sequence(seq["id"], to_email=to_email)
    if approved is None:
        raise HTTPException(status_code=409, detail="Sequence changed state — refresh and try again.")
    return {
        "approved": True,
        "sequence": approved,
        "approved_count": len(email_store.list_approved()),
        "detail": "Approved — queued for the next batch send. Nothing has been sent yet.",
    }


@app.post("/api/emails/sequences/{sequence_id}/unapprove")
def emails_sequence_unapprove(sequence_id: int, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Pull one sequence back out of the approved queue (back to editable draft)."""
    from outreach import email_store

    seq = email_store.unapprove_sequence(sequence_id)
    if seq is None:
        raise HTTPException(status_code=400, detail="Only approved (not yet sent) sequences can be unapproved.")
    return {"sequence": seq, "items": email_store.list_approved()}


class EmailPreviewInput(BaseModel):
    body: str
    from_email: str | None = None
    angle: str | None = None
    step_index: int | None = None
    # "frame1" or "frame2". None renders whatever is actually being sent.
    variant: str | None = None


def _live_variant() -> str:
    """Which design is actually being sent right now."""
    from outreach.email_sender import _template_variant

    return _template_variant()


@app.post("/api/emails/preview")
def email_preview(body: EmailPreviewInput, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Render copy through the production email template (exact HTML that sends,
    including the per-angle designed creative when one exists)."""
    from outreach.email_sender import _body_to_html
    from outreach.messaging_angles import dedash

    return {
        "html": _body_to_html(
            dedash(body.body or ""),
            body.from_email or "",
            angle=body.angle or "",
            step_index=body.step_index if body.step_index is not None else -1,
            variant=body.variant,
        ),
        "variant": (body.variant or "").strip().lower() or _live_variant(),
        "live_variant": _live_variant(),
    }


@app.get("/api/emails/approved")
def emails_approved(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """The approved send queue + current send capacity."""
    from outreach import email_runner, email_store

    return {"items": email_store.list_approved(), "cap_remaining": email_runner.cap_remaining()}


@app.post("/api/emails/send-approved")
def emails_send_approved(body: SendApprovedInput, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Fire the approved queue as ONE batch: every approved sequence starts —
    first emails go out now (respecting per-send gap + daily caps, in the
    background) and follow-ups are scheduled server-side."""
    from outreach import email_runner, email_store, outreach_store
    from outreach.email_sender import smtp_configured

    if not smtp_configured() and not outreach_store.list_inboxes():
        raise HTTPException(status_code=400, detail="No sending inbox configured. Add a Mailu inbox first.")
    result = email_runner.start_approved_sends(body.sequence_ids)
    queued = result.get("queued", 0)
    if queued:
        detail = (
            f"{queued} sequence(s) sending now. First emails go out with safe gaps between them; "
            "follow-ups are scheduled automatically. Track progress in Sent & follow-ups."
        )
    else:
        detail = "Nothing approved to send."
    return {"result": result, "items": email_store.list_approved(), "detail": detail}


@app.get("/api/emails/angles")
def emails_angles(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """The ten messaging angles, each rendered against a sample lead.

    The angle list was only reachable through /api/leads/{id}/email, so
    choosing an angle for a whole CAMPAIGN meant first picking an arbitrary
    lead to ask about. Each angle comes back with its steps already filled so
    the campaign wizard can show what the angle actually says, and the follow-up
    ladder that comes with it, before anything is drafted.
    """
    from outreach.email_drafting import followup_gap_days
    from outreach.messaging_angles import ANGLES, render_angle_steps

    sample = {
        "account_id": 0,
        "company": "Midwest Fabrication Co.",
        "person_name": "Alex Carter",
        "job_title": "Project Engineer",
        "industry": "Industrial & OEM",
        "location": "Ohio",
        "signal_evidence": "hiring two mechanical engineers for a new line",
    }
    gaps = followup_gap_days() or [3, 5, 7]
    out = []
    for a in ANGLES:
        steps = render_angle_steps(a, sample, "Dan Rigby")
        out.append({
            "key": a["key"],
            "name": a["name"],
            "steps": [
                {
                    "subject": st["subject"],
                    "body": st["body"],
                    "delay_after_prev_days": 0 if i == 0 else gaps[(i - 1) % len(gaps)],
                }
                for i, st in enumerate(steps)
            ],
        })
    return {"items": out, "sample": sample}


class RememberInput(BaseModel):
    kind: str = "told"
    subject: str
    fact: str
    confidence: float = 0.6
    source: str = "user"


@app.get("/api/agent/knowledge")
def agent_knowledge(
    q: str = Query(default=""),
    limit: int = Query(default=12, ge=1, le=50),
    _user: dict[str, Any] = Depends(_auth_user),
) -> dict[str, Any]:
    """What the agent knows, most relevant first. Empty q = strongest overall."""
    from outreach import agent_memory

    return {"items": agent_memory.recall(q, limit=limit), "stats": agent_memory.stats()}


@app.post("/api/agent/remember")
def agent_remember(
    body: RememberInput, _user: dict[str, Any] = Depends(_auth_user)
) -> dict[str, Any]:
    """Teach it something. Facts a person states outrank anything it inferred."""
    from outreach import agent_memory

    agent_memory.remember(
        kind=body.kind,
        subject=body.subject,
        fact=body.fact,
        confidence=max(0.0, min(1.0, float(body.confidence))),
        source=body.source,
    )
    return {"ok": True}


@app.post("/api/agent/learn")
def agent_learn_now(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Re-measure now instead of waiting for the hourly pass."""
    from outreach import agent_learn

    return agent_learn.run()


@app.post("/api/agent/triage")
def agent_triage_now(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Read the inbox and act on it now."""
    from outreach import inbox_agent

    return inbox_agent.run()


@app.get("/api/emails/attention")
def emails_attention(
    limit: int = Query(default=10, ge=1, le=50),
    _user: dict[str, Any] = Depends(_auth_user),
) -> dict[str, Any]:
    """What needs a human right now, and who.

    The dashboard could say how many emails went out; it could not say what to
    do about them. Leads that clicked and heard nothing back are a call list.
    """
    from outreach import email_store

    return email_store.attention_summary(limit=limit)


@app.get("/api/emails/scheduled")
def emails_scheduled(
    days: int = Query(default=30, ge=1, le=365),
    _user: dict[str, Any] = Depends(_auth_user),
) -> dict[str, Any]:
    """Follow-ups still to go out, soonest first, with the totals behind them.

    Answers "are follow-ups queued for all of them, and when" — which nothing
    exposed before, so a run with hundreds of scheduled steps looked the same as
    one with none.
    """
    from outreach import email_store

    return {
        "items": email_store.scheduled_steps(days=days),
        "summary": email_store.scheduled_summary(days=days),
        "days": days,
    }


@app.get("/api/emails/sent")
def emails_sent(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    from outreach import email_store

    return {"items": email_store.list_sequences(limit=300)}


def _send_headroom(capacity: dict[str, Any]) -> dict[str, Any]:
    """How many first emails can actually go out, and what is stopping the rest.

    Home showed "12 ready to email now" and, two inches below, "288 more can go
    out today". Both were true of something and neither was true of the
    question being asked, so the page contradicted itself: 288 is mailbox
    capacity, 12 is how many people exist to write to, and sending was paused
    for the hour anyway. Three different limits presented as one.

    The real answer is the smallest of the three, and the useful part is WHICH
    one binds — capacity is a setting, an empty pool is a lead-finding problem,
    and a closed window is just the clock. The sentence is composed here rather
    than in the UI so the words can never drift from the numbers.
    """
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from outreach import db, email_runner

    cap_left = int((capacity or {}).get("remaining") or 0)

    # People we have never written to who have a usable address.
    fresh = 0
    try:
        c = db.connect()
        try:
            row = c.execute(
                """
                SELECT COUNT(*) AS n FROM accounts a
                WHERE EXISTS (SELECT 1 FROM contacts ct
                               WHERE ct.account_id = a.id AND COALESCE(ct.email,'') <> '')
                  AND NOT EXISTS (SELECT 1 FROM email_sequences sq WHERE sq.account_id = a.id)
                """
            ).fetchone()
            fresh = int(row["n"] or 0)
        finally:
            c.close()
    except Exception:  # noqa: BLE001
        fresh = 0

    open_now, why = email_runner.within_send_window()
    start, end, _weekdays = email_runner.send_window()
    now_et = datetime.now(ZoneInfo(email_runner.SEND_TZ))

    can_send = 0 if not open_now else min(cap_left, fresh)

    if not open_now:
        limited_by = "sending hours"
        sentence = (
            f"Sending is paused until {start:02d}:00 US Eastern "
            f"(it is {now_et:%H:%M} there now). "
            f"{min(cap_left, fresh)} first email"
            f"{'' if min(cap_left, fresh) == 1 else 's'} will go out when it opens."
        )
    elif fresh <= cap_left:
        limited_by = "fresh contacts"
        sentence = (
            f"{fresh} first email{'' if fresh == 1 else 's'} can go out today, "
            "which is every contact we have never written to. "
            "More requires finding more people, not a bigger send cap."
        )
    else:
        limited_by = "mailbox capacity"
        sentence = (
            f"{cap_left} more can go out today before the mailboxes hit their "
            f"daily cap. {fresh:,} contacts are waiting behind that."
        )

    return {
        "window_open": open_now,
        "window_reason": why,
        "opens_at": f"{start:02d}:00",
        "closes_at": f"{end:02d}:00",
        "capacity_left": cap_left,
        "fresh_contacts": fresh,
        "can_send_now": can_send,
        "limited_by": limited_by,
        "sentence": sentence,
    }


@app.get("/api/emails/stats")
def emails_stats(
    days: int = Query(default=7, ge=1, le=90),
    tz: str = Query(default=""),
    _user: dict[str, Any] = Depends(_auth_user),
) -> dict[str, Any]:
    """Deliverability + engagement dashboard: sent / delivered / open / click /
    bounce rates (windowed + overall), per-angle A/B, and recent sends.

    ``tz`` overrides the reporting timezone for the per-day figures and exists
    only for debugging. It defaults to empty, meaning US Eastern: the dashboard
    is read from India but the business it reports on is not, and one fixed zone
    is the only way two people in different countries mean the same 24 hours by
    "yesterday". See email_store.REPORTING_TZ.
    """
    from outreach import email_runner, email_store

    stats = email_store.email_stats(days=days)
    stats["cap_remaining"] = email_runner.cap_remaining()
    # The answer to "how many did we send yesterday?", which nothing else on
    # the API could give — see email_store.sent_by_day.
    try:
        stats["daily"] = email_store.sent_by_day(
            days=14, tz=(tz or email_store.REPORTING_TZ)
        )
        stats["capacity"] = email_store.send_capacity()
        stats["headroom"] = _send_headroom(stats["capacity"])
    except Exception as e:  # noqa: BLE001 — the roll-up must still render
        stats["daily"] = None
        stats["capacity"] = None
        stats["daily_error"] = f"{type(e).__name__}: {e}"[:200]
    try:
        from outreach.app_settings import get_setting

        stats["scans"] = {
            "bounce": json.loads(get_setting("BOUNCE_SCAN_LAST") or "null"),
            "reply": json.loads(get_setting("REPLY_SCAN_LAST") or "null"),
        }
    except Exception:  # noqa: BLE001 — scan heartbeat is optional decoration
        stats["scans"] = None
    return stats


@app.get("/api/emails/engagement")
def emails_engagement(
    kind: str = Query(default="opened"), _user: dict[str, Any] = Depends(_auth_user)
) -> dict[str, Any]:
    """Drill-down list for the dashboard cards: who opened / clicked / bounced."""
    from outreach import email_store

    if kind not in ("opened", "clicked", "bounced"):
        raise HTTPException(status_code=400, detail="kind must be opened|clicked|bounced")
    return {"kind": kind, "items": email_store.engagement_list(kind)}


@app.get("/api/emails/recent")
def emails_recent(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _user: dict[str, Any] = Depends(_auth_user),
) -> dict[str, Any]:
    """Paginated 'recent sent emails' for the dashboard table."""
    from outreach import email_store

    return email_store.recent_sent(limit=limit, offset=offset)


@app.get("/api/emails/step/{step_id}")
def emails_step_preview(step_id: int, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Full preview of one sent email (lead, to/from, subject, copy + rendered HTML)."""
    from outreach import email_store

    p = email_store.email_preview(step_id)
    if not p:
        raise HTTPException(status_code=404, detail="Email not found")
    return p


# --- Dashboard campaign sender (self-serve batched sending with validation) ---
class CampaignStartInput(BaseModel):
    total: int
    batch_size: int
    interval_minutes: int
    # None keeps the deterministic per-account rotation across all ten angles.
    # Setting it locks the whole run to one, which is what makes an A/B run
    # readable instead of a blur of ten.
    angle: str | None = None


class CampaignGenerateInput(BaseModel):
    total: int
    angle: str | None = None


@app.get("/api/emails/campaign/status")
def campaign_status_get(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    from outreach import campaign_sender

    return campaign_sender.campaign_status()


@app.post("/api/emails/campaign/validate")
def campaign_validate(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Pre-validate the never-emailed pool (syntax + MX + SMTP), in the background."""
    from outreach import campaign_sender

    return campaign_sender.start_validation(limit=800)


@app.post("/api/emails/campaign/generate")
def campaign_generate(body: CampaignGenerateInput, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Draft a whole campaign for review. Sends NOTHING.

    Every lead gets a full sequence — opener plus its follow-ups — approved and
    waiting in the queue at GET /api/emails/approved. Firing it is a separate,
    deliberate call to /api/emails/send-approved.
    """
    from outreach import campaign_sender

    try:
        return campaign_sender.generate_drafts(body.total, angle=body.angle)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e


@app.post("/api/emails/campaign/start")
def campaign_start(body: CampaignStartInput, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Start a batched campaign: validate each batch, drop dead addresses, send
    the good ones from the approved templates, wait ``interval_minutes`` between."""
    from outreach import campaign_sender

    try:
        return campaign_sender.start_campaign(
            body.total, body.batch_size, body.interval_minutes, angle=body.angle
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e


@app.post("/api/emails/campaign/stop")
def campaign_stop(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    from outreach import campaign_sender

    return campaign_sender.stop_campaign()


@app.post("/api/emails/scan-bounces")
def emails_scan_bounces(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """On-demand bounce check (also runs automatically every 5 min). Marks any
    sent step whose delivery bounced, then returns the refreshed sent list."""
    from outreach import email_store
    from outreach.bounce_scan import scan_bounces

    result = scan_bounces()
    return {"result": result, "items": email_store.list_sequences(limit=300)}


# --- Bounce recovery: requeue bounced leads via alternate contacts ---
class BouncedRequeueInput(BaseModel):
    account_ids: list[int] | None = None    # empty/None = every non-requeued bounce
    dry_run: bool = False
    include_discovery: bool = False         # Serper-crawl accounts with no alternate


@app.get("/api/emails/bounced")
def emails_bounced(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """The Bounced tab: every bounced sequence, its best alternate contact,
    summary counts, and the state of any running requeue job."""
    from outreach import bounce_requeue

    return bounce_requeue.list_bounced()


@app.post("/api/emails/bounced/requeue")
def emails_bounced_requeue(body: BouncedRequeueInput, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Start the background recovery job: fence off bounced addresses, pick +
    validate an alternate contact per lead, redraft, and enroll. 409 if running."""
    from outreach import bounce_requeue

    try:
        return bounce_requeue.start_requeue(
            body.account_ids, dry_run=body.dry_run, include_discovery=body.include_discovery
        )
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))


@app.get("/api/leads/funnel")
def leads_funnel(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Where the leads are, and where they stop.

    Home reported email performance and nothing about the pipeline that feeds
    it, so "we found 800 leads today" and "we can send 39 emails" sat on the
    same screen with no visible relationship. They have a very strong one: 87%
    of the leads have no person attached, which is the entire reason the send
    numbers look the way they do.

    Every stage carries what it converts from the one above, because a raw
    count invites "we have 3,748 leads" and a conversion says "and 12% of them
    are reachable", which is the sentence that actually decides what to do
    next.
    """
    from outreach import db, scrape_runner

    c = db.connect()
    try:
        row = c.execute(
            """
            SELECT
              (SELECT COUNT(*) FROM accounts) AS found,
              (SELECT COUNT(*) FROM accounts a
                 WHERE EXISTS (SELECT 1 FROM contacts ct WHERE ct.account_id = a.id)) AS with_person,
              (SELECT COUNT(*) FROM accounts a
                 WHERE EXISTS (SELECT 1 FROM contacts ct
                                WHERE ct.account_id = a.id AND COALESCE(ct.email,'') <> '')) AS with_email,
              (SELECT COUNT(DISTINCT a.id) FROM accounts a
                 JOIN email_sequences sq ON sq.account_id = a.id) AS emailed,
              -- The SAME definition the send headroom uses. These were two
              -- different sums of the same idea — "with_email minus emailed"
              -- here, a NOT EXISTS there — so the page said "12 ready to email"
              -- and "32 first emails will go out" a few inches apart, and
              -- neither was wrong. Subtraction is not the same question: an
              -- account can be emailed and still hold an unwritten-to contact.
              (SELECT COUNT(*) FROM accounts a
                 WHERE EXISTS (SELECT 1 FROM contacts ct
                                WHERE ct.account_id = a.id AND COALESCE(ct.email,'') <> '')
                   AND NOT EXISTS (SELECT 1 FROM email_sequences sq
                                    WHERE sq.account_id = a.id)) AS ready,
              (SELECT COUNT(*) FROM accounts WHERE COALESCE(website,'') <> ''
                 AND COALESCE(email,'') = '') AS website_no_email
            """
        ).fetchone()
    finally:
        c.close()

    found = int(row["found"] or 0)
    with_person = int(row["with_person"] or 0)
    with_email = int(row["with_email"] or 0)
    emailed = int(row["emailed"] or 0)

    def pct(n: int, d: int) -> float:
        return round(100.0 * n / d, 1) if d else 0.0

    try:
        sched = scrape_runner.schedule_summary()
    except Exception:  # noqa: BLE001
        sched = {}

    ready = int(row["ready"] or 0)
    # Name the narrowest step. Whichever stage loses the most is the only one
    # worth working on, and stating it stops the number being read as a general
    # "things are slow".
    if found and with_person / max(found, 1) < 0.5:
        bottleneck = {
            "stage": "finding people",
            "detail": (
                f"{found - with_person:,} leads have no named contact yet. "
                "That, not the send cap, is what limits how many emails can go out."
            ),
        }
    elif ready < 50:
        bottleneck = {
            "stage": "fresh contacts",
            "detail": f"Only {ready:,} contacts have never been written to.",
        }
    else:
        bottleneck = {"stage": "", "detail": ""}

    return {
        "stages": [
            {"key": "found", "label": "Leads found", "value": found, "of_previous": 100.0},
            {"key": "with_person", "label": "Have a named person", "value": with_person,
             "of_previous": pct(with_person, found)},
            {"key": "with_email", "label": "Have an email address", "value": with_email,
             "of_previous": pct(with_email, with_person)},
            {"key": "emailed", "label": "Written to", "value": emailed,
             "of_previous": pct(emailed, with_email)},
        ],
        "ready_to_email": ready,
        "website_no_email": int(row["website_no_email"] or 0),
        "bottleneck": bottleneck,
        "scraper": sched,
    }


@app.get("/api/providers/health")
def providers_health(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Which outside services are working, and what breaks when one is not.

    Every one of these failures was already being recorded — record_key_alert
    has been writing KEY_ALERTS on each quota error for weeks — and nothing
    ever read it back onto a screen. So on 5 Aug all four search providers ran
    out of credit within ninety minutes of each other, contact-finding went to
    zero, the sendable pool fell to 34, and the first anyone knew was a
    question about why the send count was low. The data existed. The surface
    did not.

    `impact` is the point. "Serper: HTTP 400" tells a developer something and
    tells Dan nothing; "no new contacts can be found" tells them both.
    """
    import json as _json

    from outreach.app_settings import get_setting

    try:
        alerts = _json.loads(get_setting("KEY_ALERTS") or "{}") or {}
    except Exception:  # noqa: BLE001
        alerts = {}

    # provider -> (label, what stops working without it, is it fatal alone)
    SPEC = {
        "brightdata": ("Bright Data", "finding companies and the people who work at them", True),
        "serper": ("Serper", "a backup for finding contacts", False),
        "tavily": ("Tavily", "a backup for finding contacts", False),
        "openwebninja": ("OpenWebNinja", "a backup for finding contacts", False),
        "apollo": ("Apollo", "company phone numbers and LinkedIn pages", False),
        "millionverifier": ("MillionVerifier", "checking an address is real before writing to it", False),
    }

    from utils.websearch import _KEY_ENV  # noqa: PLC0415

    items = []
    # Not a key, a zone — and its absence is invisible everywhere else. The SERP
    # zone answers search-engine URLs only, so without a separate Unlocker zone
    # every website that refuses a plain fetch stays unreachable, which
    # is 2,313 leads holding a website and no email address.
    if not (get_setting("BRIGHTDATA_UNLOCKER_ZONE") or "").strip():
        items.append({
            "key": "brightdata_unlocker", "label": "Bright Data Web Unlocker",
            "impact": "reading staff directories on sites that block us",
            "critical": False, "state": "missing",
            "detail": "No Unlocker zone set. The SERP zone cannot fetch ordinary websites.",
            "at": None,
        })
    for key, (label, impact, critical) in SPEC.items():
        env = _KEY_ENV.get(key) or f"{key.upper()}_API_KEY"
        configured = bool((get_setting(env) or "").strip())
        alert = alerts.get(key) or {}
        msg = str(alert.get("message") or "")
        if not configured:
            state, detail = "missing", "No key has been entered."
        elif msg:
            state, detail = "down", msg[:200]
        else:
            state, detail = "ok", ""
        items.append({
            "key": key, "label": label, "impact": impact, "critical": critical,
            "state": state, "detail": detail, "at": alert.get("ts"),
        })

    # What Bright Data has cost today, and what the cache saved. Shown because
    # it is now the only provider carrying the pipeline and it bills per call.
    try:
        from utils import provider_cache

        spend = provider_cache.stats("brightdata")
    except Exception:  # noqa: BLE001
        spend = None

    search = [i for i in items if i["key"] in ("brightdata", "serper", "tavily", "openwebninja")]
    # The honest headline: contact-finding is dead only when EVERY search
    # provider is dead. One being out of credit is a fail-over, not an outage,
    # and reporting it as one trains people to ignore the banner.
    searching_broken = all(i["state"] != "ok" for i in search)
    return {
        "items": items,
        "spend": spend,
        "ok": not searching_broken and all(i["state"] == "ok" for i in items if i["critical"]),
        "searching_broken": searching_broken,
        "headline": (
            "No new contacts can be found — every search provider is out of credit."
            if searching_broken else ""
        ),
    }


@app.get("/api/emails/mailboxes")
def emails_mailboxes(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """The accounts the mail client can read, for the "which inbox" filter."""
    from outreach import mailbox as mbx

    return {"items": mbx.accounts()}


@app.get("/api/emails/inbox")
def emails_inbox(
    folder: str = Query(default="inbox"),
    account: str = Query(default=""),
    limit: int = Query(default=60),
    category: str = Query(default=""),
    _user: dict[str, Any] = Depends(_auth_user),
) -> dict[str, Any]:
    """Mail from EVERY account, not just the first one.

    This used to call imap_inbox.list_messages(), which resolves credentials
    with `_creds()` — the first enabled inbox and nothing else. Five mailboxes
    send under Dan's name and one of them was readable, with no indication on
    screen of which one that was. `folder` selects a role (inbox/sent/trash/
    spam/drafts/archive) resolved per account, and `account` narrows to one.
    """
    from outreach import mailbox as mbx

    accts = mbx.accounts()
    if not accts:
        raise HTTPException(status_code=400, detail="No mailboxes are configured.")
    raw = mbx.list_all(role=folder, limit=max(1, min(200, limit)), account=account)

    # Sort the mailbox before it reaches a person.
    #
    # 30 of the 40 messages here are delivery notices whose addresses the bounce
    # scanner has already suppressed, and the two out-of-office replies worth
    # reading were buried between them. The agent had already reached a verdict
    # on every one of these and the endpoint threw it away.
    from outreach import inbox_agent

    items = inbox_agent.categorise(raw.get("items") or [])
    tally = inbox_agent.counts(items)

    wanted = (category or "").strip().lower()
    if wanted and wanted != "all":
        items = [m for m in items if m.get("category") == wanted]

    return {
        **raw,
        "items": items,
        "counts": tally,
        "category": wanted or "all",
        "mailbox": folder,
        "count": len(items),
    }


@app.get("/api/emails/inbox/{message_id:path}")
def emails_inbox_message(
    message_id: str, _user: dict[str, Any] = Depends(_auth_user)
) -> dict[str, Any]:
    """One message. The id carries its own account and folder — see mailbox.parse_id."""
    from outreach import mailbox as mbx
    from outreach.imap_inbox import InboxError

    try:
        return mbx.get_one(message_id)
    except InboxError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.delete("/api/emails/inbox/{message_id:path}")
def emails_inbox_delete(
    message_id: str, _user: dict[str, Any] = Depends(_auth_user)
) -> dict[str, Any]:
    """Move to Trash, in the right account. Never expunges without a Trash copy."""
    from outreach import mailbox as mbx
    from outreach.imap_inbox import InboxError

    try:
        return mbx.move_to_trash(message_id)
    except InboxError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/emails/compose")
def emails_compose(body: ComposeInput, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    from outreach import email_store
    from outreach.email_sender import EmailSendError, smtp_configured
    from outreach.email_runner import DailyCapReached, send_throttled

    if not smtp_configured():
        raise HTTPException(status_code=400, detail="SMTP is not configured on the server.")
    try:
        token = email_store.new_token()
        mid = send_throttled(
            to_email=body.to_email, subject=body.subject, body=body.body, kind="compose",
            enforce_gap=False, track_token=token,
        )
        email_store.record_outbox(body.to_email, body.subject, body.body, mid, track_token=token)
        return {"sent": True, "message_id": mid}
    except DailyCapReached as e:
        raise HTTPException(status_code=429, detail=str(e))
    except EmailSendError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/emails/outbox")
def emails_outbox(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Manually composed + sent messages (the Compose box), newest first."""
    from outreach import email_store

    return {"items": email_store.list_outbox(limit=300)}


@app.delete("/api/emails/outbox/{outbox_id}")
def emails_outbox_delete(outbox_id: int, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Delete an Outbox record, and best-effort remove it from the IMAP Sent folder."""
    from outreach import email_store

    mid = email_store.delete_outbox(outbox_id)
    if mid is None:
        raise HTTPException(status_code=404, detail="Outbox message not found.")
    imap_result = None
    if mid:
        try:
            from outreach.imap_inbox import delete_by_message_id, imap_configured

            if imap_configured():
                imap_result = delete_by_message_id(mid)
        except Exception:
            imap_result = None
    return {"deleted": True, "imap": imap_result}


@app.post("/api/emails/sequences/{sequence_id}/stop")
def emails_sequence_stop(sequence_id: int, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Stop the remaining follow-ups for a lead's sequence (cancels pending steps).
    Already-sent emails are unaffected."""
    from outreach import email_store

    result = email_store.stop_followups(sequence_id)
    return {"result": result, "items": email_store.list_sequences(limit=300)}


@app.delete("/api/emails/sequences/{sequence_id}")
def emails_sequence_delete(sequence_id: int, _user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    """Remove a sequence from the Sent log (does not unsend delivered email)."""
    from outreach import email_store

    ok = email_store.delete_sequence(sequence_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Sequence not found.")
    return {"deleted": True, "items": email_store.list_sequences(limit=300)}


# ---------------------------------------------------------------------------
# Inbound lead capture from the marketing site
# ---------------------------------------------------------------------------

_SAMPLE_DOWNLOAD_URL = "/files/win-the-day-sample.pdf"
_SAMPLE_RATE_LIMIT = 5  # submissions per IP per hour
_sample_request_log: dict[str, list[float]] = {}


class SampleRequestInput(BaseModel):
    name: str
    email: str
    phone: str = ""          # optional on the form
    school: str = ""
    organization: str = ""   # legacy alias for school, kept so old payloads still land
    role: str = ""
    students_count: str = "" # district size band, e.g. "500-1000"
    school_type: str = ""   # public / private / charter
    notes: str = ""         # free-text message from the prospect
    grant_interest: bool = False
    website: str = ""  # honeypot — real users never fill this
    source: str = ""


def _sample_rate_ok(ip: str) -> bool:
    now = time.time()
    hits = [t for t in _sample_request_log.get(ip, []) if now - t < 3600]
    if len(hits) >= _SAMPLE_RATE_LIMIT:
        _sample_request_log[ip] = hits
        return False
    hits.append(now)
    _sample_request_log[ip] = hits
    return True


@app.post("/api/public/sample-request")
def public_sample_request(
    body: SampleRequestInput, request: Request, background: BackgroundTasks
) -> dict[str, Any]:
    """Public (unauthenticated) lead capture for the .net landing page.

    Served same-origin via the marketing site's nginx proxy, so no CORS.
    """
    from outreach import sample_leads

    ip = (request.headers.get("x-real-ip") or request.headers.get("x-forwarded-for") or "").split(",")[
        0
    ].strip() or (request.client.host if request.client else "")
    if body.website.strip():
        # Honeypot tripped — pretend success, store nothing.
        return {"ok": True, "download_url": _SAMPLE_DOWNLOAD_URL}
    if not _sample_rate_ok(ip):
        raise HTTPException(status_code=429, detail="Too many requests. Try again later.")
    name = body.name.strip()
    email = body.email.strip().lower()
    if not name or "@" not in email or "." not in email.split("@")[-1] or len(email) > 254:
        raise HTTPException(status_code=422, detail="A name and a valid email are required.")
    school = (body.school.strip() or body.organization.strip())[:300]
    lead_id = sample_leads.add_lead(
        name=name[:200],
        email=email,
        phone=body.phone.strip()[:40],
        school=school,
        role=body.role.strip()[:100],
        students_count=body.students_count.strip()[:40],
        school_type=body.school_type.strip()[:60],
        notes=body.notes.strip()[:2000],
        grant_interest=bool(body.grant_interest),
        source=body.source.strip()[:100],
        ip=ip[:64],
        user_agent=(request.headers.get("user-agent") or "")[:300],
    )
    # Alert the sales inbox and confirm to the prospect. Queued as a background
    # task so a slow SMTP handshake never delays the visitor's download.
    background.add_task(
        _notify_lead,
        {
            "id": lead_id,
            "name": name,
            "email": email,
            "phone": body.phone.strip(),
            "school": school,
            "role": body.role.strip(),
            "students_count": body.students_count.strip(),
            "school_type": body.school_type.strip(),
            "notes": body.notes.strip(),
            "grant_interest": bool(body.grant_interest),
            "source": body.source.strip(),
        },
    )
    return {"ok": True, "download_url": _SAMPLE_DOWNLOAD_URL}


def _notify_lead(lead: dict[str, Any]) -> None:
    """Best-effort lead emails; a failure must never surface to the visitor."""
    try:
        from outreach import lead_notify

        lead_notify.notify(lead)
    except Exception as e:  # noqa: BLE001
        print(f"Cockpit: lead notify failed: {e}", flush=True)


@app.get("/api/sample-leads")
def sample_leads_list(_user: dict[str, Any] = Depends(_auth_user)) -> dict[str, Any]:
    from outreach import sample_leads

    return {"items": sample_leads.list_leads(limit=500)}


def run_cockpit_api() -> None:
    import uvicorn

    print(
        f"Cockpit API: http://{COCKPIT_API_BIND}:{COCKPIT_API_PORT} "
        f"(reload={'on' if COCKPIT_API_RELOAD else 'off'})"
    )
    uvicorn.run(
        "outreach.cockpit_api:app",
        host=COCKPIT_API_BIND,
        port=COCKPIT_API_PORT,
        reload=COCKPIT_API_RELOAD,
    )

