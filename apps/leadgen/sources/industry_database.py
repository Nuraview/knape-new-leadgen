"""Industry / account database — CSV file and/or JSON HTTP endpoint."""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

from config import INDUSTRY_DB_MAX_RECORDS, INDUSTRY_LEADS_CSV, INDUSTRY_LEADS_JSON_URL
from utils.http import get_json

_EXPECTED = (
    "company",
    "website",
    "post_url",
    "source",
    "signal_category",
    "signal_evidence",
    "person_name",
    "job_title",
)


def _dig_records(payload: Any) -> list[dict]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("data", "results", "items", "leads", "accounts"):
        block = payload.get(key)
        if isinstance(block, list):
            return [x for x in block if isinstance(x, dict)]
    return []


def fetch_industry_database_from_url() -> list[dict]:
    url = (INDUSTRY_LEADS_JSON_URL or "").strip()
    if not url:
        return []
    payload = get_json(url)
    if payload is None:
        return []
    rows = _dig_records(payload)
    out: list[dict] = []
    for row in rows:
        rec = {k: str(row.get(k, "") or "").strip() for k in _EXPECTED}
        if not rec["company"]:
            continue
        if not rec["source"]:
            rec["source"] = "Industry database"
        out.append(rec)
    if out:
        print(f"  Industry database URL: {len(out)} rows.")
    return out


def fetch_industry_database_from_csv() -> list[dict]:
    if not INDUSTRY_LEADS_CSV:
        return []
    path = Path(INDUSTRY_LEADS_CSV)
    if not path.is_file():
        print(f"Warning: INDUSTRY_LEADS_CSV not found: {path}")
        return []
    out: list[dict] = []
    try:
        with path.open(encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rec = {k: (row.get(k) or "").strip() for k in _EXPECTED}
                if not rec["company"]:
                    continue
                if not rec["source"]:
                    rec["source"] = "Industry database"
                out.append(rec)
    except OSError as e:
        print(f"Warning: could not read industry CSV: {e}")
        return []
    if out:
        print(f"  Industry database CSV: {len(out)} rows.")
    return out


def fetch_industry_database() -> list[dict]:
    """Prefer ``INDUSTRY_LEADS_JSON_URL``; then ``INDUSTRY_LEADS_CSV``."""
    url_rows = fetch_industry_database_from_url()
    out = url_rows if url_rows else fetch_industry_database_from_csv()
    if INDUSTRY_DB_MAX_RECORDS > 0:
        out = out[:INDUSTRY_DB_MAX_RECORDS]
    return out
