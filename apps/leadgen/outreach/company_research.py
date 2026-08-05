from __future__ import annotations

import json
from typing import Any

from config import GEMINI_MODEL, get_llm_api_key
from outreach import brand
from outreach.gemini_llm import gemini_generate_text, parse_json_object

# Written to spreadsheet / DB payloads from ``research_lead``.
RESEARCH_OUTPUT_FIELDS: tuple[str, ...] = (
    "company_profile",
    "active_projects",
    "equipment_needs",
    "budget_band",
    "equipment_tags",
    "icp_enhanced_score",
)

# Markers embedded in ``company_profile`` when Gemini is not used (see ``research_lead``).
_FALLBACK_MARKER_NO_API_KEY = "No API key:"
_FALLBACK_MARKER_GEMINI_ERROR = "AI research failed (Gemini error"


def research_non_gemini_reason(r: dict[str, Any]) -> str | None:
    """None if ``company_profile`` looks like a normal Gemini fill; else offline/API template kind."""
    cp = (r.get("company_profile") or "").strip()
    if not cp:
        return "empty_profile"
    if _FALLBACK_MARKER_NO_API_KEY in cp:
        return "no_key"
    if _FALLBACK_MARKER_GEMINI_ERROR in cp:
        return "api_error"
    return None


def research_result_used_gemini(payload: dict[str, Any]) -> bool:
    """True when ``research_lead`` looks like a successful model response (not offline template)."""
    return research_non_gemini_reason(payload) is None


def _research_system() -> str:
    """Built per call: it names the business, which is per instance."""
    brief = brand.business_brief()
    audience = brand.audience_brief()
    who = (
        f"You are a B2B research assistant for {brand.name()}. {brief} "
        if brief
        else "You are a B2B research assistant. You have not been told what the business sells, "
             "so describe the ACCOUNT only and make no claim about product fit. "
    )
    return (
        who
        + (f"{audience}\n" if audience else "\n")
        + "You receive partial facts scraped from public signals (job postings, company sites, "
        "LinkedIn profiles). Rules:\n"
        "- Use ONLY the JSON facts provided. Do not invent named projects, dollar amounts, dates, "
        "or contacts.\n"
        "- If facts are thin, say uncertainty briefly (e.g. insufficient public detail).\n"
        "- equipment_needs = the BUYING ANGLE: what this account is likely to need and what would "
        "trigger the purchase (e.g. a capacity expansion with new process ventilation, an "
        "engineering team short of hours, an ageing installation), 2-3 sentences.\n"
        "- equipment_tags = comma-separated themes drawn from the facts (e.g. facility expansion, "
        "engineering hiring, process air, marine, retrofit).\n"
        "- budget_band must reflect only the scale implied by the facts (e.g. headcount, site "
        "count, a stated investment figure) — labels like unknown, small, medium, large. Never "
        "invent dollar totals.\n"
        "- icp_enhanced_score is an integer 0-10 judging fit from the supplied facts only "
        "(separate from any icp_score in the payload): weight an active buying signal highest, "
        "then industry fit, then a named decision-maker role.\n"
        "- Return ONLY a single JSON object (no markdown). Required keys exactly:\n"
        "  company_profile (string, 2-3 sentences),\n"
        "  active_projects (string, 2-3 sentences),\n"
        "  equipment_needs (string, 2-3 sentences),\n"
        "  budget_band (string),\n"
        "  equipment_tags (string, comma-separated),\n"
        "  icp_enhanced_score (number 0-10).\n"
    )


def _empty_research_extras() -> dict[str, str]:
    return {k: "" for k in RESEARCH_OUTPUT_FIELDS}


def _fallback_research(lead: dict[str, Any]) -> dict[str, str]:
    company = (lead.get("company") or "This organization").strip() or "This organization"
    website = (lead.get("website") or "").strip()
    sig = (lead.get("signal_evidence") or "").strip()
    cat = (lead.get("signal_category") or "").strip()
    title = (lead.get("job_title") or "").strip()
    site_note = f" Listed web presence: {website}." if website else ""

    profile = (
        f"{company} is surfaced as a lead based on available sourcing data.{site_note} "
        f"Decision-maker context includes role «{title or 'unknown'}». "
        f"Signal category noted as «{cat or 'unknown'}». "
        "No API key: set GEMINI_API_KEY or GOOGLE_API_KEY in the project `.env` "
        "(Google AI Studio). "
    )
    projects = (
        f"From the captured signal alone: {sig[:600]}{'…' if len(sig) > 600 else ''}. "
        "No additional project facts were inferred without AI."
        if sig
        else "Insufficient structured signal text to summarize initiatives."
    )
    equip = (
        "Given the school-athletics / prevention relevance from pipeline filters, likely angles "
        "include a grant-funded bulk planner order for the athletic program, a leadership or "
        "team-culture initiative, or county prevention program spend — confirm with account research."
        if cat or sig
        else "Insufficient detail for a program angle without AI or richer signals."
    )
    out = _empty_research_extras()
    out.update(
        {
            "company_profile": profile,
            "active_projects": projects,
            "equipment_needs": equip,
            "budget_band": "insufficient data",
            "equipment_tags": "",
            "icp_enhanced_score": "",
        }
    )
    return out


def _fallback_after_api_error(lead: dict[str, Any], hint: str) -> dict[str, str]:
    base = _fallback_research(lead)
    err_note = (hint or "unknown error")[:500]
    base["company_profile"] = (
        (lead.get("company") or "Company").strip()
        + ": AI research failed (Gemini error). "
        + err_note
        + " Retry later or check GEMINI_API_KEY / billing / rate limits."
    )
    return base


def _field_from_parsed(parsed: dict[str, Any], *keys: str) -> str:
    for key in keys:
        val = parsed.get(key)
        if val is None:
            continue
        s = str(val).strip()
        if s:
            return s
    return ""


def _normalize_research_parsed(parsed: dict[str, Any], lead: dict[str, Any]) -> dict[str, str]:
    out = _empty_research_extras()
    out["company_profile"] = _field_from_parsed(
        parsed, "company_profile", "profile", "companyProfile", "summary"
    )
    out["active_projects"] = _field_from_parsed(
        parsed, "active_projects", "activeProjects", "projects", "initiatives"
    )
    out["equipment_needs"] = _field_from_parsed(
        parsed, "equipment_needs", "equipmentNeeds", "equipment"
    )
    out["budget_band"] = _field_from_parsed(parsed, "budget_band", "budgetBand", "budget") or "unknown"
    out["equipment_tags"] = _field_from_parsed(
        parsed, "equipment_tags", "equipmentTags", "tags"
    )
    scored = parsed.get("icp_enhanced_score", parsed.get("icpEnhancedScore", parsed.get("icp_score")))
    if scored is not None and str(scored).strip() != "":
        try:
            v = float(scored)
            out["icp_enhanced_score"] = str(max(0, min(10, round(v))))
        except (TypeError, ValueError):
            out["icp_enhanced_score"] = str(scored).strip()

    if not out["company_profile"].strip():
        company = (lead.get("company") or "This company").strip()
        sig = (lead.get("signal_evidence") or "").strip()
        fallback = out["active_projects"] or out["equipment_needs"] or sig[:400]
        if fallback:
            out["company_profile"] = f"{company}: {fallback[:500]}"

    if not (out["company_profile"] or out["active_projects"] or out["equipment_needs"]).strip():
        raise ValueError("empty research fields")
    return out


def research_lead(lead: dict[str, Any]) -> dict[str, str]:
    api_key = get_llm_api_key()
    if not api_key:
        return _fallback_research(lead)

    facts = {
        "company": (lead.get("company") or "").strip(),
        "website": (lead.get("website") or "").strip(),
        "source": (lead.get("source") or "").strip(),
        "lead_source_bucket": (lead.get("lead_source_bucket") or "").strip(),
        "signal_category": (lead.get("signal_category") or "").strip(),
        "signal_evidence": ((lead.get("signal_evidence") or "")[:4000]),
        "person_name": (lead.get("person_name") or "").strip(),
        "job_title": (lead.get("job_title") or "").strip(),
        "location": (lead.get("location") or "").strip(),
        "enrollment": str(lead.get("enrollment", "") or ""),
        "industry_fit": str(lead.get("industry_fit", "") or ""),
        "icp_score": str(lead.get("icp_score", "") or ""),
        "icp_rationale": ((lead.get("icp_rationale") or "")[:2000]),
        "job_relevance": ((lead.get("job_relevance") or "")[:1500]),
    }
    user_text = json.dumps({"facts": facts}, ensure_ascii=False)
    try:
        content = gemini_generate_text(
            api_key=api_key,
            model=GEMINI_MODEL,
            system_instruction=_research_system(),
            user_text=user_text,
            temperature=0.35,
            timeout=120.0,
        )
        parsed = parse_json_object(content)
        return _normalize_research_parsed(parsed, lead)
    except (RuntimeError, KeyError, ValueError, json.JSONDecodeError, TypeError) as e:
        from config import llm_uses_openrouter
        from utils import pipeline_events

        pipeline_events.note_vendor_error(
            "OpenRouter" if llm_uses_openrouter() else "Gemini", e
        )
        return _fallback_after_api_error(lead, str(e))
