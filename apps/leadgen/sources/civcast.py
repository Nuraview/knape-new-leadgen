"""CIVcast — API URL (preferred) or manual JSON export."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from config import (
    CIVCAST_API_URL,
    CIVCAST_HTTP_HEADERS_JSON,
    CIVCAST_LEADS_JSON,
    CIVCAST_MAX_RECORDS,
)
from utils.http import get_json


def _dig_records(payload: Any) -> list[dict]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("data", "results", "items", "bids", "leads", "records"):
        block = payload.get(key)
        if isinstance(block, list):
            return [x for x in block if isinstance(x, dict)]
    return []


def _first(*vals: object) -> str:
    for v in vals:
        if v is None:
            continue
        s = str(v).strip()
        if s:
            return s
    return ""


def _item_to_lead(obj: dict) -> dict:
    company = _first(
        obj.get("company"),
        obj.get("companyName"),
        obj.get("agency"),
        obj.get("owner"),
    )
    title = _first(obj.get("title"), obj.get("projectTitle"), obj.get("name"))
    desc = _first(obj.get("description"), obj.get("summary"), obj.get("notes"))
    evidence = " — ".join(p for p in (title, desc[:500] if desc else "") if p) or "CIVcast bid / RFQ signal."
    return {
        "company": company or "Unknown (CIVcast)",
        "website": _first(obj.get("website")),
        "post_url": _first(obj.get("url"), obj.get("bidUrl"), obj.get("detailsUrl")),
        "source": "CIVcast",
        "signal_category": "",
        "signal_evidence": evidence,
        "person_name": _first(obj.get("contactName"), obj.get("contact")),
        "job_title": _first(obj.get("contactTitle"), obj.get("title")),
    }


def fetch_civcast_from_api() -> list[dict]:
    url = (CIVCAST_API_URL or "").strip()
    if not url:
        return []
    headers: dict[str, str] = {}
    raw_h = (CIVCAST_HTTP_HEADERS_JSON or "").strip()
    if raw_h:
        try:
            headers = {str(k): str(v) for k, v in json.loads(raw_h).items()}
        except json.JSONDecodeError:
            print("Warning: CIVCAST_HTTP_HEADERS_JSON is not valid JSON.")
            return []
    payload = get_json(url, headers=headers or None)
    if payload is None:
        return []
    rows = _dig_records(payload)
    out = [_item_to_lead(o) for o in rows]
    if CIVCAST_MAX_RECORDS > 0:
        out = out[:CIVCAST_MAX_RECORDS]
    if out:
        print(f"  CIVcast API: {len(out)} rows.")
    return out


def fetch_civcast_from_file() -> list[dict]:
    if not CIVCAST_LEADS_JSON:
        return []
    path = Path(CIVCAST_LEADS_JSON)
    if not path.is_file():
        print(f"Warning: CIVCAST_LEADS_JSON not found: {path}")
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"Warning: could not read CIVcast leads file: {e}")
        return []
    if not isinstance(data, list):
        return []
    out: list[dict] = []
    for row in data:
        if not isinstance(row, dict):
            continue
        row = dict(row)
        row.setdefault("source", "CIVcast")
        out.append(row)
    if CIVCAST_MAX_RECORDS > 0:
        out = out[:CIVCAST_MAX_RECORDS]
    return out


def fetch_civcast() -> list[dict]:
    """Prefer live API; fall back to ``CIVCAST_LEADS_JSON``."""
    api_rows = fetch_civcast_from_api()
    if api_rows:
        return api_rows
    return fetch_civcast_from_file()
