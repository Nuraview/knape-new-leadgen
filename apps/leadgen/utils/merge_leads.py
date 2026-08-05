"""Accumulating-master merge for leads.

Each scrape produces a fresh batch; instead of overwriting ``1.xlsx`` we MERGE new
companies into it so the dashboard shows every lead ever found (old + new + future).
Dedup is by normalized company name. Existing rows are preserved as-is (keeping their
research/email enrichment); only genuinely new companies are appended. Every lead
carries a ``data_batch`` tag ("original" or a run label like "2026-06-24") so the UI
can filter All / Latest / Original.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from utils.exclusions import normalize_company_key


def today_batch_label() -> str:
    return date.today().isoformat()


def _ensure_batch(rec: dict[str, Any], default: str) -> None:
    if not str(rec.get("data_batch") or "").strip():
        rec["data_batch"] = default


def merge_keep_existing(
    existing: list[dict[str, Any]],
    new_batch: list[dict[str, Any]],
    *,
    new_label: str,
    existing_default: str = "original",
) -> tuple[list[dict[str, Any]], int]:
    """Union by company, preserving existing rows untouched; append only new companies.

    Returns ``(merged, added_count)``. Existing rows keep their data + ``data_batch``
    (filled with ``existing_default`` when missing). New companies get ``new_label``.
    """
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()

    for rec in existing:
        _ensure_batch(rec, existing_default)
        key = normalize_company_key(str(rec.get("company") or ""))
        if key and key in seen:
            continue  # collapse any pre-existing intra-file dupes
        if key:
            seen.add(key)
        merged.append(rec)

    added = 0
    for rec in new_batch:
        key = normalize_company_key(str(rec.get("company") or ""))
        if not key or key in seen:
            continue  # skip companies we already have (keep the enriched original)
        rec["data_batch"] = new_label
        seen.add(key)
        merged.append(rec)
        added += 1

    return merged, added
