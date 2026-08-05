"""Pre-send email address validation — cut the bounce rate before we send.

Three layers, cheapest first:
  1. syntax  — RFC-ish shape check.
  2. MX      — does the domain actually accept mail? (no MX = dead domain = certain bounce).
  3. SMTP    — connect to the domain's mail server and RCPT-probe the mailbox WITHOUT
               sending. A hard 550 means "no such mailbox" (the exact thing that bounced
               our info@ blasts). Greylist / accept-all / unreachable => inconclusive,
               and we KEEP the address (never drop on a maybe).

Only ``no_syntax`` / ``no_mx`` / ``no_mailbox`` are treated as un-sendable. Everything
else is sendable. MX + probe results are cached per-domain for the run.
"""

from __future__ import annotations

import re
import smtplib
import uuid
import subprocess
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from typing import Any

_SYNTAX = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9][A-Za-z0-9.\-]*\.[A-Za-z]{2,}$")
_ROLE = {
    "info", "admin", "office", "contact", "support", "hello", "help", "sales",
    "webmaster", "postmaster", "noreply", "no-reply", "team", "mail", "enquiries",
    "general", "hr", "helpdesk", "marketing", "billing",
}

# Exact matches miss the school-district variants, which are the ones that
# actually bounced here: techhelp@westside66.net, attendanceoffice@berkeley.net,
# publicinformation@hpisd.org, schoolcounseling@ops.org, prhs.info@gcpsk12.org,
# mhsoffice@aguafria.org, chandlercommunicationoffice@cusd80.com. Districts
# prefix and suffix the same handful of words endlessly, so match on the word
# rather than the whole local-part.
#
# A false positive costs one skipped lead. A false negative costs a bounce
# against a domain already at 11.8%, so this errs towards skipping.
_ROLE_TOKENS = (
    "webmaster", "postmaster", "noreply", "no-reply", "donotreply", "do-not-reply",
    "helpdesk", "techhelp", "techsupport", "itsupport", "attendance", "counseling",
    "counselor", "registrar", "enrollment", "frontoffice", "mainoffice",
    "publicinformation", "communicationoffice", "communications", "parents",
    "schoolinfo", "districtinfo", "reception", "inquiries", "enquiries",
    "customerservice", "feedback", "abuse", "privacy", "security",
    # Bare "office" catches mhsoffice@, bhsoffice@ and the rest of the pattern
    # districts use for a school's front desk. Deliberately NOT listing
    # "athletics" — an athletics@ mailbox is a shared inbox but it is read by
    # exactly the person this product is sold to, so it stays sendable.
    "office",
    # Departmental boxes that survived the first pass because they carry no
    # office/info word: summerschool@susd.org was still receiving follow-ups.
    # Each is a function rather than a person, and none of them buys planners.
    #
    # "purchasing" and "procurement" are deliberately absent for the same
    # reason athletics is: a bulk order for fifty planners is exactly what that
    # desk exists to handle, so it is a real prospect, not a dead end.
    "summerschool", "foodservice", "cafeteria", "nutrition", "transportation",
    "facilities", "maintenance", "custodial", "payroll", "library", "media-center",
)


def _is_role_local(local: str) -> bool:
    """Role mailbox? Exact match first, then the district-style word forms."""
    if local in _ROLE:
        return True
    flat = local.replace(".", "").replace("_", "").replace("-", "")
    return any(tok.replace("-", "") in flat for tok in _ROLE_TOKENS)
_DISPOSABLE = {
    "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
    "trashmail.com", "yopmail.com", "getnada.com",
}
_MAIL_FROM = "outreach@winthedayplanner.net"


@lru_cache(maxsize=8192)
def mx_hosts(domain: str) -> tuple[str, ...]:
    """MX hosts for a domain (falls back to the A record — some small domains
    accept mail on their A record with no explicit MX). Cached per run."""
    try:
        out = subprocess.run(
            ["dig", "+short", "MX", domain], capture_output=True, text=True, timeout=8
        ).stdout.strip()
        hosts = [ln.split()[-1].rstrip(".") for ln in out.splitlines() if ln.split()]
        if hosts:
            return tuple(hosts)
        a = subprocess.run(
            ["dig", "+short", "A", domain], capture_output=True, text=True, timeout=8
        ).stdout.strip()
        return (domain,) if a else ()
    except Exception:  # noqa: BLE001 — DNS hiccup shouldn't crash a batch
        return ()


# The raw SMTP code from the most recent probe, keyed by address. _probe_mailbox
# collapses codes into keep/drop, and catch-all detection needs the code itself.
_LAST_CODE: dict[str, int | None] = {}


@lru_cache(maxsize=8192)
def _probe_mailbox(email: str, mx_host: str) -> tuple[bool, str]:
    """RCPT-probe one mailbox. (True, reason) = keep it; (False, reason) = drop it.
    Only a definitive 550-class 'no such user' drops the address."""
    try:
        s = smtplib.SMTP(mx_host, 25, timeout=12)
        try:
            s.ehlo_or_helo_if_needed()
            s.mail(_MAIL_FROM)
            code, _ = s.rcpt(email)
        finally:
            try:
                s.quit()
            except Exception:  # noqa: BLE001
                pass
    except Exception:  # noqa: BLE001 — unreachable / blocked probe => inconclusive, keep
        _LAST_CODE[email] = None
        return True, "smtp_unreachable"
    _LAST_CODE[email] = code
    if code in (250, 251):
        return True, "smtp_ok"
    if code in (550, 551, 553, 554):
        return False, "no_mailbox"
    return True, "smtp_inconclusive"  # greylist — don't drop


# Per-domain catch-all verdicts, cached for the life of the process. Probing is
# a TCP round trip and school districts cluster heavily on a few mail hosts.
_CATCH_ALL: dict[str, bool] = {}


def _is_catch_all(domain: str, mx_host: str) -> bool:
    """Does this domain accept RCPT for an address that cannot exist?

    A 250 at RCPT was being read as "the mailbox is real". On an accept-all
    domain it means nothing at all — the server takes every recipient and
    rejects it later, at delivery, as a bounce against our sending domain. That
    is how 511 addresses passed validation and the bounce rate still sat at
    11.8%: the probe was answering a different question than the one asked.

    Probing a deliberately impossible local-part tells the two apart.
    """
    if domain in _CATCH_ALL:
        return _CATCH_ALL[domain]
    probe = f"zz-no-such-user-{uuid.uuid4().hex[:12]}@{domain}"
    accepted, _ = _probe_mailbox(probe, mx_host)
    # Only a clean 250 proves accept-all. An unreachable or greylisted probe is
    # inconclusive and must not condemn the domain.
    verdict = accepted and _LAST_CODE.get(probe) in (250, 251)
    _CATCH_ALL[domain] = verdict
    return verdict


def _millionverifier_verdict(addr: str) -> dict[str, Any] | None:
    """MillionVerifier's answer for one address, or None to fall through.

    None means "no answer available" — no key, provider down, or a response we
    could not read. It must never mean "bad": an outage on our side is not a
    reason to discard a lead, so the caller drops back to the SMTP probe.
    """
    try:
        from pipeline import millionverifier as mv
    except Exception:  # noqa: BLE001 — module optional, probe still works
        return None
    if not mv.configured():
        return None

    hit = mv.cached(addr)
    if hit is not None:
        return hit

    result = mv.verify(addr)
    if result is None:
        return None

    ok = mv.is_deliverable(result)
    verdict = str(result.get("result") or "unknown")
    # `mv:` prefixes the reason so the cache can tell a paid verification from
    # an SMTP-probe row and never reuses the weaker one as if it were this.
    reason = f"mv:{verdict}"
    out = {
        "email": addr,
        "ok": ok,
        "reason": reason,
        "role": bool(result.get("role")),
        # A verdict at all means the domain resolved and accepts mail somewhere.
        "mx": True,
        "quality": result.get("quality"),
        "verifier": "millionverifier",
    }
    mv.remember(addr, ok=ok, reason=reason, role=out["role"], mx=True)
    return out


def validate_email(email: str, *, smtp_probe: bool = True) -> dict[str, Any]:
    """Return {'email','ok','reason','role','mx'}. ``ok=False`` only for a
    definite dead address (bad syntax, no MX, or 550 no-mailbox).

    Order matters and it is not arbitrary. The free, certain checks run first —
    syntax, disposable domain, role account, placeholder — because each one is
    a definite verdict that costs nothing and would otherwise be paid for. Only
    what survives all four is worth spending a verification credit on.
    """
    addr = (email or "").strip().lower()
    res: dict[str, Any] = {"email": addr, "ok": False, "reason": "", "role": False, "mx": False}
    if not _SYNTAX.match(addr):
        res["reason"] = "bad_syntax"
        return res
    local, domain = addr.rsplit("@", 1)
    if domain in _DISPOSABLE:
        res["reason"] = "disposable"
        return res
    res["role"] = _is_role_local(local)
    # The role flag was being computed and then ignored — nothing read it, so
    # info@, webmaster@ and office@ passed validation and went out. They are
    # shared district mailboxes: they bounce, they auto-reply, and they never
    # produce a person. Every one of the fourteen "replies" this system recorded
    # came from one.
    #
    # This stays ahead of MillionVerifier deliberately: info@district.org is a
    # perfectly deliverable address, so the verifier would pass it. Deliverable
    # is not the same as worth writing to.
    if res["role"]:
        res["reason"] = "role_account"
        return res

    # MillionVerifier, when a key is configured, is the authority — see
    # pipeline/millionverifier.py for why its verdict beats our own SMTP probe
    # on gateway-fronted district domains.
    mv = _millionverifier_verdict(addr)
    if mv is not None:
        mv["role"] = res["role"]
        return mv

    mx = mx_hosts(domain)
    res["mx"] = bool(mx)
    if not mx:
        res["reason"] = "no_mx"
        return res
    if smtp_probe:
        ok, reason = _probe_mailbox(addr, mx[0])
        if ok and reason == "smtp_ok" and _is_catch_all(domain, mx[0]):
            # The server takes every recipient, so the 250 said nothing about
            # this mailbox. Sending anyway is how a validated address still
            # bounces at delivery.
            res["ok"], res["reason"] = False, "catch_all"
            return res
        res["ok"], res["reason"] = ok, reason
        return res
    res["ok"], res["reason"] = True, "mx_ok"
    return res


def validate_many(emails: list[str], *, smtp_probe: bool = True, workers: int = 12) -> dict[str, dict[str, Any]]:
    """Validate a list concurrently. Returns {email: result}."""
    uniq = list({(e or "").strip().lower() for e in emails if e})
    out: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for r in ex.map(lambda e: validate_email(e, smtp_probe=smtp_probe), uniq):
            out[r["email"]] = r
    return out


def sendable(emails: list[str], *, smtp_probe: bool = True) -> tuple[list[str], dict[str, dict[str, Any]]]:
    """Convenience: (list of addresses safe to send, full result map)."""
    results = validate_many(emails, smtp_probe=smtp_probe)
    return [e for e, r in results.items() if r["ok"]], results
