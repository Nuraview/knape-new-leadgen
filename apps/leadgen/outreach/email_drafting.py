"""AI email-sequence drafting via OpenAI (gpt-5.4-mini by default).

Produces the first email + scheduled follow-ups from a lead's context. Falls
back to the deterministic template sequence (``personalize._template_sequence``)
if OpenAI is unavailable, so the Send flow always has copy to work with.
"""

from __future__ import annotations

import json
from typing import Any

from config import (
    MILESTONE2_FOLLOWUP_GAP_DAYS,
    MILESTONE2_SEQUENCE_STEPS,
    OUTREACH_FROM_NAME,
    OUTREACH_SENDER_NAME,
    OPENAI_MODEL,
    get_openai_api_key,
)
from outreach import brand
from outreach.openai_llm import OpenAIError, openai_generate_text, parse_json_object
from outreach.personalize import _gaps_for_steps, _template_sequence


def _coerce_steps(raw_steps: Any, n: int, gaps: list[int]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if isinstance(raw_steps, list):
        for i, st in enumerate(raw_steps[:n]):
            if not isinstance(st, dict):
                continue
            default_delay = 0 if i == 0 else (gaps[i - 1] if i - 1 < len(gaps) else 3)
            try:
                delay = int(st.get("delay_after_prev_days", default_delay))
            except (TypeError, ValueError):
                delay = default_delay
            from outreach.messaging_angles import dedash

            out.append(
                {
                    "subject": dedash(str(st.get("subject", "")).strip()),
                    "body": dedash(str(st.get("body", "")).strip()),
                    "delay_after_prev_days": 0 if i == 0 else max(0, delay),
                }
            )
    return out


def draft_email_sequence(
    lead: dict[str, Any], angle: str | None = None
) -> tuple[list[dict[str, Any]], str]:
    """Return (steps, provider). provider is 'openai' or 'template'.

    Each step: ``{subject, body, delay_after_prev_days}`` (step 0 delay = 0).
    When ``angle`` is given, the copy is written in that messaging angle's voice
    and always carries its value-add link (falls back to that angle's canonical
    template copy if OpenAI is unavailable).
    """
    # Dashboard settings win over env/config (adjustable without a restart).
    try:
        from outreach.app_settings import get_setting

        steps_setting = int(get_setting("MILESTONE2_SEQUENCE_STEPS") or MILESTONE2_SEQUENCE_STEPS)
        sender_setting = str(get_setting("OUTREACH_SENDER_NAME") or "")
    except Exception:  # noqa: BLE001
        steps_setting, sender_setting = MILESTONE2_SEQUENCE_STEPS, ""
    n = max(2, min(5, steps_setting))
    gaps = _gaps_for_steps(n)
    api_key = get_openai_api_key()
    if not api_key:
        return _template_sequence(lead, n, angle), "template"

    sender = sender_setting or OUTREACH_FROM_NAME or OUTREACH_SENDER_NAME

    angle_brief = ""
    style_ref = ""
    from outreach.messaging_angles import HOUSE_STYLE
    if angle:
        from outreach.messaging_angles import angle_prompt_brief, angle_reference_block, get_angle

        ang = get_angle(angle)
        if ang:
            angle_brief = " " + angle_prompt_brief(ang)
            style_ref = "\n\n" + angle_reference_block(ang, sender)

    # The business description is CONFIGURATION, not a literal. Hardcoded, this
    # prompt told every instance's model it was selling one specific client's
    # product, and the drafts came back fluent, specific and about the wrong
    # company. Empty, the model is told plainly that it does not know the
    # product, which produces cautious copy instead of confident fiction.
    _brief = brand.business_brief()
    _audience = brand.audience_brief()
    _what = (
        f"You write concise, human B2B cold outreach for {brand.name()}. {_brief} "
        if _brief
        else (
            f"You write concise, human B2B cold outreach for {brand.name()}. You have NOT been "
            "told what the business sells, so do not name a product, a specification, a price or "
            "a customer. Write only from the lead's own context and the angle you are given. "
        )
    )
    system = (
        _what
        + (f"{_audience} " if _audience else "")
        + "You are given ONE lead's research context. Write a sequence of emails: the first touch "
        "plus follow-ups. Use the company name, the buying signal, the angle, role, and person "
        "name when present. Be specific to THIS lead — no generic filler, no fake claims, no "
        "pricing promises. Lead with the reader's own situation before anything you sell. "
        f"Sign every email on its own final line as: {sender}.\n\n"
        + HOUSE_STYLE
        + "\n\n"
        "Return ONLY a JSON object: {\"steps\": [{\"subject\": str, \"body\": str, "
        "\"delay_after_prev_days\": int}]}. First step delay_after_prev_days = 0; later steps are "
        "days after the previous send. Follow-ups must add new angles, not just 'bumping this up'."
        + angle_brief
        + style_ref
    )
    user_text = json.dumps(
        {
            "required_step_count": n,
            "suggested_followup_gaps_days": gaps,
            "lead": {
                k: lead.get(k)
                for k in (
                    "company",
                    "person_name",
                    "job_title",
                    "website",
                    "industry",
                    "signal_category",
                    "signal_evidence",
                    "equipment_needs",
                    "company_profile",
                    "active_projects",
                    "icp_score",
                )
                if lead.get(k)
            },
            "sender_name": sender,
        },
        default=str,
    )
    try:
        content = openai_generate_text(
            system_instruction=system,
            user_text=user_text,
            model=OPENAI_MODEL,
            temperature=0.7,
            timeout=90.0,
            api_key=api_key,
        )
        parsed = parse_json_object(content)
        steps = _coerce_steps(parsed.get("steps") or parsed, n, gaps)
        if len(steps) >= 2 and all(s["subject"] and s["body"] for s in steps):
            # The model is told to include the value link in every step. It does
            # not always, and this check used to be "subject and body are
            # non-empty" — which a follow-up with no call to action passes. So
            # the link is guaranteed here rather than hoped for, and any URL the
            # model invented is rewritten to an approved page on the way past.
            from outreach.messaging_angles import ensure_value_link

            for s in steps:
                s["body"] = ensure_value_link(s["body"], angle or "")
            return steps[:n], "openai"
    except (OpenAIError, ValueError, KeyError, json.JSONDecodeError):
        pass
    return _template_sequence(lead, n, angle), "template"


def followup_gap_days() -> list[int]:
    raw = [x.strip() for x in MILESTONE2_FOLLOWUP_GAP_DAYS.split(",") if x.strip()]
    return [int(x) for x in raw if x.isdigit()]
