"""Unified web search across Bright Data (primary), Serper, OpenWebNinja and Tavily.

All are paid SERP APIs; keys live in ``.env`` as ``SERPER_API_KEY`` /
``OPENWEBNINJA_API_KEY`` / ``TAVILY_API_KEY``. When a provider is missing or returns a
credit/quota error (HTTP 402/403/429 or an "insufficient credits" body), the query
transparently retries on the next one, and the drained provider is marked exhausted for
the rest of the process so we stop hammering it.

Results are normalized to ``[{"title", "link", "snippet"}]``. Per-provider successful
call counts are tracked for credit accounting (``counts()`` / ``total_calls()``).
Each provider is throttled to ~1 request/second (OpenWebNinja's hard limit).
"""

from __future__ import annotations

import os
import threading
import time
import urllib.parse

from utils.http import post_json

_COUNTS: dict[str, int] = {"brightdata": 0, "serper": 0, "openwebninja": 0, "tavily": 0}
_EXHAUSTED: set[str] = set()
_LAST_CALL: dict[str, float] = {}
_THROTTLE_LOCK = threading.Lock()


#: Seconds between calls, per provider. Bright Data refuses a query that was
#: attempted moments ago and answers HTTP 200 with an empty body, so a gap
#: sized for Serper produced a stream of "no results" that were really "too
#: soon". Slower here is strictly faster overall: a refused query costs a
#: credit's worth of wall-clock and returns nothing.
_GAPS = {"brightdata": 6.0}


def _throttle(provider: str, gap: float = 1.05) -> None:
    gap = _GAPS.get(provider, gap)
    with _THROTTLE_LOCK:  # reserve the next slot; safe across parallel workers
        now = time.time()
        slot = max(now, _LAST_CALL.get(provider, 0.0) + gap)
        _LAST_CALL[provider] = slot
    if slot > now:
        time.sleep(slot - now)

# Substrings that mark a "provider is out of credits / blocked" HTTP error → fail over.
#: Transient Bright Data conditions. Checked BEFORE the quota markers, because
#: "cannot be attempted at this time" contains none of them but would otherwise
#: fall through to the generic error path and burn a retry against a provider
#: that is fine in fifteen seconds.
_TRANSIENT_MARKERS = (
    "recently failed and cannot be attempted",
    "empty response (query cooldown",
    "try again later",
)

_QUOTA_MARKERS = (
    "http 402",
    "http 403",
    "http 429",
    "http 432",  # Tavily's plan-usage-limit status
    "insufficient",
    "quota",
    "credit",
    "exceeded",
    "exceeds your plan",  # Tavily's actual wording — doesn't say "exceeded"
    "usage limit",
    "unauthorized",
    "forbidden",
    "rate limit",
    "not enough",  # Serper's actual wording — "Not enough credits"
)


def counts() -> dict[str, int]:
    """Successful calls per provider so far (credit accounting)."""
    return dict(_COUNTS)


def total_calls() -> int:
    return sum(_COUNTS.values())


def reset_counts() -> None:
    for k in _COUNTS:
        _COUNTS[k] = 0
    _EXHAUSTED.clear()


_KEY_ENV = {
    "brightdata": "BRIGHTDATA_API_KEY",
    "serper": "SERPER_API_KEY",
    "openwebninja": "OPENWEBNINJA_API_KEY",
    "tavily": "TAVILY_API_KEY",
    # Apollo isn't a web_search() provider (it's a direct REST call in pipeline.apollo_org),
    # but shares the same dashboard-key / low-credit-alert plumbing via get_key/report_*.
    "apollo": "APOLLO_API_KEY",
}


def _key(provider: str) -> str:
    """Dashboard (Settings > Keys) → VPS ``.env`` → "" — same precedence as every
    other dashboard-editable setting. Falls back to raw env if the DB is briefly
    unreachable so a settings hiccup can't take search down."""
    env = _KEY_ENV[provider]
    try:
        from outreach.app_settings import get_setting

        return (get_setting(env) or "").strip()
    except Exception:  # noqa: BLE001
        return (os.getenv(env) or "").strip()


def get_key(provider: str) -> str:
    """Public accessor — for callers (e.g. ``pipeline.org_contact``'s direct Places
    API call) that need a provider key without going through ``web_search``."""
    return _key(provider)


def report_ok(provider: str) -> None:
    """Clear the Settings > Keys low-credit banner for ``provider`` after a real
    call succeeds. Best-effort — must never break a search over an alerting hiccup."""
    try:
        from outreach.app_settings import clear_key_alert

        clear_key_alert(provider)
    except Exception:  # noqa: BLE001
        pass


def report_quota(provider: str, message: str) -> None:
    """Flag ``provider`` as low/out of credits (or missing a key) for the Keys tab."""
    try:
        from outreach.app_settings import record_key_alert

        record_key_alert(provider, message)
    except Exception:  # noqa: BLE001
        pass


def _is_quota_error(msg: str) -> bool:
    m = (msg or "").lower()
    return any(k in m for k in _QUOTA_MARKERS)


def _serper(query: str, num: int) -> list[dict[str, str]]:
    payload = post_json(
        "https://google.serper.dev/search",
        {"X-API-KEY": _key("serper"), "Content-Type": "application/json"},
        {"q": query, "num": num, "gl": "us", "hl": "en"},
        timeout=30.0,
        retries=1,
    )
    out: list[dict[str, str]] = []
    for r in payload.get("organic") or []:
        if isinstance(r, dict) and r.get("link"):
            out.append({"title": r.get("title", ""), "link": r["link"], "snippet": r.get("snippet", "")})
    return out


def _tavily(query: str, num: int) -> list[dict[str, str]]:
    payload = post_json(
        "https://api.tavily.com/search",
        {"Authorization": f"Bearer {_key('tavily')}", "Content-Type": "application/json"},
        {"query": query, "max_results": num, "search_depth": "basic"},
        timeout=30.0,
        retries=1,
    )
    out: list[dict[str, str]] = []
    for r in payload.get("results") or []:
        if isinstance(r, dict) and r.get("url"):
            out.append({"title": r.get("title", ""), "link": r["url"], "snippet": r.get("content", "")})
    return out


def _openwebninja(query: str, num: int) -> list[dict[str, str]]:
    import json as _json
    import urllib.request
    from urllib.error import HTTPError, URLError

    qs = urllib.parse.urlencode({"q": query, "limit": num})
    req = urllib.request.Request(
        f"https://api.openwebninja.com/realtime-web-search/search-light?{qs}",
        headers={"X-API-Key": _key("openwebninja"), "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30.0) as resp:
            payload = _json.loads(resp.read().decode("utf-8", errors="replace"))
    except HTTPError as e:  # match post_json's contract so quota fail-over triggers
        body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        raise RuntimeError(f"HTTP {e.code}: {body[:300]}") from e
    except (URLError, TimeoutError, OSError) as e:
        raise RuntimeError(str(getattr(e, "reason", e))) from e
    out: list[dict[str, str]] = []
    for r in payload.get("data") or []:
        if isinstance(r, dict) and r.get("url"):
            out.append({"title": r.get("title", ""), "link": r["url"], "snippet": r.get("snippet", "")})
    return out


#: Bright Data zone for the SERP API. A zone is a billing + routing bucket on
#: their side; the name has to match what exists in the account.
BRIGHTDATA_ZONE_DEFAULT = "serp_api1"


def _brightdata_zone() -> str:
    try:
        from outreach.app_settings import get_setting

        return (get_setting("BRIGHTDATA_ZONE") or "").strip() or BRIGHTDATA_ZONE_DEFAULT
    except Exception:  # noqa: BLE001
        return (os.getenv("BRIGHTDATA_ZONE") or "").strip() or BRIGHTDATA_ZONE_DEFAULT


def _brightdata(query: str, num: int) -> list[dict[str, str]]:
    """Google results through Bright Data's SERP API.

    First in the chain because on 5 Aug it was the only provider with credit:
    Serper said "Not enough credits", Tavily "exceeds your plan's set usage
    limit", OpenWebNinja 429 and Apollo a plan limit, all four at once, which
    took contact-finding to zero and the sendable pool with it.

    Asks for `brd_json=1` so Bright Data parses the SERP itself. Scraping their
    HTML would mean maintaining a Google layout parser, which is the job we are
    paying them to have already done.
    """
    key = _key("brightdata")
    if not key:
        raise RuntimeError("no brightdata key")
    url = "https://www.google.com/search?" + urllib.parse.urlencode(
        {"q": query, "num": max(10, min(100, num)), "brd_json": "1"}
    )

    # Cache before spend. The same "who works at X" query ran again on every
    # re-enrich, retry and re-run of a batch that had already covered those
    # accounts — free when the providers were free, an invoice now.
    from utils import provider_cache as _pc

    cached = _pc.get("brightdata", {"url": url})
    if cached is not None:
        return cached[:num]

    if _pc.budget_left("brightdata") <= 0:
        # A budget stop is not a provider fault, so it must not mark Bright Data
        # exhausted and fail over to four providers already out of credit.
        raise RuntimeError(
            f"brightdata daily budget of {_pc.daily_budget('brightdata')} calls reached "
            "— raise it in Pipeline settings if this is expected"
        )

    payload = post_json(
        "https://api.brightdata.com/request",
        {"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        {"zone": _brightdata_zone(), "url": url, "format": "raw"},
        timeout=60.0,
    )
    # Bright Data signals several soft failures as HTTP 200 with a sentence of
    # English in the body, or an empty body, rather than an error status:
    #
    #   "This query recently failed and cannot be attempted at this time.
    #    Please try again later, after a minimum of 15 seconds."
    #
    # post_json returns {} for an empty body, so this arrived as a successful
    # search with zero results. The caller cannot tell that apart from "Google
    # genuinely has nothing", so a lead was marked unfindable because of a
    # cooldown. Treat anything that is not a parsed SERP as an error, so the
    # normal retry and fail-over paths handle it.
    if isinstance(payload, str):
        import json as _json

        try:
            payload = _json.loads(payload)
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(f"brightdata: {payload[:160]}") from e
    if not isinstance(payload, dict) or not payload:
        raise RuntimeError("brightdata: empty response (query cooldown or zone refusal)")

    out: list[dict[str, str]] = []
    # `organic` is the parsed result list. Other blocks (knowledge, ads) are
    # deliberately ignored: a knowledge panel is not a page we can crawl.
    for r in payload.get("organic") or []:
        if isinstance(r, dict) and r.get("link"):
            out.append({
                "title": r.get("title", ""),
                "link": r["link"],
                "snippet": r.get("description") or r.get("snippet") or "",
            })
    # Charged once, cached whole. Storing the full result set rather than the
    # requested slice means a later call asking for more is still a cache hit.
    _pc.charge("brightdata")
    # An empty result is never cached. A cooldown, a transient block or a bad
    # moment at Google would otherwise be remembered as "this school has no
    # contactable staff" for thirty days, and re-running the batch would not
    # fix it.
    if out:
        _pc.put("brightdata", {"url": url}, out)
    return out[:num]


_PROVIDERS: tuple[tuple[str, object], ...] = (
    ("brightdata", _brightdata),
    ("serper", _serper),
    ("openwebninja", _openwebninja),
    ("tavily", _tavily),
)


def web_search(query: str, num: int = 10, *, primary: str = "brightdata") -> tuple[list[dict[str, str]], str]:
    """Search with automatic provider fallback.

    Returns ``(results, provider_used)``. ``provider_used`` is ``""`` when no provider
    could serve the query (all missing keys / exhausted / errored).
    """
    order = sorted(_PROVIDERS, key=lambda p: 0 if p[0] == primary else 1)
    last_err = ""
    for name, fn in order:
        if name in _EXHAUSTED or not _key(name):
            if not _key(name):
                _EXHAUSTED.add(name)
                report_quota(name, "No API key configured")
            continue
        try:
            _throttle(name)
            results = fn(query, num)  # type: ignore[operator]
            _COUNTS[name] += 1
            report_ok(name)
            return results, name
        except RuntimeError as e:
            msg = str(e)
            # A cooldown is a wait, not a failure. Sleeping it out once is the
            # difference between an account with six contacts and an account
            # marked unfindable — and the other providers are all dry, so
            # failing over achieves nothing but noise in the log.
            if any(m in msg.lower() for m in _TRANSIENT_MARKERS):
                time.sleep(16.0)
                try:
                    results = fn(query, num)  # type: ignore[operator]
                    _COUNTS[name] += 1
                    report_ok(name)
                    return results, name
                except RuntimeError as e2:
                    msg = str(e2)
            last_err = msg
            if _is_quota_error(msg):
                print(f"Warning: {name} exhausted/blocked ({msg[:80]}); failing over.")
                _EXHAUSTED.add(name)
                report_quota(name, msg[:200])
            else:
                print(f"Warning: {name} query error ({msg[:80]}); trying fallback.")
            continue
    if last_err:
        print(f"Warning: all providers failed for {query[:60]!r}: {last_err[:80]}")
    return [], ""
