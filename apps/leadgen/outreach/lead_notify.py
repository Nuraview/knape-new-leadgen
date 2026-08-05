"""Transactional email for inbound website leads.

Deliberately separate from ``email_sender``: that module is built for cold
outreach and injects open-pixel tracking, click-redirects, an unsubscribe
footer and CTA parsing. None of that belongs on a confirmation someone asked
for, and mixing marketing machinery into transactional mail is what gets a
sending domain flagged.

Two emails go out per submission:
  * a notification to the sales inbox so a lead is acted on the same day
  * a plain acknowledgement to the prospect

Both are best-effort. A failure here must never break the form: the visitor
has already submitted it.

WHAT THE ACKNOWLEDGEMENT DELIBERATELY DOES NOT DO
-------------------------------------------------
It used to branch three ways on which landing page converted the visitor and
send back a different product pitch for each, one of which rendered and
attached a "Budget Justification Memorandum" PDF addressed to a school
superintendent, quoting a per-student cost and the federal grant programmes
that cover it.

That is one client's product, their buyer and their funding mechanism, hard
into a transactional email. On any other instance it was a confident, fully
formatted document about something the business does not sell, sent
automatically to a real prospect who had just handed over their address.

So the acknowledgement now says only what is true everywhere: we have it, a
person will reply. Anything product-specific belongs in a reply written by a
human, or in a per-instance template that does not exist yet.
"""

from __future__ import annotations

import html
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Any

from outreach import brand, db

#: Where a lead alert goes, and what a prospect's reply-to points at.
#:
#: The instance's own sending address, not a hardcoded mailbox. It used to name
#: one client's inbox — which on any other instance meant a prospect who replied
#: to a memo landed in a stranger's mailbox, and nothing local was watching.
#:
#: Whatever this resolves to must be a mailbox with IMAP configured, because it
#: is what the inbox agent triages. Override per instance from Settings.
def _notify_default() -> str:
    from outreach import brand

    return brand.sender_email()


def notify_to() -> str:
    """The reply-to address, overridable from Settings without a deploy."""
    try:
        from outreach.app_settings import get_setting

        return str(get_setting("LEAD_NOTIFY_TO") or "").strip() or _notify_default()
    except Exception:  # noqa: BLE001
        return _notify_default()
def sender_name() -> str:
    """How the sender signs off. Settings override, else the brand."""
    from outreach import brand

    try:
        from outreach.app_settings import get_setting

        override = str(get_setting("OUTREACH_SENDER_NAME") or "").strip()
        if override:
            return override
    except Exception:  # noqa: BLE001
        pass
    return brand.sender_name()


def SITE() -> str:
    return brand.site_url()


GOLD = brand.accent()
INK = brand.ink()
CHARCOAL = brand.ink()


def _inbox() -> dict[str, Any] | None:
    """Pick an enabled sending mailbox, preferring the one people reply to."""
    c = db.connect()
    try:
        rows = c.execute(
            """
            SELECT email, from_name, smtp_host, smtp_port, smtp_ssl, smtp_user, smtp_password
            FROM outreach_inboxes
            WHERE enabled = 1 AND smtp_host <> '' AND smtp_password <> ''
            ORDER BY (email = ?) DESC, id ASC
            LIMIT 1
            """,
            (notify_to(),),
        ).fetchall()
        return dict(rows[0]) if rows else None
    finally:
        c.close()


def _send(inbox: dict[str, Any], to_email: str, subject: str, text: str, html_body: str,
          reply_to: str = "", attachments: list[tuple[str, bytes]] | None = None) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((inbox.get("from_name") or brand.name(), inbox["email"]))
    msg["To"] = to_email
    # Domain taken from the sending address: a Message-ID whose domain does not
    # match the envelope sender is a DMARC alignment smell.
    _dom = (inbox.get("email") or "@localhost").split("@")[-1]
    msg["Message-ID"] = make_msgid(domain=_dom)
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")
    for filename, blob in attachments or []:
        msg.add_attachment(blob, maintype="application", subtype="pdf", filename=filename)

    port = int(inbox.get("smtp_port") or 465)
    use_ssl = bool(inbox.get("smtp_ssl", 1)) or port == 465
    host = inbox["smtp_host"]
    user = inbox.get("smtp_user") or inbox["email"]
    ctx = ssl.create_default_context()
    if use_ssl:
        with smtplib.SMTP_SSL(host, port, timeout=20, context=ctx) as s:
            s.login(user, inbox["smtp_password"])
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=20) as s:
            s.ehlo()
            s.starttls(context=ctx)
            s.login(user, inbox["smtp_password"])
            s.send_message(msg)


def _shell(inner: str) -> str:
    return (
        f'<div style="margin:0;padding:24px;background:#f4f4f6;'
        f'font-family:Segoe UI,Helvetica,Arial,sans-serif;">'
        f'<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;'
        f'overflow:hidden;border:1px solid #e4e4e8;">'
        f'<div style="background:{CHARCOAL};padding:20px 28px;">'
        f'<span style="color:#ffffff;font-size:18px;letter-spacing:.14em;">'
        f'{html.escape(brand.name().upper())}</span>'
        f'</div><div style="padding:28px;color:{INK};font-size:15px;line-height:1.6;">{inner}</div>'
        f'</div></div>'
    )


def _btn(url: str, label: str) -> str:
    return (
        f'<p style="margin:0 0 20px;"><a href="{url}" '
        f'style="background:{GOLD};color:{INK};text-decoration:none;padding:12px 24px;'
        f'border-radius:999px;font-weight:600;display:inline-block;">{label}</a></p>'
    )


def _row(label: str, value: str) -> str:
    if not value:
        return ""
    return (
        f'<tr><td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;">{html.escape(label)}</td>'
        f'<td style="padding:6px 0;font-weight:600;">{html.escape(value)}</td></tr>'
    )


def notify(lead: dict[str, Any]) -> None:
    """Send the internal alert and the prospect confirmation. Never raises."""
    inbox = None
    try:
        inbox = _inbox()
    except Exception as e:  # noqa: BLE001
        print(f"lead_notify: inbox lookup failed: {e}", flush=True)
    if not inbox:
        print("lead_notify: no enabled sending inbox — emails skipped", flush=True)
        return

    name = (lead.get("name") or "").strip()
    email = (lead.get("email") or "").strip()
    school = (lead.get("school") or "").strip()
    role = (lead.get("role") or "").strip()
    phone = (lead.get("phone") or "").strip()
    students = (lead.get("students_count") or "").strip()
    school_type = (lead.get("school_type") or "").strip()
    notes = (lead.get("notes") or "").strip()
    source = (lead.get("source") or "").strip()
    grant = "Yes" if lead.get("grant_interest") else "No"

    # ---- 1. internal alert -------------------------------------------------
    try:
        rows = "".join([
            _row("Name", name), _row("Email", email), _row("Phone", phone),
            _row("School", school), _row("Role", role),
            _row("Students", students), _row("School type", school_type),
            _row("Grant help", grant), _row("Page", source),
        ])
        note_html = (
            f'<p style="margin:18px 0 0;padding:12px 14px;background:#faf7ee;'
            f'border-left:3px solid {GOLD};white-space:pre-wrap;">{html.escape(notes)}</p>'
            if notes else ""
        )
        inner = (
            f'<p style="margin:0 0 14px;font-size:17px;font-weight:600;">New sample request</p>'
            f'<table style="border-collapse:collapse;font-size:14px;">{rows}</table>'
            f'{note_html}'
            f'<p style="margin:22px 0 0;"><a href="mailto:{html.escape(email)}" '
            f'style="background:{GOLD};color:{INK};text-decoration:none;padding:10px 20px;'
            f'border-radius:999px;font-weight:600;">Reply to {html.escape(name or email)}</a></p>'
        )
        text = "New sample request\n\n" + "\n".join(
            f"{k}: {v}" for k, v in (
                ("Name", name), ("Email", email), ("Phone", phone), ("School", school),
                ("Role", role), ("Students", students), ("School type", school_type),
                ("Grant help", grant), ("Page", source), ("Notes", notes),
            ) if v
        )
        _send(inbox, notify_to(), f"New sample request — {name or email}"
              + (f" ({school})" if school else ""), text, _shell(inner), reply_to=email)
    except Exception as e:  # noqa: BLE001
        print(f"lead_notify: internal alert failed: {e}", flush=True)

    # ---- 2. acknowledgement to the prospect --------------------------------
    #
    # One message, no branching, no attachment, no product claim. See the module
    # docstring for what used to be here and why it could not stay.
    try:
        first = name.split()[0] if name else "there"
        signer = sender_name()
        who = brand.name()

        text = (
            f"Hi {first},\n\n"
            f"Thanks for getting in touch with {who}. Your enquiry has come through and "
            f"a member of the team will reply personally, usually within one working day.\n\n"
            f"If it is easier to talk it through, just reply to this email and we will "
            f"arrange a time.\n\n"
            f"{signer}\n{who}\n"
        )
        subject = f"Thanks for contacting {who}"

        # Rendered through the same template as the rest of the outbound mail.
        # This is the one message a warm lead actually reads, and it used to be
        # the least branded thing sent from the address: a bare white box with a
        # text wordmark, while every cold email carried the full design.
        try:
            from outreach.email_sender import _body_to_html

            html_body = _body_to_html(text, from_email=inbox.get("email", ""), from_name=signer)
        except Exception as e:  # noqa: BLE001 — never lose the email over its styling
            print(f"lead_notify: branded render failed, falling back: {e}", flush=True)
            html_body = _shell(f'<p style="margin:0 0 14px;">{html.escape(text)}</p>')

        # The plain-text alternative needs the same scrub _body_to_html does for
        # the HTML part, or a text-only client gets the version with the dashes.
        from outreach.messaging_angles import dedash

        _send(inbox, email, dedash(subject), dedash(text), html_body, reply_to=notify_to())
    except Exception as e:  # noqa: BLE001
        print(f"lead_notify: acknowledgement to {email} failed: {e}", flush=True)
