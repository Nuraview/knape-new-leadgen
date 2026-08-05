"""JSON HTTP helpers (stdlib only): GET and POST."""

from __future__ import annotations

import http.client
import json
import os
import socket
import ssl
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def get_json(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: float = 90.0,
) -> Any | None:
    """GET URL and parse JSON body. Returns None on failure."""
    hdrs = {"Accept": "application/json", **(headers or {})}
    req = Request(url, headers=hdrs, method="GET")
    ctx = ssl.create_default_context()
    try:
        with urlopen(req, timeout=timeout, context=ctx) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except (HTTPError, URLError, OSError, TimeoutError) as e:
        print(f"Warning: GET {url[:80]}… failed: {e}")
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"Warning: invalid JSON from {url[:80]}…: {e}")
        return None


def get_text(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: float = 25.0,
    silent: bool = False,
) -> str | None:
    """GET URL and return decoded text body, or None on failure."""
    default_hdrs = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    hdrs = {**default_hdrs, **(headers or {})}
    req = Request(url, headers=hdrs, method="GET")
    ctx = ssl.create_default_context()
    try:
        with urlopen(req, timeout=timeout, context=ctx) as resp:
            body = resp.read().decode("utf-8", errors="replace")
        if not _looks_blocked(body):
            return body
        reason = "block page"
    except (HTTPError, URLError, OSError, TimeoutError) as e:
        reason = str(e)

    # Direct fetch failed or came back as a challenge page. School-district
    # staff directories sit behind Cloudflare, Incapsula and "are you human"
    # interstitials more often than not, and that is exactly where the named
    # athletic directors are — the people worth emailing instead of info@.
    #
    # Unlocker is tried SECOND, never first: a direct GET is free and works for
    # most sites, so spend tracks only the pages that actually refuse us.
    body = _unlocked_get(url, timeout=timeout)
    if body is not None:
        return body
    if not silent:
        print(f"Warning: GET {url[:80]}… failed: {reason}")
    return None


# Fingerprints of the interstitial pages that come back with HTTP 200 and no
# content worth parsing. Checked only on short bodies — a real directory page
# that happens to mention Cloudflare in a footer is far longer than this.
_BLOCK_MARKERS = (
    "just a moment...",
    "checking your browser",
    "enable javascript and cookies to continue",
    "attention required! | cloudflare",
    "access denied",
    "request unsuccessful. incapsula",
    "verifying you are human",
    "ddos protection by",
)


def _looks_blocked(body: str) -> bool:
    if not body or len(body) > 40_000:
        return False
    low = body[:4_000].lower()
    return any(m in low for m in _BLOCK_MARKERS)


def _note_unlocker_zone_missing() -> None:
    """Surface a wrong/missing Web Unlocker zone where a person will see it.

    Silently returning None here is how this cost a whole debugging pass: the
    crawler reported "js_only" for every site, which looks like a site problem
    and is in fact a configuration one.
    """
    try:
        from outreach.app_settings import record_key_alert

        record_key_alert(
            "brightdata_unlocker",
            "No Web Unlocker zone configured. The SERP zone cannot fetch ordinary "
            "websites, so school staff directories stay unreachable. Create an "
            "Unlocker zone in Bright Data and set it in Pipeline settings > Keys.",
        )
    except Exception:  # noqa: BLE001
        pass


def _unlocked_get(url: str, *, timeout: float = 45.0) -> str | None:
    """Fetch through Bright Data Web Unlocker, if it is configured.

    Inert without credentials — returns None so the caller reports the original
    failure, and nothing changes for a deployment that has not bought it.
    """
    # Settings first, env second — the same precedence as every other key in
    # the product. Read from os.getenv alone, this stayed inert after the
    # Bright Data key was entered in the dashboard: 108 billable searches ran
    # against sites that then refused a plain fetch, and the run produced five
    # sendable leads instead of a hundred. The key was present and unreachable.
    key = zone = ""
    try:
        from outreach.app_settings import get_setting

        key = (get_setting("BRIGHTDATA_API_KEY") or "").strip()
        # A SERP zone answers search-engine URLs ONLY. Pointed at a school
        # website it returns, with HTTP 200, the 98-byte body "This target URL
        # isn't supported with SERP API, use the Web Unlocker product" — which
        # the crawler read as a JavaScript shell and reported as js_only. Two
        # different products, two different zones.
        zone = (get_setting("BRIGHTDATA_UNLOCKER_ZONE") or "").strip()
    except Exception:  # noqa: BLE001 — settings optional, env is the floor
        pass
    key = key or (os.getenv("BRIGHTDATA_API_KEY") or "").strip()
    zone = zone or (os.getenv("BRIGHTDATA_UNLOCKER_ZONE") or "").strip()
    if not key or not zone:
        return None

    # An unlocked fetch is billable, so it is cached and budgeted exactly like a
    # search. A staff directory does not change between two passes of the same
    # batch, and re-fetching it is money for an answer we already have.
    try:
        from utils import provider_cache as _pc

        hit = _pc.get("brightdata", {"unlock": url})
        if hit is not None:
            return hit or None
        if _pc.budget_left("brightdata") <= 0:
            return None
    except Exception:  # noqa: BLE001
        _pc = None  # type: ignore[assignment]

    payload = json.dumps({"zone": zone, "url": url, "format": "raw"}).encode()
    req = Request(
        "https://api.brightdata.com/request",
        data=payload,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=max(timeout, 45.0), context=ssl.create_default_context()) as resp:
            body = resp.read().decode("utf-8", errors="replace")
        # A wrong-zone reply is a 200 with an error sentence in it. Charged by
        # Bright Data either way, but it must not be cached as if it were the
        # page, or the mistake is remembered for thirty days.
        if body and "use the Web Unlocker product" in body[:400]:
            _note_unlocker_zone_missing()
            if _pc is not None:
                _pc.charge("brightdata")
            return None
        if _pc is not None:
            _pc.charge("brightdata")
            # Cache the miss too. A site that returns nothing costs the same as
            # one that returns a directory, and asking it again costs again.
            _pc.put("brightdata", {"unlock": url}, body or "")
        return body or None
    except (HTTPError, URLError, OSError, TimeoutError) as e:
        print(f"Warning: unlocker GET {url[:60]}… failed: {e}")
        return None


def post_json(
    url: str,
    headers: dict[str, str],
    body: dict[str, Any],
    timeout: float = 60.0,
    retries: int = 3,
) -> Any:
    data = json.dumps(body).encode("utf-8")
    ctx = ssl.create_default_context()
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        req = Request(url, data=data, method="POST")
        for k, v in headers.items():
            req.add_header(k, v)
        try:
            with urlopen(req, timeout=timeout, context=ctx) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            break
        except HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace") if e.fp else ""
            raise RuntimeError(f"HTTP {e.code}: {err_body[:800]}") from e
        except (
            URLError,
            socket.timeout,
            TimeoutError,
            http.client.RemoteDisconnected,
            ConnectionError,
            OSError,
        ) as e:
            last_err = e
            if attempt >= retries:
                raise RuntimeError(str(getattr(e, "reason", e))) from e
            time.sleep(min(2.0, 0.5 * (attempt + 1)))
    else:
        raise RuntimeError(str(last_err) if last_err else "unknown network error")

    if not raw.strip():
        return {}
    return json.loads(raw)
