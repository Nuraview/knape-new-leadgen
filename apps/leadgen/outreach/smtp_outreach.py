"""Optional Gmail / SMTP send for step 1 only (bulk follow-ups belong in Instantly)."""

from __future__ import annotations

import smtplib
from email.message import EmailMessage
from typing import Any

from config import (
    OUTREACH_FROM_EMAIL,
    OUTREACH_SENDER_NAME,
    OUTREACH_SMTP_HOST,
    OUTREACH_SMTP_PASSWORD,
    OUTREACH_SMTP_PORT,
    OUTREACH_SMTP_USER,
)


def smtp_configured() -> bool:
    return bool(
        OUTREACH_SMTP_HOST
        and OUTREACH_SMTP_USER
        and OUTREACH_SMTP_PASSWORD
        and OUTREACH_FROM_EMAIL
    )


def send_step1_smtp(to_email: str, subject: str, body: str) -> None:
    if not smtp_configured():
        raise RuntimeError("SMTP env vars incomplete — set OUTREACH_SMTP_* and OUTREACH_FROM_EMAIL")
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{OUTREACH_SENDER_NAME} <{OUTREACH_FROM_EMAIL}>"
    msg["To"] = to_email
    msg.set_content(body)
    with smtplib.SMTP(OUTREACH_SMTP_HOST, OUTREACH_SMTP_PORT) as smtp:
        smtp.starttls()
        smtp.login(OUTREACH_SMTP_USER, OUTREACH_SMTP_PASSWORD)
        smtp.send_message(msg)


def lead_step1_mail(lead: dict[str, Any], steps: list[dict[str, Any]]) -> dict[str, Any]:
    if not steps:
        raise ValueError("no steps")
    return {"to": lead.get("email", "").strip(), "subject": steps[0]["subject"], "body": steps[0]["body"]}
