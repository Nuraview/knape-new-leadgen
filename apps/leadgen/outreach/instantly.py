"""Instantly API v2 — bulk add leads with custom variables for sequence templates."""

from __future__ import annotations

from typing import Any

from config import INSTANTLY_API_BASE, INSTANTLY_API_KEY
from utils.http import post_json


def bulk_add_leads(
    campaign_id: str,
    leads_payload: list[dict[str, Any]],
    *,
    verify_on_import: bool = False,
) -> dict[str, Any]:
    if not INSTANTLY_API_KEY:
        raise RuntimeError("INSTANTLY_API_KEY is not set")
    url = f"{INSTANTLY_API_BASE}/api/v2/leads/add"
    body: dict[str, Any] = {
        "campaign_id": campaign_id,
        "leads": leads_payload,
        "verify_leads_on_import": verify_on_import,
        "skip_if_in_workspace": False,
    }
    return post_json(
        url,
        {
            "Authorization": f"Bearer {INSTANTLY_API_KEY}",
            "Content-Type": "application/json",
        },
        body,
        timeout=120.0,
    )


def build_instantly_lead_row(
    email: str,
    lead: dict[str, Any],
    steps: list[dict[str, Any]],
) -> dict[str, Any]:
    """Map local lead + generated steps to Instantly bulk row + custom_variables."""
    fn = (lead.get("person_name") or "").strip().split()
    first = fn[0] if fn else ""
    last = " ".join(fn[1:]) if len(fn) > 1 else ""
    cv: dict[str, Any] = {
        "m2_company": lead.get("company", ""),
        "m2_signal": (lead.get("signal_evidence") or "")[:500],
        "m2_job_title": lead.get("job_title", ""),
        "m2_website": lead.get("website", ""),
        "m2_icp_score": str(lead.get("icp_score", "")),
        "m2_icp_enhanced": str(lead.get("icp_enhanced_score", "") or ""),
        "m2_budget_band": str(lead.get("budget_band", "") or ""),
        "m2_equipment_tags": str(lead.get("equipment_tags", "") or ""),
        "m2_email_verify_status": str(lead.get("email_verification_status", "") or ""),
        "m2_email_deliverability": str(lead.get("email_deliverability_score", "") or ""),
    }
    for i, st in enumerate(steps):
        n = i + 1
        cv[f"m2_step{n}_subject"] = st.get("subject", "")
        cv[f"m2_step{n}_body"] = st.get("body", "")
        cv[f"m2_step{n}_delay_days"] = st.get("delay_after_prev_days", 0)
    return {
        "email": email,
        "first_name": first or None,
        "last_name": last or None,
        "company_name": lead.get("company") or None,
        "job_title": lead.get("job_title") or None,
        "website": lead.get("website") or None,
        "personalization": (steps[0].get("body", "")[:400] if steps else "") or None,
        "custom_variables": cv,
    }
