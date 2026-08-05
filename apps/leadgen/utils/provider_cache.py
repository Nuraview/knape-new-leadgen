"""Never pay twice for the same answer.

Bright Data bills per request. Every other provider in this pipeline was free
until it wasn't, and nothing in the codebase ever cached a search: the same
"site:linkedin.com/in <school>" query ran again on every re-enrich, every retry
and every re-run of a batch that had already covered those accounts. That was
survivable at zero marginal cost and is not survivable now.

Two guards live here:

* **Cache.** A response is stored against a hash of the exact request. A repeat
  costs nothing and returns instantly. TTL is long because the answer to "who is
  the athletic director at X" does not change週 to week, and a stale hit that
  saves a credit is better than a fresh miss that spends one.

* **Budget.** A hard daily ceiling on billable calls, counted in the same table.
  Not a cap on work — a cap on SPEND. Without it a loop bug or an enthusiastic
  batch size is a bill, and the failure mode of an API that always answers is
  that nothing tells you to stop.

Both are best-effort against the database: a cache that is down must never stop
the pipeline, it just stops saving money for a while.
"""

from __future__ import annotations

import hashlib
import json
import time
from typing import Any

#: How long a cached provider response stays good.
#:
#: Staff directories and LinkedIn titles move on a school-year cadence, not a
#: daily one, and a month-old answer that costs nothing beats a fresh one that
#: costs a credit. Bounded so a person who genuinely changed jobs is eventually
#: re-found.
TTL_SEC = 30 * 86400

#: Billable calls allowed per calendar day, across every Bright Data surface.
#: Deliberately low relative to the lead count: the point is that an overnight
#: run cannot quietly become an invoice.
DEFAULT_DAILY_BUDGET = 1500


def _table() -> None:
    from outreach import db

    c = db.connect()
    try:
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS provider_cache (
                key TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                body TEXT,
                created_at DOUBLE PRECISION NOT NULL
            )
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_provider_cache_created ON provider_cache(created_at)")
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS provider_spend (
                day TEXT NOT NULL,
                provider TEXT NOT NULL,
                calls INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (day, provider)
            )
            """
        )
        c.commit()
    finally:
        c.close()


_READY = False


def _ensure() -> None:
    global _READY
    if _READY:
        return
    try:
        _table()
        _READY = True
    except Exception:  # noqa: BLE001 — caching is an optimisation, never a dependency
        pass


def key_for(provider: str, payload: Any) -> str:
    """Stable key for a request. Sorted JSON so dict ordering cannot miss a hit."""
    blob = json.dumps(payload, sort_keys=True, default=str)
    return f"{provider}:{hashlib.sha256(blob.encode()).hexdigest()[:40]}"


def get(provider: str, payload: Any) -> Any | None:
    """A previous answer to this exact request, or None."""
    _ensure()
    k = key_for(provider, payload)
    try:
        from outreach import db

        c = db.connect()
        try:
            row = c.execute(
                "SELECT body, created_at FROM provider_cache WHERE key=?", (k,)
            ).fetchone()
        finally:
            c.close()
    except Exception:  # noqa: BLE001
        return None
    if not row:
        return None
    if time.time() - float(row["created_at"] or 0) > TTL_SEC:
        return None
    try:
        return json.loads(row["body"] or "null")
    except Exception:  # noqa: BLE001
        return None


def put(provider: str, payload: Any, body: Any) -> None:
    """Remember an answer. Silent on failure."""
    _ensure()
    k = key_for(provider, payload)
    try:
        from outreach import db

        c = db.connect()
        try:
            c.execute(
                """
                INSERT INTO provider_cache (key, provider, body, created_at)
                VALUES (?,?,?,?)
                ON CONFLICT (key) DO UPDATE SET body=EXCLUDED.body, created_at=EXCLUDED.created_at
                """,
                (k, provider, json.dumps(body, default=str), time.time()),
            )
            c.commit()
        finally:
            c.close()
    except Exception:  # noqa: BLE001
        pass


def _today() -> str:
    from datetime import datetime
    from zoneinfo import ZoneInfo

    # Same reporting day as everything else, so "calls today" on the dashboard
    # lines up with "emails sent today" instead of rolling over at a different
    # hour and looking wrong.
    return datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def spent_today(provider: str = "brightdata") -> int:
    _ensure()
    try:
        from outreach import db

        c = db.connect()
        try:
            row = c.execute(
                "SELECT calls FROM provider_spend WHERE day=? AND provider=?",
                (_today(), provider),
            ).fetchone()
        finally:
            c.close()
    except Exception:  # noqa: BLE001
        return 0
    return int(row["calls"]) if row else 0


def daily_budget(provider: str = "brightdata") -> int:
    try:
        from outreach.app_settings import get_setting

        return int(get_setting("BRIGHTDATA_DAILY_BUDGET") or DEFAULT_DAILY_BUDGET)
    except Exception:  # noqa: BLE001
        return DEFAULT_DAILY_BUDGET


def budget_left(provider: str = "brightdata") -> int:
    return max(0, daily_budget(provider) - spent_today(provider))


def charge(provider: str = "brightdata", n: int = 1) -> None:
    """Record a billable call. Only called on a cache MISS that actually went out."""
    _ensure()
    try:
        from outreach import db

        c = db.connect()
        try:
            c.execute(
                """
                INSERT INTO provider_spend (day, provider, calls) VALUES (?,?,?)
                ON CONFLICT (day, provider) DO UPDATE SET calls = provider_spend.calls + ?
                """,
                (_today(), provider, n, n),
            )
            c.commit()
        finally:
            c.close()
    except Exception:  # noqa: BLE001
        pass


def stats(provider: str = "brightdata") -> dict[str, Any]:
    """For the dashboard: what has been spent, what is left, how much the cache saved."""
    _ensure()
    hits = 0
    try:
        from outreach import db

        c = db.connect()
        try:
            row = c.execute(
                "SELECT COUNT(*) AS n FROM provider_cache WHERE provider=?", (provider,)
            ).fetchone()
            hits = int(row["n"] or 0) if row else 0
        finally:
            c.close()
    except Exception:  # noqa: BLE001
        pass
    used = spent_today(provider)
    budget = daily_budget(provider)
    return {
        "provider": provider,
        "used_today": used,
        "daily_budget": budget,
        "remaining": max(0, budget - used),
        "cached_answers": hits,
    }
