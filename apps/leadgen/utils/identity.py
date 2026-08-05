"""Stable identity for deduplication (same lead, updated scores)."""

from __future__ import annotations

# Core row identity — excludes scores and narrative fields
LEAD_IDENTITY_KEYS: tuple[str, ...] = (
    "company",
    "website",
    "post_url",
    "source",
    "signal_category",
    "signal_evidence",
    "person_name",
    "job_title",
)


def record_identity_key(record: dict) -> tuple[str, ...]:
    vals = [str(record.get(k, "") or "").strip() for k in LEAD_IDENTITY_KEYS]
    return tuple(
        vals[i].lower() if i in (0, 6, 7) else vals[i] for i in range(8)
    )


def is_linkedin_source(source: str) -> bool:
    return "linkedin" in (source or "").lower()


def identity_key_from_row_cells(cells: list[str]) -> tuple[str, ...]:
    """Match ``record_identity_key`` for a flat row (first eight columns)."""
    padded = [cells[i] if i < len(cells) else "" for i in range(8)]
    return tuple(
        padded[i].lower() if i in (0, 6, 7) else padded[i] for i in range(8)
    )
