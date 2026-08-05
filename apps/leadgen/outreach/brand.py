"""Instance branding for the Python cockpit, read from env.

The Node side already has this (apps/api/src/utils/get-brand.ts) and serves it
over ``GET /api/config``. This is the same contract, same variable names, for
the half of the product that renders outbound email, PDFs and notification
copy — the half whose output leaves the building.

WHY IT IS NOT FETCHED FROM THE NODE API
---------------------------------------
Because it would make sending depend on the CRM being up, and because the two
processes read the same environment anyway. A variable is not worth a network
call and a failure mode.

WHY EVERY VALUE HAS A FALLBACK
------------------------------
So an instance that sets nothing still sends something coherent rather than
"None" in the signature. The fallbacks are deliberately GENERIC, not any
client's: this module was written while pulling one client's name, photo and
social links out of a template that every other client's mail was rendering
through, and a fallback that names a real business would just reintroduce that
bug one deploy later.
"""

from __future__ import annotations

import os
import re


def _env(name: str, fallback: str = "") -> str:
    return (os.getenv(name) or "").strip() or fallback


def name() -> str:
    """The business. Used in subjects, PDF headers and the assistant's voice."""
    return _env("BRAND_NAME", "the company")


def short_name() -> str:
    return _env("BRAND_SHORT_NAME", name())


def legal_name() -> str:
    return _env("BRAND_LEGAL_NAME", name())


def sender_name() -> str:
    """Who outbound mail is from, in prose.

    OUTREACH_FROM_NAME first, because that is what the SMTP envelope already
    uses and a signature that disagrees with the From: header reads as a
    forgery to both a human and a spam filter.
    """
    return _env("OUTREACH_FROM_NAME") or _env("BRAND_SIGNATURE_NAME", name())


def sender_title() -> str:
    return _env("BRAND_SIGNATURE_TITLE", name())


def sender_email() -> str:
    return _env("OUTREACH_FROM_EMAIL") or _env("BRAND_SUPPORT_EMAIL", "")


def site_url() -> str:
    """The public marketing site — where a reader who clicks the brand goes."""
    return _env("BRAND_SIGNATURE_WEBSITE_URL") or _env(
        "BRAND_MARKETING_URL", "https://example.com"
    )


def site_label() -> str:
    label = _env("BRAND_SIGNATURE_WEBSITE_LABEL")
    if label:
        return label
    return re.sub(r"^https?://", "", site_url()).rstrip("/")


def photo_url() -> str:
    return _env("BRAND_SIGNATURE_PHOTO_URL", "")


def phone() -> str:
    return _env("BRAND_SIGNATURE_PHONE", "")


def linkedin_url() -> str:
    return _env("BRAND_SIGNATURE_LINKEDIN_URL", "")


def accent() -> str:
    """The brand accent, for email buttons and rules.

    Hex, because it goes straight into inline CSS in an HTML email, where a
    named colour or a CSS variable is not reliably supported.
    """
    return _env("BRAND_ACCENT_COLOR", "#0f172a")


def accent_foreground() -> str:
    return _env("BRAND_ACCENT_FOREGROUND", "#ffffff")


def ink() -> str:
    """The dark colour used for headings on a light email background."""
    return _env("BRAND_THEME_COLOR", "#111111")


def business_brief() -> str:
    """One or two sentences on what this business sells.

    Feeds the AI drafting prompts. Empty is a meaningful value: the prompts say
    outright that they do not know the product rather than inventing one.
    """
    return _env("BRAND_BUSINESS_BRIEF", "")


def audience_brief() -> str:
    return _env("BRAND_AUDIENCE_BRIEF", "")


def socials() -> list[tuple[str, str]]:
    """``(label, url)`` for the signature's icon row, omitting what is unset.

    Returned as a list so a brand with no LinkedIn simply renders no LinkedIn
    icon, instead of an icon linking to the vendor's profile.
    """
    out: list[tuple[str, str]] = []
    if linkedin_url():
        out.append(("LinkedIn", linkedin_url()))
    out.append(("Website", site_url()))
    return out
