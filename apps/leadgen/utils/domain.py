"""Derive a registrable domain from a website / URL string."""

from __future__ import annotations

from urllib.parse import urlparse

# Hunter cannot discover @company.com addresses when ``website`` points here.
_UNUSABLE_WEBSITE_HOSTS: frozenset[str] = frozenset(
    {
        "linkedin.com",
        "www.linkedin.com",
        "linkedin.co.uk",
        "linkedin.cn",
        "facebook.com",
        "twitter.com",
        "x.com",
        "instagram.com",
    }
)


def website_domain_usable_for_corporate_email(host: str) -> bool:
    """False for social / job-board hosts where ``website_to_domain`` is not a company mail domain."""
    h = (host or "").lower().strip().split(":")[0]
    if not h or "." not in h:
        return False
    if h.startswith("www."):
        h = h[4:]
    if "linkedin.com" in h:
        return False
    return h not in _UNUSABLE_WEBSITE_HOSTS


def website_to_domain(website: str) -> str:
    w = (website or "").strip()
    if not w:
        return ""
    if "://" not in w:
        w = "https://" + w
    try:
        host = (urlparse(w).netloc or "").lower().strip()
    except ValueError:
        return ""
    if host.startswith("www."):
        host = host[4:]
    return host.split(":")[0] if host else ""
