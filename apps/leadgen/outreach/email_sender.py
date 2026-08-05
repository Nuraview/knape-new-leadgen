"""SMTP sender for outreach emails (implicit-SSL :465 or STARTTLS :587).

Also appends each sent message to the IMAP "Sent" mailbox so the in-app inbox
and any other mail client show a faithful record.
"""

from __future__ import annotations

import html as _html
import imaplib
import os
import re
import smtplib
import ssl
import time
from email.message import EmailMessage
from pathlib import Path
from email.utils import formataddr, formatdate, make_msgid

from outreach import brand
from outreach.messaging_angles import LINK_PROGRAM, enforce_approved_links

from config import (
    OUTREACH_FROM_EMAIL,
    OUTREACH_FROM_NAME,
    OUTREACH_IMAP_HOST,
    OUTREACH_IMAP_PORT,
    OUTREACH_SMTP_HOST,
    OUTREACH_SMTP_PASSWORD,
    OUTREACH_SMTP_PORT,
    OUTREACH_SMTP_SSL,
    OUTREACH_SMTP_USER,
)


class EmailSendError(RuntimeError):
    pass


def smtp_configured() -> bool:
    return bool(OUTREACH_SMTP_HOST and OUTREACH_SMTP_USER and OUTREACH_SMTP_PASSWORD)


def _smtp_params(inbox: dict | None) -> dict:
    """Resolve connection params from an inbox dict, else the global config."""
    if inbox:
        port = int(inbox.get("smtp_port") or 465)
        return {
            "host": inbox.get("smtp_host") or OUTREACH_SMTP_HOST,
            "port": port,
            "ssl": bool(inbox.get("smtp_ssl", 1)) or port == 465,
            "user": inbox.get("smtp_user") or inbox.get("email"),
            "password": inbox.get("smtp_password"),
            "from_email": inbox.get("email"),
            "from_name": inbox.get("from_name") or OUTREACH_FROM_NAME or "",
            "imap_host": inbox.get("imap_host") or inbox.get("smtp_host") or OUTREACH_IMAP_HOST,
            "imap_port": int(inbox.get("imap_port") or 993),
        }
    return {
        "host": OUTREACH_SMTP_HOST, "port": OUTREACH_SMTP_PORT, "ssl": OUTREACH_SMTP_SSL,
        "user": OUTREACH_SMTP_USER, "password": OUTREACH_SMTP_PASSWORD,
        "from_email": OUTREACH_FROM_EMAIL or OUTREACH_SMTP_USER, "from_name": OUTREACH_FROM_NAME or "",
        "imap_host": OUTREACH_IMAP_HOST, "imap_port": OUTREACH_IMAP_PORT,
    }


def _looks_like_signature(block: str) -> bool:
    """A short, non-sentence last block (e.g. a person's name) = the sign-off."""
    return (
        len(block) <= 60
        and "\n" not in block
        and block.count(" ") <= 4
        and not block.endswith((".", "?", "!", ":"))
    )


_FONT = (
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
)

# Frame 1: header band with the brand lockup, light body with a big greeting
# heading, optional per-angle creative banner, accent rule, signature, optional
# serif quote + accent CTA pill, dark footer with socials + fine print.
#
# The images are served by this service's own /static mount, so the default has
# to be THIS instance's public base. It used to default to another client's
# host, which meant an unconfigured instance hotlinked their header into its own
# mail and would have broken the moment they took it down.
EMAIL_ASSET_BASE = os.getenv(
    "EMAIL_ASSET_BASE",
    (os.getenv("COCKPIT_PUBLIC_BASE") or "").rstrip("/") + "/static/email",
).rstrip("/")


def _creative_url(angle_key: str, step_index: int) -> str:
    """Absolute URL of the designed creative for this angle+day, if one exists.

    Creatives are delivered per angle/day (``angle_3_day_1.gif``); coverage is
    partial, so emails without one simply render without a banner.
    """
    if not angle_key or step_index < 0:
        return ""
    try:
        from outreach.messaging_angles import ANGLES

        nums = {a["key"]: i + 1 for i, a in enumerate(ANGLES)}
        n = nums.get(angle_key)
        if not n:
            return ""
        base = Path(__file__).resolve().parent / "static" / "email" / "creatives"
        for ext in ("png", "gif"):
            if (base / f"angle_{n}_day_{step_index}.{ext}").is_file():
                return f"{EMAIL_ASSET_BASE}/creatives/angle_{n}_day_{step_index}.{ext}"
    except Exception:  # noqa: BLE001 — a missing creative never blocks a send
        pass
    return ""


def _template_variant() -> str:
    """Which of the two client-approved designs to send: ``frame1`` (photo
    header, light footer) or ``frame2`` (flat header, cream creative band, dark
    bottom card — the designer's hand-built HTML). Dashboard setting wins."""
    try:
        from outreach.app_settings import get_setting

        v = str(get_setting("EMAIL_TEMPLATE_VARIANT") or "").strip().lower()
        return "frame2" if v in ("frame2", "2", "b") else "frame1"
    except Exception:  # noqa: BLE001
        return "frame1"


def _split_greeting(blocks: list[str]) -> tuple[str, list[str]]:
    """Pull the salutation off the copy so it renders as the design's big
    heading ("Hello!" in the Figma; personalized "Hi Jordan!" for us)."""
    if blocks:
        m = re.match(r"^(hi|hey|hello)\b[ ,]*([^\n,!.]*)[,!.]?\s*\n?(.*)$", blocks[0], re.IGNORECASE | re.DOTALL)
        if m:
            name = (m.group(2) or "").strip()
            heading = f"Hi {name}!" if name and name.lower() != "there" else "Hello!"
            rest = (m.group(3) or "").strip()
            remaining = ([rest] if rest else []) + blocks[1:]
            return heading, remaining
    return "Hello!", blocks
#: The footer icon row, built from whatever the brand actually has.
#:
#: Was a fixed list of one client's profiles, including an "Instagram" icon that
#: pointed at their website. The label was a lie and it was the single
#: most-clicked link in the whole programme, all of it landing somewhere with
#: nothing to act on. Anything the brand does not declare is now simply not
#: rendered, rather than falling back to somebody else's profile.
def _socials() -> list[tuple[str, str, str]]:
    icons = {"LinkedIn": "ic-linkedin.png"}
    out = []
    for label, url in brand.socials():
        icon = icons.get(label)
        if icon:
            out.append((icon, label, url))
    return out


#: An optional pull-quote above the call to action. Empty unless the instance
#: sets one — a generic aphorism in a cold email reads worse than no aphorism.
_QUOTE = (os.getenv("OUTREACH_EMAIL_QUOTE") or "").strip()


def _extract_cta(body: str) -> tuple[str, str, str]:
    """Pull the copy's one ``Label: URL`` line out of the body.

    Returns ``(label, url, body_without_that_line)``. Falls back to the first
    bare URL (label "Download Now"), else empty strings with the body untouched.
    """
    lines = (body or "").split("\n")
    for i, ln in enumerate(lines):
        m = re.match(r"^\s*([^:\n]{2,60}):\s*(https?://\S+)\s*$", ln)
        if m:
            rest = "\n".join(lines[:i] + lines[i + 1:])
            return m.group(1).strip(), m.group(2).strip(), re.sub(r"\n{3,}", "\n\n", rest).strip()
    m2 = re.search(r"https?://\S+", body or "")
    if m2:
        cleaned = (body or "").replace(m2.group(0), "").strip()
        return "Download Now", m2.group(0).rstrip(".,)"), re.sub(r"\n{3,}", "\n\n", cleaned)
    return "", "", (body or "").strip()


def _initials(name: str) -> str:
    parts = [p for p in re.split(r"\s+", name.strip()) if p]
    if not parts:
        return "--"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()


def _strip_body_links(body: str) -> str:
    """Remove every URL from the message body so the email carries NO in-body
    links — the only clickable CTA is the footer website button. A "Label: URL"
    call-to-action line is dropped whole; a URL sitting inside prose is cut out
    and the surrounding sentence kept."""
    out_lines: list[str] = []
    for ln in (body or "").split("\n"):
        if not re.search(r"https?://", ln):
            out_lines.append(ln)
            continue
        # Outreach URLs live on their own "Label: URL" CTA line — drop the whole
        # line. Only keep a line if it's a real sentence that merely happens to
        # end with a link (long remainder that isn't just a CTA label).
        stripped = re.sub(r"\S*https?://\S+", "", ln).strip(" -–—:·|")
        low = stripped.lower()
        cta_tail = low.endswith(("here", "at", "link", "below", "this", "it", "out"))
        if len(stripped) < 25 or cta_tail or ":" in ln.split("http")[0][-3:]:
            continue
        out_lines.append(stripped)
    cleaned = re.sub(r"\n{3,}", "\n\n", "\n".join(out_lines)).strip()
    return cleaned


_EFONT = "Arial,Helvetica,sans-serif"
# Read from the brand rather than fixed: these are the button, the rules and the
# header band of every email this system sends, and hardcoding them shipped one
# client's gold-on-charcoal to every other client's prospects.
_GOLD = brand.accent()
_GOLD_FG = brand.accent_foreground()
_INK = brand.ink()


def _sender_name() -> str:
    """Who signs the mail. Read, not hardcoded.

    The signature card used to carry one client's name on every email this
    system sent, including the ones whose plain-text sign-off said something
    else, so a single message contradicted itself.

    Settings override first (an operator can change it without a deploy), then
    the brand.
    """
    try:
        from outreach.app_settings import get_setting

        override = str(get_setting("OUTREACH_SENDER_NAME") or "").strip()
        if override:
            return override
    except Exception:  # noqa: BLE001
        pass
    return brand.sender_name()


def _sig_block(A: str, reply: str, center: bool) -> str:
    """Signature row (photo + name/title/email). Frame 1 left-aligns it;
    Frame 2 centers the whole block."""
    who = _html.escape(_sender_name())
    title = _html.escape(brand.sender_title())
    wrap_open = ('<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>'
                 if center else '<table role="presentation" cellpadding="0" cellspacing="0"><tr>')

    # A photo if the brand has one, otherwise an initials disc in the accent.
    # The old code pointed at a fixed dan.png on the asset host, so an instance
    # with no photo of its own put another client's face in its signature.
    photo = brand.photo_url()
    if photo:
        avatar = (
            f'<img src="{_html.escape(photo)}" width="56" height="56" alt="{who}" '
            'style="display:block;width:56px;height:56px;border-radius:50%;border:0;" />'
        )
    else:
        avatar = (
            f'<div style="width:56px;height:56px;border-radius:50%;background:{_GOLD};'
            f'color:{_GOLD_FG};font-family:{_EFONT};font-size:20px;font-weight:bold;'
            'line-height:56px;text-align:center;">'
            f'{_html.escape(_initials(_sender_name()))}</div>'
        )

    return (
        wrap_open
        + f'<td valign="middle" width="66">{avatar}</td>'
        + f'<td valign="middle" style="padding-left:12px;text-align:left;font-family:{_EFONT};">'
        + f'<div style="font-size:18px;font-weight:bold;color:{_INK};">{who}</div>'
        + f'<div style="font-size:13px;color:{_INK};">{title}</div>'
        + f'<div style="font-size:12px;color:#555;">{reply}</div>'
        + "</td></tr></table>"
    )


def _footer_block(A: str, reply: str) -> str:
    icons = "".join(
        f'<a href="{url}" target="_blank" style="text-decoration:none;">'
        f'<img src="{A}/{icon}" width="24" height="24" alt="{name}" '
        'style="display:inline-block;border:0;border-radius:50%;margin:0 4px;" /></a>'
        for icon, name, url in _socials()
    )
    return (
        f'<tr><td align="center" style="background:{_INK};padding:30px 24px 34px;">'
        f'<div style="margin-bottom:16px;">{icons}</div>'
        f'<div style="font-family:{_EFONT};font-size:11px;line-height:1.7;color:#cfcfcf;">'
        f"You received this email because you requested information from {_html.escape(brand.name())}. "
        f'If you no longer wish to receive these emails, <a href="mailto:{reply}?subject=Unsubscribe" '
        'style="color:#ffffff;text-decoration:underline;">unsubscribe here.</a></div>'
        "</td></tr>"
    )


def _quote_cta(cta_label: str, cta_url: str) -> str:
    """Centered serif quote + gold rounded Download pill."""
    if not cta_url:
        return (
            '<div style="text-align:center;margin:30px 0 6px;">'
            f'<div style="font-family:Georgia,serif;font-style:italic;font-weight:bold;'
            f'font-size:20px;line-height:1.45;color:{_INK};">&ldquo;{_QUOTE}&rdquo;</div></div>'
        )
    return (
        '<div style="text-align:center;margin:30px 0 6px;">'
        f'<div style="font-family:Georgia,serif;font-style:italic;font-weight:bold;'
        f'font-size:20px;line-height:1.45;color:{_INK};margin-bottom:20px;">&ldquo;{_QUOTE}&rdquo;</div>'
        f'<a href="{_html.escape(cta_url)}" target="_blank" '
        f'style="display:inline-block;background:{_GOLD};color:{_GOLD_FG};font-family:{_EFONT};'
        'font-size:17px;font-weight:bold;text-decoration:none;padding:14px 40px;'
        'border-radius:24px;box-shadow:0 4px 10px rgba(0,0,0,0.28);">'
        f'{_html.escape(cta_label or "Download Now")}</a>'
        "</div>"
    )


def _body_to_html_v2(
    body: str, from_email: str = "", from_name: str = "", angle: str = "", step_index: int = -1
) -> str:
    """Variant "frame2" (Figma Frame 2): flat dark header with the brand lockup,
    CENTERED greeting + copy, the serif quote + gold Download pill sitting in the
    MIDDLE of the copy, gold rule, centered signature, dark footer."""
    A = EMAIL_ASSET_BASE
    reply = _html.escape(from_email or brand.sender_email())

    cta_label, cta_url, body_wo_cta = _extract_cta(body)
    blocks = [b.strip() for b in re.split(r"\n\s*\n", body_wo_cta.strip()) if b.strip()]
    if len(blocks) > 1 and _looks_like_signature(blocks[-1]):
        blocks.pop()
    heading, blocks = _split_greeting(blocks)

    def _p(b: str) -> str:
        return (
            f'<p style="margin:0 0 18px;font-family:{_EFONT};font-size:16px;font-weight:400;'
            f'line-height:1.7;color:#1a1a1a;">' + _html.escape(b).replace("\n", "<br>") + "</p>"
        )

    mid = (len(blocks) + 1) // 2  # quote + button drop into the middle of the copy
    first = "".join(_p(b) for b in blocks[:mid])
    second = "".join(_p(b) for b in blocks[mid:])

    return (
        '<!DOCTYPE html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
        f'<body style="margin:0;padding:0;background:{_INK};">'
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:{_INK};">'
        '<tr><td align="center">'
        '<table role="presentation" width="600" cellspacing="0" cellpadding="0" '
        f'style="width:600px;max-width:600px;background:#f5f5f5;font-family:{_EFONT};">'
        f'<tr><td style="padding:0;font-size:0;line-height:0;background:{_INK};">'
        f'<img src="{A}/header2.png" width="600" alt="{_html.escape(brand.name())}" '
        'style="display:block;width:100%;max-width:600px;height:auto;border:0;" /></td></tr>'
        '<tr><td style="padding:42px 46px 36px;text-align:center;">'
        f'<h1 style="margin:0 0 24px;font-family:{_EFONT};font-size:40px;font-weight:800;'
        f'color:#000;line-height:1;">{_html.escape(heading)}</h1>'
        f"{first}{_quote_cta(cta_label, cta_url)}{second}"
        f'<hr style="border:none;border-top:2px solid {_GOLD};margin:34px 0" />'
        f"{_sig_block(A, reply, center=True)}"
        "</td></tr>"
        f"{_footer_block(A, reply)}"
        "</table></td></tr></table></body></html>"
    )


def _body_to_html(
    body: str,
    from_email: str = "",
    from_name: str = "",
    angle: str = "",
    step_index: int = -1,
    variant: str | None = None,
) -> str:
    """Render the outreach copy in the client's final Figma design (Frame 1):
    photo header with the horizontal brand lockup ("
    Purpose"), light body with a big greeting heading, optional per-angle
    designed creative, accent rule + signature, centered serif quote +
    gold Download pill, dark #232323 footer with socials + fine print.
    Email-safe: tables + inline styles, absolute HTTPS assets, 639px card.

    Dispatches to variant "frame2" (the designer's hand-built layout) when the
    dashboard's Email design variant setting says so.
    """
    # `variant` overrides the dashboard setting, for previewing only.
    #
    # Both Figma designs were approved and only one can be live at a time, so
    # the other was unreachable — invisible in the dashboard and impossible to
    # compare against the one being sent. Sending still follows the setting;
    # this argument exists so the preview can show either.
    # Em and en dashes, gone, on every path into an email.
    #
    # messaging_angles.dedash() has scrubbed them out of the templates since the
    # client asked, but only the templates. The AI drafter writes them freely,
    # the landing-page confirmations were never passed through it at all, and
    # one arrived reading "move it along , just reply". A dash is the single
    # clearest tell that copy was machine-written, which is the whole reason
    # the rule exists, so it is enforced where every body converges instead of
    # in each of the three places that produce one.
    from outreach.messaging_angles import dedash

    body = dedash(body or "")

    chosen = (variant or "").strip().lower() or _template_variant()
    if chosen in ("frame2", "2", "b"):
        return _body_to_html_v2(body, from_email, from_name, angle=angle, step_index=step_index)
    A = EMAIL_ASSET_BASE
    reply = _html.escape(from_email or brand.sender_email())

    cta_label, cta_url, body_wo_cta = _extract_cta(body)
    blocks = [b.strip() for b in re.split(r"\n\s*\n", body_wo_cta.strip()) if b.strip()]
    if len(blocks) > 1 and _looks_like_signature(blocks[-1]):
        blocks.pop()
    heading, blocks = _split_greeting(blocks)

    def _para(b: str) -> str:
        return (
            f'<p style="margin:0 0 18px;font-family:{_EFONT};font-size:16px;font-weight:400;'
            f'line-height:1.7;color:#1a1a1a;">' + _html.escape(b).replace("\n", "<br>") + "</p>"
        )

    paras = "".join(_para(b) for b in blocks) or "<p></p>"

    # Photo header + brand lockup, baked into ONE image so Gmail (which strips
    # CSS background images on <td>) still shows the athlete photo behind the
    # the brand wordmark.
    header = (
        f'<tr><td style="padding:0;font-size:0;line-height:0;background:{_INK};">'
        f'<img src="{A}/header1.png" width="600" alt="{_html.escape(brand.name())}" '
        'style="display:block;width:100%;max-width:600px;height:auto;border:0;" /></td></tr>'
    )

    return (
        '<!DOCTYPE html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
        '<body style="margin:0;padding:0;background:#e9e9e9;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="background:#e9e9e9;"><tr><td align="center" style="padding:22px 10px;">'
        '<table role="presentation" cellpadding="0" cellspacing="0" width="600" '
        'style="width:100%;max-width:600px;background:#f5f5f5;">'
        f"{header}"
        '<tr><td style="padding:40px 48px 36px;text-align:left;">'
        f'<h1 style="margin:0 0 26px;font-family:{_EFONT};font-size:42px;font-weight:800;'
        f'color:#000;line-height:1;">{_html.escape(heading)}</h1>'
        f"{paras}"
        f'<hr style="border:none;border-top:2px solid {_GOLD};margin:32px 0 26px" />'
        f"{_sig_block(A, reply, center=False)}"
        f"{_quote_cta(cta_label, cta_url)}"
        "</td></tr>"
        f"{_footer_block(A, reply)}"
        "</table></td></tr></table></body></html>"
    )


def _apply_tracking(html: str, token: str) -> str:
    """Rewrite links through the click-redirect and append the open pixel.

    All http(s) ``href``s route through ``/t/c/{token}?u=<enc>`` (mailto: links
    left alone), and a 1x1 pixel hits ``/t/o/{token}`` when the mail app renders
    the email. Needs ``OUTREACH_TRACK_BASE_URL`` set — otherwise a no-op so
    sending still works before tracking is wired.
    """
    from urllib.parse import quote

    from config import OUTREACH_TRACK_BASE_URL as base
    if not (token and base):
        return html

    # Track our own website clicks; leave social/profile links direct (trust +
    # they aren't part of the campaign CTA).
    _skip = ("linkedin.com", "facebook.com", "icons8.com", "twitter.com", "instagram.com")

    def _repl(m: "re.Match[str]") -> str:
        url = m.group(1)
        if any(d in url.lower() for d in _skip):
            return m.group(0)
        return f'href="{base}/t/c/{token}?u={quote(url, safe="")}"'

    html = re.sub(r'href="(https?://[^"]+)"', _repl, html)
    pixel = (
        f'<img src="{base}/t/o/{token}" width="1" height="1" alt="" '
        'style="display:block;width:1px;height:1px;border:0;opacity:0;overflow:hidden;" />'
    )
    if "</body>" in html:
        return html.replace("</body>", pixel + "</body>", 1)
    return html + pixel


def _build_message(
    *, to_email: str, subject: str, body: str, from_email: str, from_name: str,
    in_reply_to: str = "", references: str = "", track_token: str = "",
    angle: str = "", step_index: int = -1
) -> EmailMessage:
    from outreach.messaging_angles import dedash

    # Hard backstop: no em/en dashes ever leave, whatever produced the copy.
    subject = dedash(subject)
    # Keep the copy's one value link: plaintext shows it inline; the HTML
    # template pulls it out and renders it as the design's CTA button.
    body = dedash(body)
    msg = EmailMessage()
    msg["From"] = formataddr((from_name or "", from_email))
    msg["To"] = to_email
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=from_email.split("@")[-1] if "@" in from_email else None)
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = (references + " " + in_reply_to).strip()
    msg.set_content(body)  # text/plain fallback
    html = _body_to_html(body, from_email, from_name, angle=angle, step_index=step_index)
    html = _apply_tracking(html, track_token)
    msg.add_alternative(html, subtype="html")
    return msg


def _append_to_sent(msg: EmailMessage, p: dict) -> None:
    """Best-effort copy into the IMAP Sent folder; never fatal to the send."""
    if not p.get("imap_host"):
        return
    try:
        ctx = ssl.create_default_context()
        m = imaplib.IMAP4_SSL(p["imap_host"], p["imap_port"], timeout=20)
        m.login(p["user"], p["password"])
        for box in ("Sent", "INBOX.Sent", "Sent Items"):
            try:
                m.append(box, "\\Seen", imaplib.Time2Internaldate(time.time()), msg.as_bytes())
                break
            except imaplib.IMAP4.error:
                continue
        m.logout()
    except Exception:
        pass


def send_email(
    *,
    to_email: str,
    subject: str,
    body: str,
    in_reply_to: str = "",
    references: str = "",
    timeout: float = 30.0,
    inbox: dict | None = None,
    track_token: str = "",
    angle: str = "",
    step_index: int = -1,
) -> str:
    """Send one email from ``inbox`` (or the global config when None).

    When ``track_token`` is given, the HTML gets an open pixel + click-redirect
    links pointing at ``OUTREACH_TRACK_BASE_URL``. Returns the Message-ID.
    Raises EmailSendError on failure.
    """
    p = _smtp_params(inbox)
    if not (p["host"] and p["user"] and p["password"]):
        raise EmailSendError("SMTP not configured for this inbox/config")
    to = (to_email or "").strip()
    if "@" not in to:
        raise EmailSendError(f"invalid recipient: {to_email!r}")
    msg = _build_message(
        to_email=to, subject=subject or "(no subject)",
        # The last gate before SMTP. Whatever wrote this body — a template, the
        # AI drafter, the follow-up regenerator, a hand-typed compose box — no
        # unapproved URL on our own domain leaves the building.
        body=enforce_approved_links(body or ""),
        from_email=p["from_email"], from_name=p["from_name"],
        in_reply_to=in_reply_to, references=references, track_token=track_token,
        angle=angle, step_index=step_index,
    )
    ctx = ssl.create_default_context()
    try:
        if p["ssl"]:
            with smtplib.SMTP_SSL(p["host"], p["port"], timeout=timeout, context=ctx) as s:
                s.login(p["user"], p["password"])
                s.send_message(msg)
        else:
            with smtplib.SMTP(p["host"], p["port"], timeout=timeout) as s:
                s.ehlo()
                s.starttls(context=ctx)
                s.login(p["user"], p["password"])
                s.send_message(msg)
    except (smtplib.SMTPException, OSError, ssl.SSLError) as e:
        raise EmailSendError(f"{type(e).__name__}: {e}") from e
    _append_to_sent(msg, p)
    return msg["Message-ID"]
