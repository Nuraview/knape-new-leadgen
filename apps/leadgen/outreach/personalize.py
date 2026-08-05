from __future__ import annotations

import json
from typing import Any

from config import (
    GEMINI_MODEL,
    MILESTONE2_FOLLOWUP_GAP_DAYS,
    MILESTONE2_SEQUENCE_STEPS,
    OUTREACH_SENDER_NAME,
    OUTREACH_SUBDOMAIN,
)
from config import get_llm_api_key
from outreach import brand
from outreach.gemini_llm import gemini_generate_text, parse_json_object


def _first_name(person_name: str) -> str:
    person_name = (person_name or "").strip()
    if not person_name:
        return "there"
    return person_name.split()[0]


def _gaps_for_steps(n_steps: int) -> list[int]:
    # Dashboard setting wins over env/config (adjustable without a restart).
    try:
        from outreach.app_settings import get_setting

        raw_setting = str(get_setting("MILESTONE2_FOLLOWUP_GAP_DAYS") or MILESTONE2_FOLLOWUP_GAP_DAYS)
    except Exception:  # noqa: BLE001
        raw_setting = MILESTONE2_FOLLOWUP_GAP_DAYS
    raw = [x.strip() for x in raw_setting.split(",") if x.strip()]
    gaps = [int(x) for x in raw if x.isdigit()]
    while len(gaps) < max(0, n_steps - 1):
        gaps.append(3)
    return gaps[: max(0, n_steps - 1)]


def _template_sequence(lead: dict[str, Any], n_steps: int, angle: str | None = None) -> list[dict[str, Any]]:
    gaps = _gaps_for_steps(n_steps)
    # Angle-specific canonical copy (from outreach/messaging_angles.py) when an
    # angle is chosen; otherwise the default single sequence below.
    if angle:
        from outreach.messaging_angles import get_angle, render_angle_steps

        ang = get_angle(angle)
        if ang:
            rendered = render_angle_steps(ang, lead, OUTREACH_SENDER_NAME)
            steps: list[dict[str, Any]] = []
            for i in range(n_steps):
                base = rendered[i % len(rendered)]
                steps.append(
                    {
                        "subject": base["subject"],
                        "body": base["body"],
                        "delay_after_prev_days": 0 if i == 0 else gaps[i - 1],
                    }
                )
            return steps

    company = (lead.get("company") or "your team").strip()
    fn = _first_name(lead.get("person_name", ""))
    title = (lead.get("job_title") or "").strip()
    sig = (lead.get("signal_evidence") or "")[:220].strip()
    website = (lead.get("website") or "").strip()
    icp = str(lead.get("icp_score", "")).strip()
    sub_hint = f" ({OUTREACH_SUBDOMAIN})" if OUTREACH_SUBDOMAIN else ""

    gaps = _gaps_for_steps(n_steps)
    steps: list[dict[str, Any]] = []
    # Deliberately claim-free.
    #
    # This is the LAST-RESORT path: it runs when there is no AI key and no angle
    # template, so it has no idea what the business sells. The previous copy
    # solved that by naming one client's product, its price band, its buyers and
    # its grant-funding mechanism — so on any other instance the fallback sent
    # a confident, fully specific pitch for the wrong company.
    #
    # It now says only what is true from the lead row itself and asks a question.
    # Vaguer, and safe on every instance.
    who = brand.name()
    subjects = (
        f"{company} — quick question",
        f"Re: {company}",
        f"Last note on this",
    )
    bodies = (
        (
            f"Hi {fn},\n\n"
            f"I am with {who}. "
            f"{'I saw ' + sig[:160] + '. ' if sig else ''}"
            f"That is usually the point where it is worth a short conversation.\n\n"
            f"{'Reaching out to you given your role: ' + title + '. ' if title else ''}"
            f"Would a brief call be useful for {company}?\n\n"
            f"{OUTREACH_SENDER_NAME}{sub_hint}\n"
        ),
        (
            f"Hi {fn},\n\n"
            f"Following up on my note about {company}.\n\n"
            f"{'Context we saw: ' + sig[:180] + ('…' if len(sig) > 180 else '') + chr(10) + chr(10) if sig else ''}"
            f"If the timing is wrong, say so and I will leave it.\n\n"
            f"{OUTREACH_SENDER_NAME}\n"
        ),
        (
            f"Hi {fn},\n\n"
            f"Closing the loop. If this is not a fit for {company}, no problem at all. "
            f"If it is worth a look later, I am happy to be the person you call.\n\n"
            f"{OUTREACH_SENDER_NAME}\n"
        ),
    )
    from outreach.messaging_angles import dedash

    for i in range(n_steps):
        delay = 0 if i == 0 else gaps[i - 1]
        steps.append(
            {
                "subject": dedash(subjects[i % len(subjects)]),
                "body": dedash(bodies[i % len(bodies)]),
                "delay_after_prev_days": delay,
            }
        )
    return steps


def generate_sequence(lead: dict[str, Any]) -> list[dict[str, Any]]:
    n = max(2, min(5, MILESTONE2_SEQUENCE_STEPS))
    api_key = get_llm_api_key()
    if not api_key:
        return _template_sequence(lead, n)

    _brief = brand.business_brief()
    system = (
        f"You write concise B2B outreach for {brand.name()}. "
        + (
            f"{_brief} "
            if _brief
            else "You have NOT been told what the business sells, so name no product, "
                 "specification or price — write from the lead's own context only. "
        )
        + "Return ONLY valid JSON, no markdown. Top-level key: steps (array). "
        "Each step object: subject (string), body (plain text, short paragraphs), "
        "delay_after_prev_days (integer; 0 for the first step, then days after the previous send). "
        "Reference company, signal_evidence, job_title and person_name when present. Lead with the "
        "reader's own situation before anything you sell. "
        "No false claims, no pricing guarantees, warm professional tone."
    )
    user_text = json.dumps(
        {
            "required_step_count": n,
            "lead": dict(lead),
            "sender_name": OUTREACH_SENDER_NAME,
            "outreach_subdomain": OUTREACH_SUBDOMAIN or None,
        },
        default=str,
    )
    try:
        content = gemini_generate_text(
            api_key=api_key,
            model=GEMINI_MODEL,
            system_instruction=system,
            user_text=user_text,
            temperature=0.6,
            timeout=60.0,
        )
        parsed = parse_json_object(content)
        raw_steps = parsed.get("steps") or parsed
        if not isinstance(raw_steps, list):
            raise ValueError("missing steps array")
        out: list[dict[str, Any]] = []
        for i, st in enumerate(raw_steps[:n]):
            if not isinstance(st, dict):
                continue
            out.append(
                {
                    "subject": str(st.get("subject", "")).strip(),
                    "body": str(st.get("body", "")).strip(),
                    "delay_after_prev_days": int(st.get("delay_after_prev_days", 0 if i == 0 else 3)),
                }
            )
        if len(out) != n:
            out = _template_sequence(lead, n)
        return out[:n]
    except (RuntimeError, KeyError, ValueError, json.JSONDecodeError):
        return _template_sequence(lead, n)


def cockpit_preview_sequence(lead: dict[str, Any]) -> list[dict[str, Any]]:
    """Template-only steps for UI preview (no Gemini); same shape as ``generate_sequence``."""
    n = max(2, min(5, MILESTONE2_SEQUENCE_STEPS))
    return _template_sequence(lead, n)
