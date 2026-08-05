"""MillionVerifier — the deliverability gate in front of every send.

Ported from nv-crm's enrichment waterfall
(``apps/api/src/enrichment/services/millionverifier.ts``), which has been
running this check against real lead data for months. Same endpoint, same
placeholder guard, same accept rule, so an address judged sendable here is
judged sendable there.

WHY THIS AND NOT THE SMTP PROBE

``email_validate`` opens an SMTP conversation and reads the RCPT TO code. That
works, but it is the weakest possible signal on exactly the domains this
pipeline targets:

- Districts run Proofpoint and Mimecast in front of Exchange. The gateway
  accepts every recipient and rejects later, so a 250 means nothing.
- Repeated RCPT probes from one IP are what greylisting and tarpitting exist
  to punish. The prober is our own sending IP.
- ``_is_catch_all`` correctly refuses those domains — which is right, and also
  why 86% of the list is unusable rather than merely unverified.

MillionVerifier resolves catch-all domains against its own history instead of
guessing, so a real mailbox behind a Proofpoint gateway comes back ``ok``
rather than being thrown away with the domain.

COST DISCIPLINE

$0.0037 per verify, credits do not expire, and catch-all/unknown verdicts are
not billed. Two rules keep the bill honest:

1. ``is_likely_placeholder`` refuses to spend anything on a fabricated address.
   nv-crm logged a real incident on 2026-05-21 paying to verify
   ``email1@example.com`` — a literal sample scraped from a template page.
2. Every verdict is cached in ``email_validation``, keyed on the address. The
   same lead re-entering the pool on a later run costs nothing.

Inert without ``MILLIONVERIFIER_API_KEY``: ``verify()`` returns None and the
caller falls back to the SMTP probe, so nothing breaks before the key is set.
"""

from __future__ import annotations

import os
import re
import time
import urllib.parse
from typing import Any

from utils.http import get_json

ENDPOINT = "https://api.millionverifier.com/api/v3/"
TIMEOUT_SEC = 15
MAX_RETRIES = 2
RETRY_DELAY_SEC = 0.8

# How long a verdict stays good. Mailboxes are closed when people leave jobs,
# and this list is school staff, who move in August. A verdict older than this
# is re-bought rather than trusted.
CACHE_TTL_SEC = 90 * 86400

#: Domains that only ever appear in documentation and templates. Paying to
#: verify one means an upstream step invented the address.
PLACEHOLDER_DOMAINS = frozenset({
    "example.com",
    "example.org",
    "example.net",
    "example.io",
    "domain.com",
    "company.com",
    "email.com",
    "test.com",
    "mail.com",
    "yourdomain.com",
    "yourcompany.com",
})

PLACEHOLDER_LOCAL_PATTERNS = tuple(
    re.compile(p, re.I)
    for p in (
        r"^email\d*$",       # email, email1, email2 …
        r"^name\d*$",
        r"^test\d*$",
        r"^example\d*$",
        r"^sample\d*$",
        r"^firstname$",
        r"^lastname$",
        r"^fullname$",
        r"^no-?reply$",      # never worth verifying: nobody reads it
    )
)


def api_key() -> str:
    """The key, from settings first so it can be pasted into the dashboard."""
    try:
        from outreach.app_settings import get_setting

        key = str(get_setting("MILLIONVERIFIER_API_KEY") or "").strip()
        if key:
            return key
    except Exception:  # noqa: BLE001 — settings are optional, env is the floor
        pass
    return (os.getenv("MILLIONVERIFIER_API_KEY") or "").strip()


def configured() -> bool:
    return bool(api_key())


def is_likely_placeholder(email: str) -> bool:
    """True for addresses that were written by a template, not by a person."""
    addr = (email or "").strip().lower()
    if "@" not in addr:
        return False
    local, _, domain = addr.rpartition("@")
    if domain in PLACEHOLDER_DOMAINS:
        return True
    if domain.endswith(".example") or domain.endswith(".test"):
        return True
    return any(p.match(local) for p in PLACEHOLDER_LOCAL_PATTERNS)


def is_deliverable(result: dict[str, Any] | None) -> bool:
    """Stricter than "not invalid".

    Only ``ok`` or ``quality=good`` is safe to send. ``catch_all`` and
    ``unknown`` are kept in the cache — they are worth knowing, and they are
    not billed — but they never reach a send queue.
    """
    if not result:
        return False
    return result.get("result") == "ok" or result.get("quality") == "good"


def verify(email: str) -> dict[str, Any] | None:
    """One address, one verdict. None means "no answer" — never "bad".

    A None here must fall back to the SMTP probe rather than drop the lead:
    a missing key or a provider outage is our problem, not the address's.
    """
    key = api_key()
    if not key:
        return None
    addr = (email or "").strip().lower()
    if not addr:
        return None
    if is_likely_placeholder(addr):
        # Refused, not queried. Costs nothing and is a definite verdict.
        return {"email": addr, "result": "invalid", "quality": "bad", "reason": "placeholder"}

    url = (
        f"{ENDPOINT}?api={urllib.parse.quote(key)}"
        f"&email={urllib.parse.quote(addr)}&timeout=10"
    )
    for attempt in range(MAX_RETRIES + 1):
        try:
            data = get_json(url, timeout=TIMEOUT_SEC)
            if isinstance(data, dict) and data.get("result"):
                return data
        except Exception as e:  # noqa: BLE001 — retry, then give up quietly
            if attempt >= MAX_RETRIES:
                print(f"Warning: millionverifier failed for {addr}: {e}", flush=True)
                return None
        if attempt < MAX_RETRIES:
            time.sleep(RETRY_DELAY_SEC * (attempt + 1))
    return None


# ------------------------------------------------------------------ cache --

def cached(email: str) -> dict[str, Any] | None:
    """A previous verdict for this address, if it is still inside the TTL."""
    addr = (email or "").strip().lower()
    if not addr:
        return None
    try:
        from outreach import db

        c = db.connect()
        try:
            row = c.execute(
                "SELECT email, ok, reason, is_role, has_mx, checked_at FROM email_validation WHERE email=?",
                (addr,),
            ).fetchone()
        finally:
            c.close()
    except Exception:  # noqa: BLE001 — a cache miss is always safe
        return None
    if not row:
        return None
    if time.time() - float(row["checked_at"] or 0) > CACHE_TTL_SEC:
        return None
    reason = str(row["reason"] or "")
    # Only verdicts this module wrote are ours to reuse. An SMTP-probe row is a
    # weaker signal and must not masquerade as a paid verification.
    if not reason.startswith("mv:"):
        return None
    return {
        "email": addr,
        "ok": bool(row["ok"]),
        "reason": reason,
        "role": bool(row["is_role"]),
        "mx": bool(row["has_mx"]),
        "cached": True,
    }


def remember(email: str, *, ok: bool, reason: str, role: bool, mx: bool) -> None:
    """Persist a verdict so the same address is never bought twice."""
    addr = (email or "").strip().lower()
    if not addr:
        return
    try:
        from outreach import db

        c = db.connect()
        try:
            c.execute(
                """
                INSERT INTO email_validation (email, ok, reason, is_role, has_mx, checked_at)
                VALUES (?,?,?,?,?,?)
                ON CONFLICT (email) DO UPDATE SET
                  ok=EXCLUDED.ok, reason=EXCLUDED.reason,
                  is_role=EXCLUDED.is_role, has_mx=EXCLUDED.has_mx,
                  checked_at=EXCLUDED.checked_at
                """,
                (addr, 1 if ok else 0, reason, 1 if role else 0, 1 if mx else 0, time.time()),
            )
            c.commit()
        finally:
            c.close()
    except Exception:  # noqa: BLE001 — a cache write failure must not block a send
        pass
