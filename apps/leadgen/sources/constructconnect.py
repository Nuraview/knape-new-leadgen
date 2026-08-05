"""ConstructConnect / Dodge-style construction project leads (REST API).

Dodge Construction Network data is commonly accessed through ConstructConnect
IO APIs (subscription + API key from your account rep).
"""

from __future__ import annotations

import json
import os
from typing import Any

from config import (
    CONSTRUCTCONNECT_API_KEY,
    CONSTRUCTCONNECT_API_URL,
    CONSTRUCTCONNECT_MAX_RECORDS,
)
from utils.http import get_json


def _dig_records(payload: Any) -> list[dict]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("data", "results", "items", "leads", "projects", "value", "records"):
        block = payload.get(key)
        if isinstance(block, list):
            return [x for x in block if isinstance(x, dict)]
    return [payload] if payload else []


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
        obj.get("ownerName"),
        obj.get("companyName"),
        obj.get("contractorName"),
        obj.get("generalContractor"),
        obj.get("projectOwner"),
        obj.get("reportedByCompanyName"),
    )
    title = _first(obj.get("projectName"), obj.get("name"), obj.get("title"))
    city = _first(obj.get("city"), obj.get("projectCity"))
    state = _first(obj.get("state"), obj.get("projectState"))
    loc = ", ".join(x for x in (city, state) if x)
    desc = _first(
        obj.get("description"),
        obj.get("projectDescription"),
        obj.get("notes"),
        obj.get("summary"),
    )
    evidence_parts = [p for p in (title, loc, desc[:500] if desc else "") if p]
    evidence = " — ".join(evidence_parts) if evidence_parts else "ConstructConnect project lead."
    return {
        "company": company or "Unknown GC / owner (see evidence)",
        "website": _first(obj.get("website"), obj.get("companyWebsite")),
        "post_url": _first(
            obj.get("projectUrl"),
            obj.get("url"),
            obj.get("link"),
            obj.get("detailsUrl"),
        ),
        "source": "Dodge Construction Network",
        "signal_category": "facility_expansion",
        "signal_evidence": evidence,
        "person_name": _first(
            obj.get("contactName"),
            obj.get("primaryContactName"),
            obj.get("architectName"),
        ),
        "job_title": _first(obj.get("contactTitle"), obj.get("primaryContactTitle")),
    }


def fetch_constructconnect_leads() -> list[dict]:
    """Fetch project leads when ``CONSTRUCTCONNECT_API_URL`` and key are set.

    Set ``CONSTRUCTCONNECT_API_URL`` to the full URL ConstructConnect gave you
    (often includes query parameters). Send the API key in ``x-api-key`` header.
    """
    url = (CONSTRUCTCONNECT_API_URL or "").strip()
    key = (CONSTRUCTCONNECT_API_KEY or "").strip()
    if not url or not key:
        return []

    extra = os.getenv("CONSTRUCTCONNECT_EXTRA_HEADERS_JSON", "").strip()
    headers = {"x-api-key": key}
    if extra:
        try:
            headers.update({str(k): str(v) for k, v in json.loads(extra).items()})
        except json.JSONDecodeError:
            print("Warning: CONSTRUCTCONNECT_EXTRA_HEADERS_JSON is not valid JSON.")

    payload = get_json(url, headers=headers)
    if payload is None:
        return []
    rows = _dig_records(payload)
    out: list[dict] = []
    for obj in rows:
        out.append(_item_to_lead(obj))
    if CONSTRUCTCONNECT_MAX_RECORDS > 0:
        out = out[:CONSTRUCTCONNECT_MAX_RECORDS]
    if out:
        print(f"  ConstructConnect / Dodge API: {len(out)} project rows.")
    return out
