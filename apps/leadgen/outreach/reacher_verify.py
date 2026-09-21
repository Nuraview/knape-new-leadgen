"""Pre-send email verification — a line-for-line port of NuraView's method.

WHERE THIS COMES FROM. nv-crm verifies every address immediately before sending
with ``verifyEmail`` in ``apps/api/src/marketing/lib/reacher.ts``, called from
its two send paths (``lead/send-email.ts`` for a person pressing Send, and
``scheduler/lead-autosend.ts`` for the automation). This file is that function
and that gate, in Python, because knape's outreach does not send from the
TypeScript API at all — it sends from this pipeline, through
``email_runner.process_due``. A verifier ported only to apps/api would guard a
path knape's bulk mail never takes.

WHAT IS IDENTICAL, deliberately, so the two systems give the same answer about
the same address:

  - the same self-hosted Reacher, the same endpoint (``/v1/check_email``), the
    same auth header (``X-Reacher-Token``), the same 30s timeout;
  - the same cache: table ``mkt_email_verifications`` (email PK, reachable,
    result jsonb, checked_at), same 30-day TTL, same "cache write is
    best-effort" rule. Re-checking a lead costs nothing and no address is
    probed more than once a month, which is what protects the sending IP —
    and this box IS the sending IP (mail.tec5usa.us);
  - the same four facts out of a verdict — ``reachable``, ``probed``,
    ``catch_all``, ``confirmed_mailbox`` — derived the same way, including the
    catch-all-before-deliverable ordering from nv-crm d1318afa;
  - the same send-time decision table (``send_gate``).

WHAT DIFFERS, and why — the only two places this is not a copy:

  1. The cache lives in the ``leadgen`` database rather than the CRM database,
     because that is the database this process owns. Same table, same shape.
  2. nv-crm lets a small number of UNCONFIRMED role addresses through as long
     as its bounce breaker has headroom under 5%. knape has no bounce breaker,
     so there is no headroom to measure: an unconfirmed role address is held.
     (process_due already cancels role mailboxes outright before this runs, so
     in practice the rule rarely fires here.)

THE ONE RULE THAT MATTERS MOST, quoted from nv-crm: "A verifier that did NOT
answer is a hold, never a send: treating our own outage as permission is how
automation turns into unverified bulk mail." So with REACHER_URL / REACHER_SECRET
unset, or Reacher down, every automated send is HELD. That is intended.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any, Literal, TypedDict

Reachable = Literal["safe", "risky", "invalid", "unknown"]

#: 30 days, as nv-crm's TTL_MS.
TTL_SEC = 30 * 24 * 60 * 60
#: 30s, as nv-crm's AbortController timer on the send-time path.
TIMEOUT_SEC = 30

#: nv-crm isRolePrefix(): CATCH_ALL_PREFIXES (company-identity.ts) plus the five
#: it adds inline. These are the addresses the lead engine GUESSES when a site
#: publishes none — the 10.2% bounce cohort in nv-crm d1318afa.
_CATCH_ALL_PREFIXES = ("info", "contact", "hello", "enquiries", "sales", "admin")
_EXTRA_ROLE_PREFIXES = ("support", "team", "office", "mail", "help")


class VerifyResult(TypedDict):
    reachable: Reachable
    #: A verifier actually answered. "unknown" with probed=True is a real verdict
    #: (Gmail/Outlook/Yahoo refuse SMTP probes); "unknown" with probed=False is
    #: our own infrastructure failing, and must never be read as permission.
    probed: bool
    #: The domain accepts every address, so nothing was learned about THIS one.
    catch_all: bool
    #: The SMTP server confirmed this mailbox — not merely the domain.
    confirmed_mailbox: bool
    result: Any


def _unprobed() -> VerifyResult:
    return {
        "reachable": "unknown",
        "probed": False,
        "catch_all": False,
        "confirmed_mailbox": False,
        "result": None,
    }


def mailbox_facts(raw: Any) -> dict[str, bool]:
    """nv-crm mailboxFacts(): the two mailbox facts from a raw Reacher payload.

    Catch-all is read FIRST and wins. Reacher detects a catch-all by offering a
    random address and watching it be accepted, and that same accept sets
    ``is_deliverable: true`` — so a client that tests is_deliverable first calls
    a domain that says yes to everything a confirmed mailbox. That is how ten
    guessed addresses went out and bounced on 9 September in nv-crm.
    """
    smtp = raw.get("smtp") if isinstance(raw, dict) else None
    if not isinstance(smtp, dict):
        return {"catch_all": False, "confirmed_mailbox": False}
    catch_all = smtp.get("is_catch_all") is True
    return {
        "catch_all": catch_all,
        "confirmed_mailbox": (not catch_all) and smtp.get("is_deliverable") is True,
    }


def _normalise_reachable(value: Any) -> Reachable:
    return value if value in ("safe", "risky", "invalid", "unknown") else "unknown"


# ── cache ─────────────────────────────────────────────────────────────────────

_table_ready = False


def _ensure_table(conn: Any) -> None:
    global _table_ready
    if _table_ready:
        return
    # nv-crm crm-schema.ts: email varchar(320) PK, reachable, result jsonb,
    # checked_at timestamptz.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS mkt_email_verifications (
            email      VARCHAR(320) PRIMARY KEY,
            reachable  TEXT,
            result     JSONB,
            checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    conn.commit()
    _table_ready = True


def _cache_get(email: str) -> VerifyResult | None:
    try:
        from outreach import db

        c = db.connect()
        try:
            _ensure_table(c)
            row = c.execute(
                "SELECT reachable, result, EXTRACT(EPOCH FROM checked_at) AS ts "
                "FROM mkt_email_verifications WHERE email = ? LIMIT 1",
                (email,),
            ).fetchone()
        finally:
            c.close()
    except Exception:  # noqa: BLE001 — cache miss / table absent → continue
        return None

    if not row or row["ts"] is None or time.time() - float(row["ts"]) >= TTL_SEC:
        return None

    raw = row["result"]
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = None
    return {
        "reachable": _normalise_reachable(row["reachable"]),
        "probed": True,
        **mailbox_facts(raw),  # type: ignore[typeddict-item]
        "result": raw,
    }


def _cache_put(email: str, reachable: Reachable, data: Any) -> None:
    try:
        from outreach import db

        c = db.connect()
        try:
            _ensure_table(c)
            c.execute(
                """
                INSERT INTO mkt_email_verifications (email, reachable, result, checked_at)
                VALUES (?, ?, ?::jsonb, now())
                ON CONFLICT (email) DO UPDATE
                   SET reachable = EXCLUDED.reachable,
                       result = EXCLUDED.result,
                       checked_at = now()
                """,
                (email, reachable, json.dumps(data)),
            )
            c.commit()
        finally:
            c.close()
    except Exception:  # noqa: BLE001 — best-effort cache write, as nv-crm
        pass


# ── the method ────────────────────────────────────────────────────────────────


def verify_email(email: str) -> VerifyResult:
    """nv-crm verifyEmail(): cache, then probe, then cache the answer.

    Never raises. Any error, timeout or missing configuration returns
    ``unknown`` with ``probed=False`` — interactive senders may ignore that, but
    ``send_gate`` treats it as a hold.
    """
    e = (email or "").lower().strip()

    # 1) cache
    cached = _cache_get(e)
    if cached is not None:
        return cached

    url = (os.getenv("REACHER_URL") or "").strip()
    token = (os.getenv("REACHER_SECRET") or "").strip()
    if not url or not token:
        return _unprobed()

    # 2) probe
    try:
        req = urllib.request.Request(
            f"{url.rstrip('/')}/v1/check_email",
            data=json.dumps({"to_email": e}).encode(),
            headers={"Content-Type": "application/json", "X-Reacher-Token": token},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as res:  # noqa: S310 — configured URL
            if not 200 <= res.status < 300:
                return _unprobed()
            data = json.loads(res.read().decode() or "{}")
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return _unprobed()

    reachable = _normalise_reachable(data.get("is_reachable") if isinstance(data, dict) else None)

    # 3) cache upsert
    _cache_put(e, reachable, data)

    return {"reachable": reachable, "probed": True, **mailbox_facts(data), "result": data}  # type: ignore[typeddict-item]


def is_role_prefix(email: str) -> bool:
    """nv-crm isRolePrefix()."""
    prefix = (email or "").split("@")[0].lower()
    return prefix in _CATCH_ALL_PREFIXES or prefix in _EXTRA_ROLE_PREFIXES


GateAction = Literal["send", "exclude", "hold_unconfirmed", "hold_unverified"]


def send_gate(email: str, verdict: VerifyResult | None = None) -> tuple[GateAction, str]:
    """nv-crm lead-autosend's confidence gate, in its order.

    "deliverable and low-deliverable send, dangerous does not" (VK):

      invalid                         → exclude  (the server said no such mailbox —
                                                  the same fact a hard bounce carries)
      role prefix, mailbox unconfirmed → hold     (see module header, difference 2)
      verifier did not answer          → hold     (our outage is never permission)
      anything else                    → send     ("unknown" from a verifier that
                                                  DID answer is a send: that is
                                                  Gmail/Outlook refusing probes)
    """
    v = verdict if verdict is not None else verify_email(email)

    if v["reachable"] == "invalid":
        return "exclude", "Verified undeliverable (SMTP says no such mailbox)"

    if is_role_prefix(email) and not v["confirmed_mailbox"]:
        return "hold_unconfirmed", "role address on a mailbox the server did not confirm"

    if not v["probed"]:
        return "hold_unverified", "the verifier did not answer, so nothing is known about this address"

    return "send", f"verified: {v['reachable']}"
