"""Manual Dodge / project export (JSON file).

Prefer live project data via ``sources/constructconnect.py`` using
``CONSTRUCTCONNECT_API_URL`` + ``CONSTRUCTCONNECT_API_KEY`` when your
ConstructConnect account provides an HTTP endpoint.
"""

from __future__ import annotations

import json
from pathlib import Path

from config import DODGE_LEADS_JSON, DODGE_MAX_RECORDS


def fetch_dodge() -> list[dict]:
    """Load leads from ``DODGE_LEADS_JSON`` if set (JSON array of lead dicts)."""
    if not DODGE_LEADS_JSON:
        return []
    path = Path(DODGE_LEADS_JSON)
    if not path.is_file():
        print(f"Warning: DODGE_LEADS_JSON not found: {path}")
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"Warning: could not read Dodge leads file: {e}")
        return []
    if not isinstance(data, list):
        return []
    out: list[dict] = []
    for row in data:
        if not isinstance(row, dict):
            continue
        row = dict(row)
        row.setdefault("source", "Dodge Construction Network")
        out.append(row)
    if DODGE_MAX_RECORDS > 0:
        out = out[:DODGE_MAX_RECORDS]
    return out
