"""Classify and exclude off-ICP leads: staffing, competitors, partners, commercial suppliers."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal

from config import (
    LEAD_EXCLUDE_COMPANIES,
    LEAD_EXCLUDE_COMPETITORS,
    LEAD_EXCLUDE_PARTNERS,
    resolved_lead_exclusion_list_path,
)
from utils.domain import website_to_domain
from utils.signal_urls import is_listing_signal_url

ExclusionCategory = Literal[
    "staffing_agency",
    "competitor",
    "partner",
    "cheap_commercial_supplier",
]

_COMPANY_SUFFIX_RE = re.compile(
    r"\b(?:inc(?:orporated)?|llc|l\.l\.c\.|corp(?:oration)?|co(?:mpany)?|ltd|limited|usa|u\.s\.a\.)\b\.?",
    re.I,
)
_PUNCT_RE = re.compile(r"[^\w\s]")

_COMMERCIAL_REP_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bmfrs?\s+rep\b", re.I),
    re.compile(r"\bmanufacturer'?s?\s+rep(?:resentative)?s?\b", re.I),
    re.compile(r"\bmanufacturers?\s+representative\b", re.I),
    re.compile(r"\brep(?:resentative)?\s+firm\b", re.I),
    re.compile(r"\bsales\s+rep(?:resentative)?s?\s+for\b", re.I),
)

_COMMERCIAL_DISTRIBUTOR_RE = re.compile(
    r"^\s*(?:distributor|supplier|wholesaler|dealer)\s+of\b",
    re.I,
)

_COMPETITOR_FAN_BLOWER_PROFILE_RE = re.compile(
    r"\b(?:manufacturer|designer|builder|custom manufacturer)\b"
    r"(?:\s+and\s+(?:distributor|designer)\s+of|\s+of)?"
    r"[\w\s,/&-]{0,100}"
    r"\b(?:industrial\s+)?(?:centrifugal\s+|axial\s+|high[- ]pressure\s+)?"
    r"(?:fans?|blowers?|ventilators?|roof\s+ventilators?|airfoil(?:\s+blower)?s?|"
    r"plug\s+fans?|man[- ]coolers?|pressure\s+blowers?)\b",
    re.I,
)

_COMPETITOR_NAME_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\b(?:industrial\s+)?fan(?:s)?\s+(?:and|&)\s+blower", re.I),
    re.compile(r"\bblower\s+(?:co|company|corp|mfg|manufacturing)\b", re.I),
    re.compile(r"\bfan\s+(?:mfg|manufacturing|mfr)\b", re.I),
    re.compile(r"\bair\s+movement\b", re.I),
)

_STAFFING_BLOB_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bour\s+client\s+is\s+hiring\b", re.I),
    re.compile(r"\bon\s+behalf\s+of\s+our\s+client\b", re.I),
    re.compile(r"\bcontract\s+(?:to|-)hire\b", re.I),
    re.compile(r"\bstaffing\s+(?:firm|agency|company|services)\b", re.I),
    re.compile(r"\brecruiting\s+(?:firm|agency|company|services)\b", re.I),
)

_HVAC_CATALOG_TERMS: tuple[str, ...] = (
    "fan",
    "blower",
    "hvac",
    "ventilation",
    "ventilator",
    "air handling",
    "heat pump",
    "refrigerat",
    "louver",
    "damper",
    "air filter",
    "dust collect",
    "air pollution",
    "fume collect",
    "make-up air",
    "exhaust fan",
)

_BUYER_OEM_TERMS: tuple[str, ...] = (
    "generator",
    "skid fabricat",
    "enclosure manufacturer",
    "packaged equipment",
    "foundry equipment",
    "castings",
    "forgings",
    "shipyard",
    "offshore module",
    "epc",
    "engineering procurement",
    "chemical plant operator",
    "refinery",
    "wastewater treatment plant",
)


def normalize_company_key(name: str) -> str:
    """Stable company identity for dedupe (ignores suffixes and punctuation)."""
    s = (name or "").strip().lower()
    s = _PUNCT_RE.sub(" ", s)
    s = _COMPANY_SUFFIX_RE.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


def _parse_csv_names(raw: str) -> list[str]:
    return [part.strip() for part in (raw or "").split(",") if part.strip()]


def _merge_list_entries(base: list[str], extra: list[str]) -> tuple[str, ...]:
    out: list[str] = []
    seen: set[str] = set()
    for item in [*base, *extra]:
        key = item.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(item.strip())
    return tuple(out)


@lru_cache(maxsize=1)
def _exclusion_lists() -> dict[str, dict[str, tuple[str, ...]]]:
    path = resolved_lead_exclusion_list_path()
    data: dict = {}
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            data = {}

    def section(key: str) -> dict:
        block = data.get(key) if isinstance(data.get(key), dict) else {}
        return {
            "names": tuple(str(x).strip() for x in block.get("names", []) if str(x).strip()),
            "domains": tuple(str(x).strip().lower() for x in block.get("domains", []) if str(x).strip()),
            "name_substrings": tuple(
                str(x).strip().lower() for x in block.get("name_substrings", []) if str(x).strip()
            ),
        }

    competitors = section("competitors")
    partners = section("partners")
    staffing = section("staffing_agencies")

    competitors = {
        "names": _merge_list_entries(list(competitors["names"]), _parse_csv_names(LEAD_EXCLUDE_COMPETITORS)),
        "domains": _merge_list_entries(
            [d.lower() for d in competitors["domains"]],
            [website_to_domain(f"https://{d}") for d in _parse_csv_names(LEAD_EXCLUDE_COMPETITORS) if "." in d],
        ),
        "name_substrings": competitors["name_substrings"],
    }
    partners = {
        "names": _merge_list_entries(list(partners["names"]), _parse_csv_names(LEAD_EXCLUDE_PARTNERS)),
        "domains": _merge_list_entries(
            [d.lower() for d in partners["domains"]],
            [website_to_domain(f"https://{d}") for d in _parse_csv_names(LEAD_EXCLUDE_PARTNERS) if "." in d],
        ),
        "name_substrings": partners["name_substrings"],
    }
    env_extra = _parse_csv_names(LEAD_EXCLUDE_COMPANIES)
    staffing = {
        **staffing,
        "names": _merge_list_entries(list(staffing["names"]), env_extra),
    }
    return {
        "competitors": competitors,
        "partners": partners,
        "staffing_agencies": staffing,
    }


def _record_text_blob(record: dict) -> str:
    return " ".join(
        str(record.get(k) or "")
        for k in (
            "company",
            "website",
            "source",
            "signal_evidence",
            "company_profile",
            "job_title",
            "post_url",
        )
    ).lower()


def _name_matches_list(company: str, company_key: str, block: dict[str, tuple[str, ...]]) -> str | None:
    low_company = company.lower()
    for name in block.get("names", ()):
        if normalize_company_key(name) == company_key:
            return name
    for sub in block.get("name_substrings", ()):
        if sub in low_company:
            return sub
    return None


def _domain_matches_list(domain: str, block: dict[str, tuple[str, ...]]) -> str | None:
    if not domain:
        return None
    host = domain.lower()
    for blocked in block.get("domains", ()):
        b = blocked.lower()
        if host == b or host.endswith("." + b):
            return b
    return None


def _classify_staffing(record: dict, *, company: str, company_key: str, blob: str) -> str | None:
    block = _exclusion_lists()["staffing_agencies"]
    matched = _name_matches_list(company, company_key, block)
    if matched:
        return f"staffing agency ({matched})"

    domain = website_to_domain(str(record.get("website") or ""))
    domain_hit = _domain_matches_list(domain, block)
    if domain_hit:
        return f"staffing agency (domain {domain_hit})"

    for pattern in _STAFFING_BLOB_PATTERNS:
        if pattern.search(blob):
            return f"staffing agency ({pattern.pattern})"

    title = str(record.get("job_title") or "").lower()
    if any(k in title for k in ("recruiter", "talent acquisition", "staffing consultant", "headhunter")):
        if any(k in blob for k in ("staffing", "recruiting", "recruitment", "talent solutions", "employment agency")):
            return "staffing agency (recruiter posting)"

    return None


def _classify_partner(record: dict, *, company: str, company_key: str) -> str | None:
    block = _exclusion_lists()["partners"]
    matched = _name_matches_list(company, company_key, block)
    if matched:
        return f"partner ({matched})"
    domain = website_to_domain(str(record.get("website") or ""))
    domain_hit = _domain_matches_list(domain, block)
    if domain_hit:
        return f"partner (domain {domain_hit})"
    return None


def _classify_competitor(record: dict, *, company: str, company_key: str, blob: str) -> str | None:
    block = _exclusion_lists()["competitors"]
    matched = _name_matches_list(company, company_key, block)
    if matched:
        return f"competitor ({matched})"

    domain = website_to_domain(str(record.get("website") or ""))
    domain_hit = _domain_matches_list(domain, block)
    if domain_hit:
        return f"competitor (domain {domain_hit})"

    for pattern in _COMPETITOR_NAME_PATTERNS:
        if pattern.search(company):
            return f"competitor (name pattern {pattern.pattern})"

    evidence = str(record.get("signal_evidence") or "")
    profile = str(record.get("company_profile") or "")
    for text in (evidence, profile):
        if not text.strip():
            continue
        if _COMPETITOR_FAN_BLOWER_PROFILE_RE.search(text):
            if not _looks_like_buyer_not_competitor(text):
                return "competitor (fan/blower manufacturer profile)"
    return None


def _looks_like_buyer_not_competitor(text: str) -> bool:
    low = text.lower()
    if any(term in low for term in _BUYER_OEM_TERMS):
        return True
    # Uses ventilation as a subsystem, not the core product line.
    if "including" in low[:220] and any(term in low for term in ("blower", "fan", "ventilation")):
        if any(term in low for term in ("generator", "skid", "enclosure", "module", "platform", "vessel")):
            return True
    return False


def _classify_cheap_commercial_supplier(record: dict, *, blob: str) -> str | None:
    evidence = str(record.get("signal_evidence") or "")
    profile = str(record.get("company_profile") or "")
    for text in (evidence, profile):
        if not text.strip():
            continue
        for pattern in _COMMERCIAL_REP_PATTERNS:
            if pattern.search(text):
                return "cheap commercial supplier (manufacturer rep)"

        low = text.lower().strip()
        if _COMMERCIAL_DISTRIBUTOR_RE.match(low):
            snippet = low[:500]
            if any(term in snippet for term in _HVAC_CATALOG_TERMS):
                return "cheap commercial supplier (HVAC catalog distributor)"
            if any(term in snippet for term in ("parts", "supplies", "equipment and supplies", "products include")):
                return "cheap commercial supplier (parts distributor)"

        if low.startswith("supplier of ") and any(term in low[:400] for term in _HVAC_CATALOG_TERMS):
            return "cheap commercial supplier (HVAC supplier)"

    company = str(record.get("company") or "").lower()
    if any(term in company for term in ("parts & supplies", "parts and supplies", "supply co", "wholesale")):
        if any(term in blob for term in _HVAC_CATALOG_TERMS):
            return "cheap commercial supplier (supply company name)"
    return None


def classify_record(record: dict) -> tuple[ExclusionCategory, str] | None:
    """Return exclusion category and reason, or None if the lead should be kept."""
    company = str(record.get("company") or "").strip()
    if not company:
        return ("cheap_commercial_supplier", "empty company")

    company_key = normalize_company_key(company)
    blob = _record_text_blob(record)

    staffing = _classify_staffing(record, company=company, company_key=company_key, blob=blob)
    if staffing:
        return ("staffing_agency", staffing)

    partner = _classify_partner(record, company=company, company_key=company_key)
    if partner:
        return ("partner", partner)

    competitor = _classify_competitor(record, company=company, company_key=company_key, blob=blob)
    if competitor:
        return ("competitor", competitor)

    commercial = _classify_cheap_commercial_supplier(record, blob=blob)
    if commercial:
        return ("cheap_commercial_supplier", commercial)

    return None


def exclusion_reason(record: dict) -> str | None:
    hit = classify_record(record)
    if not hit:
        return None
    category, detail = hit
    return f"{category}: {detail}"


def exclusion_category(record: dict) -> ExclusionCategory | None:
    hit = classify_record(record)
    return hit[0] if hit else None


def is_excluded_record(record: dict) -> bool:
    return classify_record(record) is not None


def filter_excluded_records(records: list[dict]) -> list[dict]:
    return [r for r in records if not is_excluded_record(r)]


def summarize_exclusions(records: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for record in records:
        hit = classify_record(record)
        if not hit:
            continue
        category, _ = hit
        counts[category] = counts.get(category, 0) + 1
    return counts


def _icp_score(record: dict) -> float:
    for key in ("icp_enhanced_score", "icp_score"):
        try:
            return float(record.get(key) or 0)
        except (TypeError, ValueError):
            pass
    return 0.0


def _record_rank(record: dict) -> tuple[float, int, int, str]:
    domain = website_to_domain(str(record.get("website") or ""))
    has_site = 1 if domain else 0
    has_listing = 1 if is_listing_signal_url(str(record.get("post_url") or "")) else 0
    return (_icp_score(record), has_listing, has_site, str(record.get("company") or ""))


def dedupe_by_company(records: list[dict]) -> list[dict]:
    """Keep a single best row per normalized company name."""
    best: dict[str, dict] = {}
    order: list[str] = []

    for record in records:
        key = normalize_company_key(str(record.get("company") or ""))
        if not key:
            continue
        if key not in best:
            best[key] = record
            order.append(key)
        elif _record_rank(record) > _record_rank(best[key]):
            best[key] = record

    return [best[key] for key in order if key in best]
