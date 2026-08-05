"""Hunter.io email finder + verifier + domain-search fallbacks (v2 API, stdlib HTTP).

Uses ``X-API-KEY`` header (not query string) per Hunter docs. Hunter returns **403**
when **rate limits** are hit — space requests (``MILESTONE2_HUNTER_GAP_SEC``) and keep
``MILESTONE2_HUNTER_CONCURRENCY`` at 1 unless you know your plan's limits.
"""

from __future__ import annotations

import json
import ssl
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def _hunter_request_json(
    path: str,
    params: dict[str, str],
    api_key: str,
    *,
    timeout: float = 45.0,
) -> dict[str, Any] | None:
    """GET ``/v2/{path}`` with ``X-API-KEY``; no secret in URL (cleaner logs)."""
    key = (api_key or "").strip()
    if not key:
        return None
    query = urlencode(params)
    url = f"https://api.hunter.io/v2/{path}?{query}"
    hdrs = {
        "Accept": "application/json",
        "X-API-KEY": key,
        "User-Agent": "HVAC-leads-pipeline/1.0",
    }
    ctx = ssl.create_default_context()
    for attempt in range(2):
        req = Request(url, headers=hdrs, method="GET")
        try:
            with urlopen(req, timeout=timeout, context=ctx) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            try:
                out = json.loads(raw)
            except json.JSONDecodeError:
                print(f"Warning: Hunter non-JSON response from {path}")
                return None
            return out if isinstance(out, dict) else None
        except HTTPError as e:
            body = e.read().decode("utf-8", errors="replace") if e.fp else ""
            detail = body[:600]
            try:
                j = json.loads(body)
                errs = j.get("errors")
                if isinstance(errs, list) and errs:
                    detail = json.dumps(errs[:5])
            except json.JSONDecodeError:
                pass
            print(f"Warning: Hunter HTTP {e.code} ({path}): {detail}")
            if e.code in (402, 403, 429):
                from utils import pipeline_events
                reason = {
                    402: "out of credits / billing required (HTTP 402)",
                    403: "blocked (HTTP 403) — out of credits or rate-limited",
                    429: "rate limited (HTTP 429)",
                }[e.code]
                pipeline_events.credit_alert("Hunter.io", reason)
            if e.code == 403 and attempt == 0:
                time.sleep(2.5)
                continue
            return None
        except (URLError, OSError, TimeoutError) as e:
            print(f"Warning: Hunter network error ({path}): {e}")
            return None

    return None


def hunter_email_finder(
    *,
    domain: str,
    api_key: str,
    first_name: str = "",
    last_name: str = "",
    full_name: str = "",
) -> dict[str, Any] | None:
    """Email finder: use ``first_name``+``last_name`` if either set, else ``full_name``."""
    if not domain or not api_key:
        return None
    d = domain.strip()
    fn = (first_name or "").strip()
    ln = (last_name or "").strip()
    full = (full_name or "").strip()
    if fn or ln:
        return _hunter_request_json(
            "email-finder",
            {"domain": d, "first_name": fn, "last_name": ln},
            api_key,
        )
    if full:
        return _hunter_request_json(
            "email-finder",
            {"domain": d, "full_name": full},
            api_key,
        )
    return None


def hunter_domain_search(
    *,
    domain: str,
    api_key: str,
    limit: int = 15,
) -> dict[str, Any] | None:
    """List known people/emails at a domain (uses Domain Search credits)."""
    if not domain or not api_key:
        return None
    lim = max(1, min(100, int(limit)))
    return _hunter_request_json(
        "domain-search",
        {"domain": domain.strip(), "limit": str(lim)},
        api_key,
    )


def pick_email_from_domain_search(
    *,
    first_name: str,
    last_name: str,
    full_name: str,
    data: dict[str, Any],
) -> str:
    """Pick best ``value`` email from domain-search ``data.emails`` by name match."""
    block = data.get("data")
    if not isinstance(block, dict):
        return ""
    arr = block.get("emails")
    if not isinstance(arr, list):
        return ""
    pf = (first_name or "").lower().strip()
    pl = (last_name or "").lower().strip()
    blob = (full_name or "").lower().strip()

    best_email = ""
    best_score = -1

    for row in arr:
        if not isinstance(row, dict):
            continue
        val = row.get("value")
        if not isinstance(val, str) or "@" not in val:
            continue
        hf = str(row.get("first_name") or "").lower().strip()
        hl = str(row.get("last_name") or "").lower().strip()
        conf = row.get("confidence")
        try:
            c = int(conf) if conf is not None else 0
        except (TypeError, ValueError):
            c = 0

        score = 0
        if pf and pl and hf == pf and hl == pl:
            score = 1000 + c
        elif pf and hf == pf:
            score = 500 + c
        elif pl and hl == pl:
            score = 450 + c
        elif blob and (blob in f"{hf} {hl}".strip() or hf in blob.split() or hl in blob.split()):
            score = 350 + c
        elif pf and pf in val.split("@")[0].lower():
            score = 200 + c

        if score > best_score:
            best_score = score
            best_email = val.strip()

    return best_email


def hunter_email_verifier(*, email: str, api_key: str) -> dict[str, Any] | None:
    if not email or "@" not in email or not api_key:
        return None
    return _hunter_request_json(
        "email-verifier",
        {"email": email.strip()},
        api_key,
    )


def parse_finder_email(data: dict[str, Any]) -> tuple[str, str]:
    """Return (email, raw_status) from finder response."""
    block = data.get("data")
    if not isinstance(block, dict):
        return "", ""
    em = block.get("email")
    if isinstance(em, str) and "@" in em:
        return em.strip(), str(block.get("verification", "") or "")
    return "", ""


def parse_verification(data: dict[str, Any]) -> tuple[str, int | None, str]:
    """Return (result, score_0_100, raw_error)."""
    block = data.get("data")
    if not isinstance(block, dict):
        err = data.get("errors")
        msg = ""
        if isinstance(err, list) and err:
            msg = str(err[0] if isinstance(err[0], str) else err[0])
        return "error", None, msg
    result = str(block.get("result") or "unknown").lower()
    score = block.get("score")
    try:
        sc = int(score) if score is not None else None
    except (TypeError, ValueError):
        sc = None
    return result, sc, ""
