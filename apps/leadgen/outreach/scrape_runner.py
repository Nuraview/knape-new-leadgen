"""Scheduled lead scraping + auto contact-enrichment (dashboard-controlled).

Mirrors ``email_runner``'s daemon-thread pattern. Every knob comes from
``app_settings`` (dashboard > env > default) — nothing is developer-only:

- ``SCRAPE_ENABLED`` (default OFF — client flips it on from the UI when ready)
- ``SCRAPE_TIMES`` "03:00,15:00" server-time daily run times
- Scraper tuning (states, enrollment, caps) exported as env vars onto the
  ``main.py milestone1`` subprocess via ``app_settings.scraper_env()``
- ``AUTO_ENRICH_ENABLED`` / ``ENRICH_DAILY_CAP`` / ``ENRICH_MAX_CONTACTS``

The scrape itself runs as a subprocess (same pattern as POST /api/pipeline/enrich)
so the API stays responsive and the existing run-lock + event feed just work.
``PIPELINE_SYNC_MODE=merge`` makes the run additive: nothing existing is deleted.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from outreach import app_settings, db
from utils import pipeline_events
from utils.pipeline_run_state import clear_stale_lock, read_lock

_thread: threading.Thread | None = None
_lock = threading.Lock()
_enrich_running = threading.Event()


def _root() -> Path:
    return Path(__file__).resolve().parent.parent


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _parse_times(raw: str) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for part in (raw or "").split(","):
        part = part.strip()
        if len(part) == 5 and part[2] == ":" and part[:2].isdigit() and part[3:].isdigit():
            h, m = int(part[:2]), int(part[3:])
            if 0 <= h < 24 and 0 <= m < 60:
                out.append((h, m))
    return sorted(out)


def _slots_around(now: float) -> list[float]:
    """Unix timestamps of yesterday's, today's, and tomorrow's scheduled slots."""
    times = _parse_times(str(app_settings.get_setting("SCRAPE_TIMES")))
    base = datetime.fromtimestamp(now).replace(second=0, microsecond=0)
    out: list[float] = []
    for day in (-1, 0, 1):
        for h, m in times:
            out.append(base.replace(hour=h, minute=m).timestamp() + day * 86400)
    return sorted(out)


def next_run_at(now: float | None = None) -> float | None:
    """Unix ts of the next scheduled run, or None when auto-scrape is off."""
    if not app_settings.get_setting("SCRAPE_ENABLED"):
        return None
    now = now or time.time()
    future = [s for s in _slots_around(now) if s > now]
    return future[0] if future else None


def _due(last_run_at: float, now: float) -> bool:
    """A scheduled slot lies between the last run and now."""
    return any(last_run_at < s <= now for s in _slots_around(now))


def start_scrape(trigger: str = "schedule") -> dict[str, Any]:
    """Launch the milestone1 scrape subprocess (merge mode). Guarded by the run-lock."""
    clear_stale_lock()
    if read_lock():
        return {"started": False, "running": True}
    py = sys.executable
    env = {**os.environ, "PIPELINE_SYNC_MODE": "merge", **app_settings.scraper_env()}
    pipeline_events.emit("scrape", f"Scrape started ({trigger})", level="info")
    subprocess.Popen(  # noqa: S603 — fixed command, no user input
        [py, "main.py", "milestone1"],
        cwd=str(_root()),
        env=env,
        start_new_session=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    app_settings.set_settings({"SCRAPE_LAST_RUN_AT": time.time()})
    threading.Thread(target=_watch_then_enrich, daemon=True, name="scrape-watcher").start()
    return {"started": True, "running": True}


def _watch_then_enrich() -> None:
    """Wait for the scrape subprocess to release the run-lock, then auto-enrich."""
    time.sleep(10)
    deadline = time.time() + 45 * 60
    while time.time() < deadline:
        clear_stale_lock()
        if not read_lock():
            break
        time.sleep(15)
    # Record the newest sweep as the run result.
    try:
        conn = db.connect()
        try:
            row = conn.execute("SELECT total_accounts, ran_at FROM sweeps ORDER BY id DESC LIMIT 1").fetchone()
            if row:
                app_settings.set_settings({
                    "SCRAPE_LAST_RESULT": json.dumps({"total": int(row["total_accounts"]), "ran_at": float(row["ran_at"])})
                })
        finally:
            conn.close()
    except Exception:  # noqa: BLE001
        pass
    if app_settings.get_setting("AUTO_ENRICH_ENABLED"):
        run_contact_enrich(trigger="post-scrape")


def _enrich_quota_left() -> int:
    cap = int(app_settings.get_setting("ENRICH_DAILY_CAP") or 0)
    if cap <= 0:
        return 0
    day = str(app_settings.get_setting("ENRICH_DAY", "") or "")
    used = int(app_settings.get_setting("ENRICH_DAY_COUNT", 0) or 0) if day == _today() else 0
    return max(0, cap - used)


def _bump_enrich_count(n: int) -> None:
    day = str(app_settings.get_setting("ENRICH_DAY", "") or "")
    used = int(app_settings.get_setting("ENRICH_DAY_COUNT", 0) or 0) if day == _today() else 0
    app_settings.set_settings({"ENRICH_DAY": _today(), "ENRICH_DAY_COUNT": used + n})


def run_contact_enrich(trigger: str = "manual", limit: int | None = None) -> dict[str, Any]:
    """Full-stack enrichment for accounts that have no contacts yet, capped per day.

    For each lead: named contacts (site crawl + LinkedIn x-ray), org switchboard
    phone + front-office email, org LinkedIn page, and a work email for the top
    contact — the same pipeline as the manual batch passes, via
    ``pipeline.full_enrich.enrich_one_account``. Safe to re-run: every step only
    fills what's currently empty, so repeats are cheap no-ops.
    """
    if _enrich_running.is_set():
        return {"started": False, "running": True}
    quota = _enrich_quota_left()
    if quota <= 0:
        pipeline_events.emit("enrich-contacts", "Daily contact-finding limit reached — skipping.", level="warn")
        return {"started": False, "quota": 0}
    n = min(quota, limit) if limit else quota

    def _work() -> None:
        _enrich_running.set()
        done = found = 0
        try:
            from pipeline.full_enrich import enrich_one_account

            conn = db.connect()
            try:
                rows = conn.execute(
                    """
                    SELECT a.id, a.company
                    FROM accounts a
                    WHERE NOT EXISTS (SELECT 1 FROM contacts c WHERE c.account_id = a.id)
                    ORDER BY a.last_sweep_at DESC, a.id DESC
                    LIMIT ?
                    """,
                    (n,),
                ).fetchall()
            finally:
                conn.close()
            total = len(rows)
            pipeline_events.emit("enrich-contacts", f"Contact-finding started ({trigger}) — {total} lead(s).", level="info")
            max_contacts = int(app_settings.get_setting("ENRICH_MAX_CONTACTS") or 3)
            for i, row in enumerate(rows, start=1):
                try:
                    out = enrich_one_account(int(row["id"]), max_contacts=max_contacts)
                    found += int(out.get("people") or 0)
                except Exception as e:  # noqa: BLE001 — one bad account never kills the batch
                    pipeline_events.emit("enrich-contacts", f"{row['company']}: {type(e).__name__}", level="warn")
                done += 1
                if i % 10 == 0 or i == total:
                    pipeline_events.emit("enrich-contacts", f"Contacts: {i}/{total} leads checked, {found} people found.", level="info")
            _bump_enrich_count(done)
            pipeline_events.emit(
                "enrich-contacts", f"Contact-finding finished — {found} people across {done} lead(s).",
                level="success",
            )
        finally:
            _enrich_running.clear()

    threading.Thread(target=_work, daemon=True, name="contact-enrich").start()
    return {"started": True, "planned": n}


def schedule_summary() -> dict[str, Any]:
    last_result: dict[str, Any] = {}
    try:
        raw = app_settings.get_setting("SCRAPE_LAST_RESULT", "")
        if raw:
            last_result = json.loads(str(raw))
    except (TypeError, ValueError):
        pass
    return {
        "enabled": bool(app_settings.get_setting("SCRAPE_ENABLED")),
        "times": str(app_settings.get_setting("SCRAPE_TIMES")),
        "next_run_at": next_run_at(),
        "last_run_at": float(app_settings.get_setting("SCRAPE_LAST_RUN_AT", 0) or 0) or None,
        "last_result": last_result,
        "auto_enrich": bool(app_settings.get_setting("AUTO_ENRICH_ENABLED")),
        "enrich_daily_cap": int(app_settings.get_setting("ENRICH_DAILY_CAP") or 0),
        "enrich_quota_left": _enrich_quota_left(),
        "enrich_running": _enrich_running.is_set(),
    }


#: Leads per continuous enrichment pass. Small on purpose: a short batch that
#: finishes and reports beats a long one that holds the daily quota hostage and
#: shows nothing until it ends.
ENRICH_BATCH = 25


def _loop(interval_sec: int) -> None:
    time.sleep(30)
    while True:
        try:
            if app_settings.get_setting("SCRAPE_ENABLED"):
                last = float(app_settings.get_setting("SCRAPE_LAST_RUN_AT", 0) or 0)
                if _due(last, time.time()):
                    start_scrape(trigger="schedule")
        except Exception:  # noqa: BLE001 — the tick must never die
            pass

        # Contact-finding, continuously — not only in the minutes after a scrape.
        #
        # This ran exactly once per scrape, so twice a day, and stopped when
        # that batch finished. 3,277 schools with no named contact sat
        # untouched between runs while the daily enrichment quota went unspent,
        # and the sendable pool stayed at double digits against 3,748 leads.
        # Finding a lead and finding the person at it are the same job; only
        # one of them was on a schedule.
        #
        # Deliberately NOT gated by the US-Eastern send window: reading a
        # website at 4am bothers nobody, and the whole point is that the pool is
        # full by the time sending opens at 08:00.
        try:
            if app_settings.get_setting("AUTO_ENRICH_ENABLED") and not _enrich_running.is_set():
                if _enrich_quota_left() > 0:
                    run_contact_enrich(trigger="continuous", limit=ENRICH_BATCH)
        except Exception:  # noqa: BLE001
            pass

        time.sleep(interval_sec)


def ensure_scheduler(interval_sec: int = 60) -> None:
    global _thread
    with _lock:
        if _thread is not None and _thread.is_alive():
            return
        app_settings.init_db()
        _thread = threading.Thread(target=_loop, args=(interval_sec,), daemon=True, name="scrape-scheduler")
        _thread.start()
